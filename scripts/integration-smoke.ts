#!/usr/bin/env tsx
import { parseArgs, requireArg, optBool } from './_args';
import { processIntegrationBatch } from '../src/pipelines/integration-sync';
import { runIntegrationTests } from '../src/pipelines/integration-tests';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Integration smoke assertion failed: ${message}`);
}

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const withAgent = optBool(args, 'with-agent');
  const occurredAt = new Date().toISOString();
  const runId = Date.now().toString();

  const makeItems = (version: number) => [
    {
      providerObjectType: 'smoke_summary',
      providerObjectId: `${runId}:summary`,
      payload: {
        version,
        day: occurredAt.slice(0, 10),
        steps: version === 1 ? 10 : 11,
        aggregation_window: 'smoke_test',
      },
      canonicalType: 'health_daily_summary',
      canonicalText: `Integration smoke health summary for ${occurredAt.slice(0, 10)}. Steps: ${version === 1 ? 10 : 11}.`,
      normalizedData: {
        version,
        day: occurredAt.slice(0, 10),
        steps: version === 1 ? 10 : 11,
        aggregation_window: 'smoke_test',
      },
      occurredAt,
      analysisEligible: withAgent,
      parserVersion: 'smoke-v1',
      normalizerVersion: 'health-daily-v1',
      contentType: 'healthkit',
      metadata: { smoke_test: true },
    },
    {
      providerObjectType: 'smoke_record',
      providerObjectId: `${runId}:stored-only-record`,
      payload: { stable: true },
      canonicalType: 'integration_smoke_record',
      canonicalText: 'Stored-only integration smoke record.',
      normalizedData: { stable: true },
      analysisEligible: false,
      parserVersion: 'smoke-v1',
      normalizerVersion: 'smoke-v1',
      contentType: 'text_entry',
      metadata: { smoke_test: true },
    },
  ];

  console.log(`[integration-smoke] user=${userId} withAgent=${withAgent}`);

  const first = await processIntegrationBatch({
    userId,
    providerId: 'integration_smoke_test',
    collectionMode: 'native_ios',
    runType: 'initial_backfill',
    cursorBefore: {},
    cursorAfter: { version: 1 },
    items: makeItems(1),
  });
  assert(first.itemsCreated === 2, `expected 2 created items, received ${first.itemsCreated}`);

  const replay = await processIntegrationBatch({
    userId,
    providerId: 'integration_smoke_test',
    collectionMode: 'native_ios',
    runType: 'replay',
    cursorBefore: { version: 1 },
    cursorAfter: { version: 1 },
    items: makeItems(1),
  });
  assert(replay.itemsSkipped === 2, `expected 2 skipped replay items, received ${replay.itemsSkipped}`);

  const update = await processIntegrationBatch({
    userId,
    providerId: 'integration_smoke_test',
    collectionMode: 'native_ios',
    runType: 'incremental_sync',
    cursorBefore: { version: 1 },
    cursorAfter: { version: 2 },
    items: makeItems(2),
  });
  assert(update.itemsUpdated === 1, `expected 1 updated item, received ${update.itemsUpdated}`);
  assert(update.itemsSkipped === 1, `expected 1 unchanged item, received ${update.itemsSkipped}`);

  const { data: connection, error } = await supabase
    .from(Tables.INTEGRATION_CONNECTIONS)
    .select('id')
    .eq('user_id', userId)
    .eq('provider_id', 'integration_smoke_test')
    .single();
  if (error || !connection) throw new Error(`Could not load smoke connection: ${error?.message}`);

  const verification = await runIntegrationTests(connection.id);
  console.log(JSON.stringify({ first, replay, update, verification }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
