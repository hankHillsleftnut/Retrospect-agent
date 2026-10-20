/**
 * Are two mentions the same person? (W2, goal 4: never confuse two people.)
 *
 * Calibrated approach: Fellegi-Sunter record linkage, the standard for
 * personal records for fifty years: each field adds evidence for or against
 * (log-likelihood-style weights), and two thresholds give three bands: link,
 * hold (ask the person), separate. Founder's call, 19 Oct: STRICT. When
 * unsure, hold and ask; never guess.
 *
 * Weights and bands declared before running against the gate cases:
 *   same email +10 (decisive) · different emails -6
 *   same full name +6, +3 if no one else has it
 *   same first name, one side first-name-only: +8 if they're the only person
 *     with that first name in the data, else 0 (ambiguous)
 *   different surnames -8 · nickname + same surname +4 · seen together +2
 *   organisations: same name after dropping Inc/Corp/LLC +8, email domain
 *     matches the name +2; a person never links to an organisation
 *   link >= 8 · separate <= -4 · otherwise hold
 * Hard caps, whatever the score: a role word ("Mom", "my manager") or a
 * possibly misheard name (transcript confidence < 0.8) can only be held.
 */

export type Decision = 'link' | 'hold' | 'separate';

export interface Mention {
  name?: string | null;
  email?: string | null;
  kind?: 'person' | 'organisation';
  source?: string;
  coOccursWith?: string[];
  transcriptConfidence?: number;
}

/** What the rest of the person's data says about these names. */
export interface NameContext {
  /** How many distinct people in their data have this first name. */
  firstNameCount: number;
  /** How many distinct people have this exact full name. */
  fullNameCount: number;
}

export const LINK_AT = 8;
export const SEPARATE_AT = -4;

const ROLE_WORDS = /^(mom|mum|mother|dad|father|sister|brother|grandma|grandpa|aunt|uncle|wife|husband|partner|boyfriend|girlfriend|boss|manager|my manager|my boss|therapist|doctor|roommate|friend)$/i;
const ORG_SUFFIX = /\s*\b(inc|corp|corporation|llc|ltd|limited|co|company|gmbh|plc)\.?$/i;
const NICKNAMES: Record<string, string> = {
  alex: 'alexander', al: 'alexander', sam: 'samuel', sammy: 'samuel', chris: 'christopher', kate: 'katherine', katie: 'katherine',
  mike: 'michael', bob: 'robert', rob: 'robert', bobby: 'robert', liz: 'elizabeth', beth: 'elizabeth', will: 'william', bill: 'william',
  dan: 'daniel', danny: 'daniel', matt: 'matthew', nick: 'nicholas', tom: 'thomas', jim: 'james', jen: 'jennifer', jenny: 'jennifer',
  ben: 'benjamin', joe: 'joseph', tony: 'anthony', andy: 'andrew', drew: 'andrew', steve: 'steven', dave: 'david', ed: 'edward',
};

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const parts = (name: string | null | undefined) => norm(name).split(' ').filter(Boolean);
const canonicalFirst = (f: string) => NICKNAMES[f] ?? f;

export interface Score { decision: Decision; score: number; signals: string[] }

export function scorePair(a: Mention, b: Mention, ctx: NameContext): Score {
  const signals: string[] = [];
  let score = 0;
  const add = (w: number, why: string) => { score += w; signals.push(`${w > 0 ? '+' : ''}${w} ${why}`); };
  const ea = norm(a.email), eb = norm(b.email);
  const kindA = a.kind ?? 'person', kindB = b.kind ?? 'person';

  if (kindA !== kindB) return { decision: 'separate', score: -99, signals: ['a person is never an organisation'] };
  // The same role word twice ("Mom" and "Mom") is the same reference in the
  // person's own words; a role word against a NAME is what must be asked.
  if (ROLE_WORDS.test(norm(a.name)) && norm(a.name) === norm(b.name) && !(norm(a.email) && norm(b.email) && norm(a.email) !== norm(b.email))) {
    return { decision: 'link', score: LINK_AT, signals: ['the same role word: one reference'] };
  }

  if (ea && eb) {
    if (ea === eb) add(10, 'same email');
    else add(-6, 'different emails');
  }

  if (kindA === 'organisation') {
    const na = norm(a.name).replace(ORG_SUFFIX, ''), nb = norm(b.name).replace(ORG_SUFFIX, '');
    if (na && nb && na === nb) add(8, 'same organisation name');
    const domainOf = (e: string) => e.split('@')[1]?.split('.')[0] ?? '';
    for (const [n, e] of [[na, eb], [nb, ea]] as const) if (n && e && domainOf(e) === n.replace(/\s+/g, '')) { add(2, 'email domain matches the name'); break; }
  } else {
    const pa = parts(a.name), pb = parts(b.name);
    if (pa.length && pb.length) {
      const fa = canonicalFirst(pa[0]!), fb = canonicalFirst(pb[0]!);
      const la = pa.length > 1 ? pa[pa.length - 1] : null, lb = pb.length > 1 ? pb[pb.length - 1] : null;
      if (la && lb) {
        if (norm(a.name) === norm(b.name)) {
          add(6, 'same full name');
          if (ctx.fullNameCount <= 1) add(3, 'no one else has this name');
        } else if (la !== lb) add(-8, 'different surnames');
        else if (fa === fb) add(4, 'same person, nickname');
      } else if (fa === fb) {
        if (ctx.firstNameCount <= 1) add(8, 'the only person with this first name');
        else signals.push('0 first name shared by several people');
      }
    }
    const shared = (a.coOccursWith ?? []).filter((x) => (b.coOccursWith ?? []).includes(x));
    if (shared.length) add(2, `seen together (${shared.join(', ')})`);
  }

  let decision: Decision = score >= LINK_AT ? 'link' : score <= SEPARATE_AT ? 'separate' : 'hold';
  // Hard caps: these can be asked about, never decided.
  const roleWord = [a.name, b.name].some((n) => ROLE_WORDS.test(norm(n)));
  const misheard = [a, b].some((m) => (m.transcriptConfidence ?? 1) < 0.8);
  if (decision === 'link' && !(ea && eb && ea === eb) && (roleWord || misheard)) {
    decision = 'hold';
    signals.push(roleWord ? 'cap: a role word is not a name' : 'cap: the name may be misheard');
  }
  if (roleWord && !(ea && eb && ea === eb) && decision === 'separate') { decision = 'hold'; signals.push('cap: a role word is never separated by guesswork'); }
  return { decision, score, signals };
}
