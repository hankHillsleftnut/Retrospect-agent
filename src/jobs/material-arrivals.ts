import { runIngest } from '../pipelines/ingest';
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
    await runIngest({ userId, daysBack: 7, triggeredBy: 'event', notes: 'material arrived' });
    await placeUnrecognisedEvents(userId);
    await refreshRecordBehaviour(userId, 14);
  },
  research: async (userId) => { await runResearch(userId); },
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
