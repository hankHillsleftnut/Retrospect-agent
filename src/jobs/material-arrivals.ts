import { runIngest } from '../pipelines/ingest';
import { isAmbientOn, pendingSentIds } from '../ambient/switch';
import { captureReferences } from '../reference/capture';
import { enrichPending } from '../reference/enrich';
import { relatePending } from '../reference/relevance';
import { embedSaved } from '../reference/embed';
import { SENT_TYPES } from '../planner/daily';
import { refreshRecordBehaviour } from '../brain/record-patterns';
import { placeUnrecognisedEvents } from '../brain/place-events';
import { runResearch } from '../questions/run-research';
import { checkDailySpend } from '../pipelines/spend-guard';
import { claimFromDb, finishInDb, handleArrivals, type ArrivalDeps } from '../events/arrivals';

export const defaultArrivalDeps: ArrivalDeps = {
  claim: () => claimFromDb(),
  finish: (c, ok) => finishInDb(c, ok),
  mayRun: async (userId) => (await checkDailySpend(userId)).allowed,
  read: async (userId) => {
    // Links they sent become reference items, ambient or not: they handed them over.
    await captureReferences(userId);
    await enrichPending(userId);
    await relatePending(userId);
    await embedSaved(userId);
    // Ambient off (their switch or the master): read only what they sent.
    if (!(await isAmbientOn(userId))) {
      const ids = await pendingSentIds(userId, SENT_TYPES);
      if (ids.length) await runIngest({ userId, rawContentIds: ids, triggeredBy: 'event', notes: 'material arrived (ambient off: sent only)' });
      return;
    }
    await runIngest({ userId, daysBack: 7, triggeredBy: 'event', notes: 'material arrived' });
    await placeUnrecognisedEvents(userId);
    await refreshRecordBehaviour(userId, 14);
  },
  research: async (userId) => { if (await isAmbientOn(userId)) await runResearch(userId); },
};

let running = false;

/** Every minute: read and research for everyone whose new material has settled. */
export async function runMaterialArrivals(deps: ArrivalDeps = defaultArrivalDeps): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const r of await handleArrivals(deps)) {
      console.log(`[arrivals] user=${r.userId} ${r.outcome}${r.error ? ` (${r.error})` : ''}`);
    }
  } catch (err) {
    console.error('[arrivals] failed:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}
