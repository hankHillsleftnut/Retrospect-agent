/**
 * Ambient on/off (founder's requirement, 20 Oct): "have an on/off switch so I
 * can turn off the ambient and turn on the ambient for every user."
 *
 * Two switches: the founder's master (AMBIENT_MASTER=off stops ambient for
 * everyone) and each person's own (users.ambient_enabled, migration 141).
 * Ambient = anything done without the person handing it over: syncing
 * connected sources, reading what syncs brought in, research, record patterns,
 * calendar placement. Off: only what they SEND is read.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { chunks } from '../db/paged';

export const masterOff = (env: NodeJS.ProcessEnv = process.env) => (env.AMBIENT_MASTER ?? '').toLowerCase() === 'off';

/** The people (of those given) whose ambient is off. One read, chunked. */
export async function ambientOffAmong(userIds: string[], db: typeof supabase = supabase, env: NodeJS.ProcessEnv = process.env): Promise<Set<string>> {
  if (masterOff(env)) return new Set(userIds);
  const off = new Set<string>();
  for (const part of chunks([...new Set(userIds)])) {
    const { data, error } = await db.from(Tables.USERS).select('id,ambient_enabled').in('id', part);
    // If the column isn't there yet (migration 141), ambient stays on: today's behaviour.
    if (error) return off;
    for (const u of (data ?? []) as Array<{ id: string; ambient_enabled: boolean | null }>) if (u.ambient_enabled === false) off.add(u.id);
  }
  return off;
}

export async function isAmbientOn(userId: string, db: typeof supabase = supabase, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return !(await ambientOffAmong([userId], db, env)).has(userId);
}

/** Unread items the person SENT (never passive syncs): all that's read with ambient off. */
export async function pendingSentIds(userId: string, sentTypes: Set<string>, db: typeof supabase = supabase): Promise<string[]> {
  const { data } = await db.from(Tables.RAW_CONTENT).select('id').eq('user_id', userId)
    .in('content_type', [...sentTypes]).in('processing_status', ['pending', 'failed']).limit(200);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}
