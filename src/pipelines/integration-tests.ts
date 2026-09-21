import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

interface IntegrationCheck {
  name: string;
  status: 'passed' | 'failed' | 'warning';
  detail: string;
}

const PAGE_SIZE = 500;
const ID_BATCH_SIZE = 200;

async function loadSourceItems(connectionId: string) {
  const items: { id: string; latest_payload_id: string | null; analysis_eligible: boolean }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(Tables.SOURCE_ITEMS)
      .select('id, latest_payload_id, analysis_eligible')
      .eq('connection_id', connectionId)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Load source items failed: ${error.message}`);
    items.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return items;
  }
}

async function loadIdsByForeignKey(table: string, column: string, ids: string[]) {
  const rows: { id: string }[] = [];
  for (let batchStart = 0; batchStart < ids.length; batchStart += ID_BATCH_SIZE) {
    const batch = ids.slice(batchStart, batchStart + ID_BATCH_SIZE);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select('id')
        .in(column, batch)
        .order('id')
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Load ${table} failed: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE_SIZE) break;
    }
  }
  return rows.map((row) => row.id);
}

async function countByForeignKey(table: string, column: string, ids: string[]) {
  let total = 0;
  for (let start = 0; start < ids.length; start += ID_BATCH_SIZE) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .in(column, ids.slice(start, start + ID_BATCH_SIZE));
    if (error) throw new Error(`Count ${table} failed: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

async function loadRawProjections(sourceItemIds: string[]) {
  const rows: { id: string; processing_status: string; processing_started_at: string | null }[] = [];
  for (let start = 0; start < sourceItemIds.length; start += ID_BATCH_SIZE) {
    const { data, error } = await supabase
      .from(Tables.RAW_CONTENT)
      .select('id,processing_status,processing_started_at')
      .in('source_item_id', sourceItemIds.slice(start, start + ID_BATCH_SIZE));
    if (error) throw new Error(`Load raw_content projections failed: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

export async function runIntegrationTests(connectionId: string) {
  const startedAt = new Date().toISOString();
  const checks: IntegrationCheck[] = [];

  const { data: connection, error: connectionError } = await supabase
    .from(Tables.INTEGRATION_CONNECTIONS)
    .select('*')
    .eq('id', connectionId)
    .maybeSingle();

  if (connectionError || !connection) {
    throw new Error(`Connection not found: ${connectionError?.message ?? connectionId}`);
  }

  checks.push({
    name: 'connection_state',
    status: connection.status === 'connected' ? 'passed' : 'failed',
    detail: `status=${connection.status}`,
  });

  const [{ data: syncState }, { data: lastRun }, sourceItems] = await Promise.all([
    supabase.from(Tables.INTEGRATION_SYNC_STATES).select('*').eq('connection_id', connectionId).maybeSingle(),
    supabase.from(Tables.INTEGRATION_SYNC_RUNS).select('*').eq('connection_id', connectionId).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    loadSourceItems(connectionId),
  ]);

  checks.push({
    name: 'sync_state',
    status: syncState ? 'passed' : 'warning',
    detail: syncState ? `last_success_at=${syncState.last_success_at ?? 'never'}` : 'No durable cursor state yet',
  });
  checks.push({
    name: 'latest_sync_run',
    status: !lastRun ? 'warning' : lastRun.status === 'completed' ? 'passed' : 'failed',
    detail: lastRun ? `status=${lastRun.status}, started_at=${lastRun.started_at}` : 'No sync runs yet',
  });

  const items = sourceItems;
  const orphanItems = items.filter((item) => !item.latest_payload_id);
  checks.push({
    name: 'source_item_payload_provenance',
    status: orphanItems.length === 0 ? 'passed' : 'failed',
    detail: `${items.length} source item(s), ${orphanItems.length} missing latest payload`,
  });

  const sourceItemIds = items.map((item) => item.id);
  const analysisEligibleIds = items.filter((item) => item.analysis_eligible).map((item) => item.id);
  let rawCount = 0;
  let incompleteRawCount = 0;
  let analysisUnitCount = 0;
  let evidenceCount = 0;
  if (sourceItemIds.length > 0) {
    const [rawRows, unitIds] = await Promise.all([
      loadRawProjections(analysisEligibleIds),
      loadIdsByForeignKey(Tables.ANALYSIS_UNITS, 'source_item_id', sourceItemIds),
    ]);
    rawCount = rawRows.length;
    incompleteRawCount = rawRows.filter((row) => row.processing_status !== 'completed').length;
    analysisUnitCount = unitIds.length;
    if (unitIds.length > 0) {
      evidenceCount = await countByForeignKey(Tables.EVIDENCE_LINKS, 'analysis_unit_id', unitIds);
    }
  }

  checks.push({
    name: 'raw_content_projection',
    status: sourceItemIds.length === 0 ? 'warning' : rawCount === analysisEligibleIds.length ? 'passed' : 'failed',
    detail: `${rawCount}/${analysisEligibleIds.length} analysis-eligible source items projected to raw_content`,
  });
  checks.push({
    name: 'analysis_units',
    status: sourceItemIds.length === 0 ? 'warning' : analysisUnitCount >= sourceItemIds.length ? 'passed' : 'failed',
    detail: `${analysisUnitCount} analysis unit(s) for ${sourceItemIds.length} source item(s)`,
  });
  checks.push({
    name: 'raw_content_processing',
    status: analysisEligibleIds.length === 0 ? 'warning' : incompleteRawCount === 0 ? 'passed' : 'failed',
    detail: `${rawCount - incompleteRawCount}/${rawCount} projected raw-content item(s) completed analysis`,
  });
  checks.push({
    name: 'derived_evidence_links',
    status: sourceItemIds.length === 0 || evidenceCount === 0 ? 'warning' : 'passed',
    detail: `${evidenceCount} exact evidence link(s) into derived intelligence`,
  });
  let assertionEvidenceCount = 0;
  if (sourceItemIds.length > 0) {
    assertionEvidenceCount = await countByForeignKey(Tables.ASSERTION_EVIDENCE, 'source_item_id', sourceItemIds);
  }
  checks.push({
    name: 'graph_v2_assertion_evidence',
    status: sourceItemIds.length === 0 || assertionEvidenceCount === 0 ? 'warning' : 'passed',
    detail: `${assertionEvidenceCount} graph assertion evidence link(s)`,
  });

  const status = checks.some((check) => check.status === 'failed')
    ? 'failed'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'passed';

  const { data: testRun, error: testError } = await supabase
    .from(Tables.INTEGRATION_TEST_RUNS)
    .insert({
      provider_id: connection.provider_id,
      connection_id: connectionId,
      test_suite: 'agent_provenance_v1',
      status,
      checks,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (testError) throw new Error(`Persist integration tests failed: ${testError.message}`);

  return { testRunId: testRun.id, providerId: connection.provider_id, status, checks };
}
