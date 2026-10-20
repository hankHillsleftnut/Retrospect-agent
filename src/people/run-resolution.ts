/**
 * People from calendar and mail, resolved against the people already known (W2.3).
 *
 * Until now only names in the person's own writing became people; nobody from
 * a calendar invite or an email did, so "who do you spend time with" couldn't
 * move. Each attendee and each non-automated sender is a mention; it is
 * compared (scorePair, strict) only with plausible candidates (blocking: same
 * email, same first name, or same surname) and is linked, made a new person,
 * or held for the person to decide.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { selectAll, chunks } from '../db/paged';
import { scorePair, type Decision, type Mention, type NameContext } from './resolve';

export interface KnownPerson { id: string; name: string; emails: string[] }
export interface Outcome { mention: Mention; decision: Decision | 'known'; personId: string | null; signals: string[] }

const firstOf = (n: string) => n.trim().toLowerCase().split(/\s+/)[0] ?? '';
const lastOf = (n: string) => { const p = n.trim().toLowerCase().split(/\s+/); return p.length > 1 ? p[p.length - 1]! : ''; };

/** "Dana Reyes <dana@studio.example>" -> name and email. Pure. */
export function parseAddress(s: string | null | undefined): { name: string | null; email: string | null } {
  if (!s) return { name: null, email: null };
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1]!.trim() || null, email: m[2]!.trim().toLowerCase() };
  return /@/.test(s) ? { name: null, email: s.trim().toLowerCase() } : { name: s.trim(), email: null };
}

/** Resolve one mention against known people. Pure. */
export function resolveMention(m: Mention, people: KnownPerson[]): Outcome {
  const email = (m.email ?? '').toLowerCase();
  if (email) {
    const exact = people.find((p) => p.emails.includes(email));
    if (exact) return { mention: m, decision: 'known', personId: exact.id, signals: ['email already known'] };
  }
  const name = m.name ?? '';
  const ctx = (n: string): NameContext => ({
    firstNameCount: people.filter((p) => firstOf(p.name) === firstOf(n)).length,
    fullNameCount: people.filter((p) => p.name.trim().toLowerCase() === n.trim().toLowerCase()).length,
  });
  // Blocking: only plausible candidates are compared.
  const candidates = people.filter((p) => (name && (firstOf(p.name) === firstOf(name) || (lastOf(name) && lastOf(p.name) === lastOf(name)))));
  let best: (Outcome & { score: number }) | null = null;
  const rank = (d: Decision | 'known') => (d === 'link' ? 2 : d === 'hold' ? 1 : 0);
  for (const p of candidates) {
    const s = scorePair(m, { name: p.name, email: p.emails[0] ?? null }, ctx(name || p.name));
    if (!best || rank(s.decision) > rank(best.decision) || (rank(s.decision) === rank(best.decision) && s.score > best.score)) {
      best = { mention: m, decision: s.decision, personId: s.decision === 'separate' ? null : p.id, signals: s.signals, score: s.score };
    }
  }
  return best && best.decision !== 'separate' ? best : { mention: m, decision: 'separate', personId: null, signals: ['no plausible match: a new person'] };
}

export async function loadPeople(userId: string, db: typeof supabase = supabase): Promise<KnownPerson[]> {
  const ents = await selectAll<{ id: string; canonical_name: string }>((f, t) => db.from(Tables.ENTITIES).select('id,canonical_name').eq('user_id', userId).eq('entity_type', 'person').order('id').range(f, t));
  const aliases = await selectAll<{ entity_id: string; namespace: string; alias: string }>((f, t) => db.from(Tables.ENTITY_ALIASES).select('entity_id,namespace,alias').eq('user_id', userId).like('namespace', 'email%').order('id').range(f, t));
  const emails = new Map<string, string[]>();
  for (const a of aliases) (emails.get(a.entity_id) ?? emails.set(a.entity_id, []).get(a.entity_id)!).push(a.alias.toLowerCase());
  return ents.map((e) => ({ id: e.id, name: e.canonical_name, emails: emails.get(e.id) ?? [] }));
}

/** Calendar attendees and non-automated mail senders, one mention per distinct person. */
export async function loadMentions(userId: string, db: typeof supabase = supabase): Promise<Mention[]> {
  const out = new Map<string, Mention>();
  const add = (m: Mention, source: string) => {
    const key = (m.email ?? m.name ?? '').toLowerCase();
    if (!key || out.has(key)) return;
    out.set(key, { ...m, source });
  };
  const cal = await selectAll<{ source_item_id: string | null }>((f, t) => db.from(Tables.RAW_CONTENT).select('source_item_id').eq('user_id', userId).eq('content_type', 'calendar').order('id').range(f, t));
  for (const part of chunks(cal.map((r) => r.source_item_id).filter(Boolean) as string[])) {
    const { data } = await db.from(Tables.SOURCE_ITEMS).select('normalized_data').in('id', part);
    for (const s of (data ?? []) as Array<{ normalized_data: { attendees?: Array<{ name: string | null; email: string | null }> } | null }>) {
      for (const a of s.normalized_data?.attendees ?? []) add({ name: a.name, email: a.email?.toLowerCase() ?? null }, 'calendar');
    }
  }
  const mail = await selectAll<{ content: string; metadata: Record<string, unknown> | null; trust_class: string | null }>((f, t) =>
    db.from(Tables.RAW_CONTENT).select('content,metadata,trust_class').eq('user_id', userId).eq('content_type', 'gmail').order('id').range(f, t));
  for (const r of mail) {
    if (r.trust_class === 'automated' || r.trust_class === 'own_words') continue;
    const from = typeof r.metadata?.from === 'string' ? r.metadata.from : /^From:\s*(.+)$/m.exec(r.content ?? '')?.[1];
    const p = parseAddress(from);
    if (p.email || p.name) add({ name: p.name, email: p.email }, 'gmail');
  }
  return [...out.values()];
}

export async function dryRunResolution(userId: string, db: typeof supabase = supabase) {
  const [people, mentions] = await Promise.all([loadPeople(userId, db), loadMentions(userId, db)]);
  const outcomes = mentions.map((m) => resolveMention(m, people));
  const count = (d: string) => outcomes.filter((o) => o.decision === d).length;
  return { knownPeople: people.length, mentions: mentions.length, alreadyKnown: count('known'), link: count('link'), hold: count('hold'), newPeople: count('separate'), outcomes };
}

/**
 * People named in writing vs the same people in contacts/mail/calendar (W2).
 * Found 19 Oct: the 555 people are 300 from contacts, 211 named in writing and
 * a few from calendars, and the writing ones were never connected to the rest.
 * Each writing-only person is scored against people with a contact identity.
 */
export async function dryRunWritingToContacts(userId: string, db: typeof supabase = supabase) {
  const ents = await selectAll<{ id: string; canonical_name: string }>((f, t) => db.from(Tables.ENTITIES).select('id,canonical_name').eq('user_id', userId).eq('entity_type', 'person').order('id').range(f, t));
  const aliases = await selectAll<{ entity_id: string; namespace: string; alias: string }>((f, t) => db.from(Tables.ENTITY_ALIASES).select('entity_id,namespace,alias').eq('user_id', userId).order('id').range(f, t));
  const ns = new Map<string, Set<string>>();
  const emailOf = new Map<string, string>();
  for (const a of aliases) {
    (ns.get(a.entity_id) ?? ns.set(a.entity_id, new Set()).get(a.entity_id)!).add(a.namespace);
    if (a.namespace.startsWith('email')) emailOf.set(a.entity_id, a.alias.toLowerCase());
  }
  const writingOnly = ents.filter((e) => { const s = ns.get(e.id); return s && [...s].every((n) => n === 'journal:name'); });
  const withIdentity = ents.filter((e) => { const s = ns.get(e.id); return s && [...s].some((n) => n !== 'journal:name'); })
    .map((e) => ({ id: e.id, name: e.canonical_name, emails: emailOf.has(e.id) ? [emailOf.get(e.id)!] : [] }));
  const outcomes = writingOnly.map((e) => resolveMention({ name: e.canonical_name, source: 'journal' }, withIdentity));
  const count = (d: string) => outcomes.filter((o) => o.decision === d).length;
  return { writingOnly: writingOnly.length, contactPeople: withIdentity.length, link: count('link'), hold: count('hold'), noMatch: count('separate'), outcomes };
}
