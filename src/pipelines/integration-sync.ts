import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { payloadHash } from '../services/canonical-json';
import { runIngest } from './ingest';
import { linkIntegrationEvidence } from './integration-evidence';
import { runIntegrationTests } from './integration-tests';
import { materializeGraphV2 } from './graph-v2';
import type { ProcessIntegrationBatchInput, ProcessIntegrationBatchResult } from '../types';
import { decorateWithSourceIntelligence } from '../integrations/source-intelligence';

const STALE_PROCESSING_MS = 20 * 60 * 1000;

export async function processIntegrationBatch(
  input: ProcessIntegrationBatchInput
): Promise<ProcessIntegrationBatchResult> {
  const now = new Date().toISOString();
  const { data: existingConnection, error: existingConnectionError } = await supabase
    .from(Tables.INTEGRATION_CONNECTIONS)
    .select('id')
    .eq('user_id', input.userId)
    .eq('provider_id', input.providerId)
    .maybeSingle();
  if (existingConnectionError) throw new Error(`Load integration connection failed: ${existingConnectionError.message}`);
  const connectionResult = existingConnection
    ? await supabase.from(Tables.INTEGRATION_CONNECTIONS).update({
        collection_mode: input.collectionMode,
        disconnected_at: null,
      }).eq('id', existingConnection.id).select('id').single()
    : await supabase.from(Tables.INTEGRATION_CONNECTIONS).insert({
      user_id: input.userId,
      provider_id: input.providerId,
      collection_mode: input.collectionMode,
      status: 'action_required',
      disconnected_at: null,
    }).select('id').single();
  const { data: connection, error: connectionError } = connectionResult;
  if (connectionError || !connection) {
    throw new Error(`Create integration connection failed: ${connectionError?.message ?? 'no row'}`);
  }

  const { data: priorSyncState, error: priorSyncStateError } = await supabase
    .from(Tables.INTEGRATION_SYNC_STATES)
    .select('cursor,last_success_at,consecutive_failures')
    .eq('connection_id', connection.id)
    .maybeSingle();
  if (priorSyncStateError) {
    throw new Error(`Load integration sync state failed: ${priorSyncStateError.message}`);
  }

  const { data: syncRun, error: syncRunError } = await supabase
    .from(Tables.INTEGRATION_SYNC_RUNS)
    .insert({
      connection_id: connection.id,
      run_type: input.runType,
      status: 'running',
      cursor_before: input.cursorBefore,
      cursor_after: input.cursorAfter,
      items_seen: input.items.length,
    })
    .select('id')
    .single();
  if (syncRunError || !syncRun) {
    throw new Error(`Start integration sync run failed: ${syncRunError?.message ?? 'no row'}`);
  }

  const rawContentIds: string[] = [];
  const projectedRawContentIds = new Set<string>();
  const sourceItemIds = new Set<string>();
  const failures: { providerObjectId: string; error: string }[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let ingestionTraceId: string | null = null;

  try {
    for (const originalItem of input.items) {
      const item = decorateWithSourceIntelligence(input.providerId, originalItem);
      const { data, error } = await supabase.rpc('ingest_integration_source_item', {
        p_user_id: input.userId,
        p_provider_id: input.providerId,
        p_collection_mode: input.collectionMode,
        p_sync_run_id: syncRun.id,
        p_provider_object_type: item.providerObjectType,
        p_provider_object_id: item.providerObjectId,
        p_payload: item.payload,
        p_payload_hash: payloadHash(item.payload),
        p_canonical_type: item.canonicalType,
        p_canonical_text: item.canonicalText,
        p_normalized_data: item.normalizedData,
        p_occurred_at: item.occurredAt ?? null,
        p_analysis_eligible: item.analysisEligible ?? true,
        p_provider_created_at: item.providerCreatedAt ?? null,
        p_provider_updated_at: item.providerUpdatedAt ?? null,
        p_parser_version: item.parserVersion,
        p_normalizer_version: item.normalizerVersion,
        p_content_type: item.contentType,
        p_metadata: item.metadata,
      });
      const result = Array.isArray(data) ? data[0] : null;
      if (error || !result) {
        failures.push({
          providerObjectId: item.providerObjectId,
          error: error?.message ?? 'source item ingestion returned no result',
        });
        continue;
      }
      if (result.item_created) created++;
      else if (result.content_changed) updated++;
      else skipped++;
      if (result.raw_content_id) projectedRawContentIds.add(result.raw_content_id);
      if (result.source_item_id) sourceItemIds.add(result.source_item_id);
      if (result.source_item_id) {
        await supabase.from(Tables.SOURCE_ASSETS).update({ source_item_id: result.source_item_id })
          .eq('connection_id', connection.id)
          .eq('provider_object_type', item.providerObjectType)
          .eq('provider_object_id', item.providerObjectId)
          .is('source_item_id', null);
      }
    }

    if (projectedRawContentIds.size > 0) {
      const { data: projectedRawContent, error: pendingRawContentError } = await supabase
        .from(Tables.RAW_CONTENT)
        .select('id,processing_status,processing_started_at')
        .eq('user_id', input.userId)
        .in('id', [...projectedRawContentIds]);
      if (pendingRawContentError) {
        throw new Error(`Load pending integration raw content failed: ${pendingRawContentError.message}`);
      }

      const staleBefore = Date.now() - STALE_PROCESSING_MS;
      const activeProcessing = (projectedRawContent ?? []).filter(
        (row) => row.processing_status === 'processing'
          && row.processing_started_at
          && new Date(row.processing_started_at).getTime() >= staleBefore
      );
      if (activeProcessing.length > 0) {
        throw new Error(`${activeProcessing.length} integration raw item(s) are already being analyzed`);
      }

      const staleProcessingIds = (projectedRawContent ?? [])
        .filter((row) => row.processing_status === 'processing')
        .map((row) => row.id);
      if (staleProcessingIds.length > 0) {
        const { error: staleError } = await supabase
          .from(Tables.RAW_CONTENT)
          .update({
            processing_status: 'failed',
            processing_error: 'Recovered stale integration processing lease',
            processing_started_at: null,
          })
          .in('id', staleProcessingIds)
          .eq('processing_status', 'processing');
        if (staleError) throw new Error(`Recover stale integration analysis failed: ${staleError.message}`);
      }

      rawContentIds.push(...(projectedRawContent ?? [])
        .filter((row) => row.processing_status === 'pending'
          || row.processing_status === 'failed'
          || staleProcessingIds.includes(row.id))
        .map((row) => row.id));
    }

    if (rawContentIds.length > 0) {
      const ingest = await runIngest({
        userId: input.userId,
        rawContentIds,
        triggeredBy: 'http',
        notes: `Integration sync ${syncRun.id} (${input.providerId})`,
      });
      ingestionTraceId = ingest.traceId;
    }
    if (projectedRawContentIds.size > 0) {
      await linkIntegrationEvidence(input.userId, [...projectedRawContentIds], ingestionTraceId);
    }
    if (sourceItemIds.size > 0) {
      await materializeGraphV2(input.userId, [...sourceItemIds]);
    }

    const status =
      failures.length === 0 ? 'completed' : failures.length === input.items.length ? 'failed' : 'partial';
    await supabase.from(Tables.INTEGRATION_SYNC_RUNS).update({
      status,
      items_created: created,
      items_updated: updated,
      items_skipped: skipped,
      error_summary: { failures },
      ingestion_trace_id: ingestionTraceId,
      completed_at: new Date().toISOString(),
    }).eq('id', syncRun.id);

    const completedAt = new Date().toISOString();
    await supabase.from(Tables.INTEGRATION_CONNECTIONS).update({
      status: failures.length === 0 ? 'connected' : 'error',
      last_verified_at: failures.length === 0 ? completedAt : null,
    }).eq('id', connection.id);
    const { error: syncStateError } = await supabase.from(Tables.INTEGRATION_SYNC_STATES).upsert({
      connection_id: connection.id,
      cursor: failures.length === 0 ? input.cursorAfter : (priorSyncState?.cursor ?? input.cursorBefore),
      last_attempt_at: now,
      last_success_at: failures.length === 0 ? completedAt : (priorSyncState?.last_success_at ?? null),
      last_error: failures.length > 0 ? `${failures.length} item(s) failed` : null,
      consecutive_failures: failures.length > 0 ? (priorSyncState?.consecutive_failures ?? 0) + 1 : 0,
      updated_at: completedAt,
    }, { onConflict: 'connection_id' });
    if (syncStateError) {
      throw new Error(`Persist integration sync state failed: ${syncStateError.message}`);
    }

    try {
      await runIntegrationTests(connection.id);
    } catch (testError) {
      console.error(
        `[integrations] Verification failed for sync ${syncRun.id}:`,
        testError instanceof Error ? testError.message : testError
      );
    }

    return {
      syncRunId: syncRun.id,
      ingestionTraceId,
      itemsSeen: input.items.length,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsSkipped: skipped,
      itemsFailed: failures.length,
      rawContentIds,
      failures,
    };
  } catch (err) {
    const failedAt = new Date().toISOString();
    await supabase.from(Tables.INTEGRATION_SYNC_RUNS).update({
      status: 'failed',
      error_summary: { fatal: err instanceof Error ? err.message : String(err), failures },
      completed_at: failedAt,
    }).eq('id', syncRun.id);
    await supabase.from(Tables.INTEGRATION_SYNC_STATES).upsert({
      connection_id: connection.id,
      cursor: priorSyncState?.cursor ?? input.cursorBefore,
      last_attempt_at: failedAt,
      last_success_at: priorSyncState?.last_success_at ?? null,
      last_error: err instanceof Error ? err.message : String(err),
      consecutive_failures: (priorSyncState?.consecutive_failures ?? 0) + 1,
      updated_at: failedAt,
    }, { onConflict: 'connection_id' });
    await supabase.from(Tables.INTEGRATION_CONNECTIONS).update({ status: 'error' }).eq('id', connection.id);
    throw err;
  }
}
