/**
 * Trust classes — how much a piece of evidence may say about the person.
 *
 * W1 of the target architecture (docs/second-brain/target-architecture.md §3.1).
 * Five classes, decided by where an item came from, never by what it says:
 *
 *   own_words    written or said by the person          -> may support claims about their inner life
 *   record       a log of behaviour (calendar, health)  -> what they did, never what they felt
 *   third_party  someone else's words to or about them  -> context, never their inner life
 *   automated    machine-generated: other AI assistants, receipts, notices, marketing
 *                -> may support "uses X", never a claim about them (founder, 19 Oct 2026)
 *   reference    saved for later, not about them         -> the reference bank (goal 23)
 *
 * Judged by tests/fixtures/gates/w1-trust-classes.json (bar: 100%, and zero
 * inner-life claims from anything but own words).
 */

export type TrustClass = 'own_words' | 'record' | 'third_party' | 'automated' | 'reference';

export interface TrustInput {
  content_type: string;
  authorship?: string | null;
  /** Gmail labels, when known (SENT, CATEGORY_PROMOTIONS, ...). */
  labels?: string[] | null;
  /** The sender, when known ("Name <address>"). */
  from?: string | null;
  /** Used only to find a "From:" line when the sender isn't given separately. */
  text?: string | null;
}

export interface TrustVerdict {
  trustClass: TrustClass;
  /** May this item support a claim about how they feel, think or want? */
  mayClaimInnerLife: boolean;
}

const OWN_WORDS_TYPES = new Set([
  'journal_entry', 'voice_journal', 'voice_recording', 'text_entry', 'video_entry',
  'conversation', 'onboarding_profile', 'google_docs',
]);
const RECORD_TYPES = new Set([
  'calendar', 'google_calendar', 'healthkit', 'screen_time', 'youtube', 'apple_music',
  'spotify', 'photos', 'contacts', 'reddit', 'tiktok', 'x',
]);
const REFERENCE_TYPES = new Set(['shared_link', 'reference', 'twitter_bookmarks']);
const MACHINE_CATEGORIES = ['CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];

/** Senders that are machines: no-reply addresses, digests, notices, other assistants. */
export function isAutomatedSender(from: string): boolean {
  const s = from.toLowerCase();
  const address = (s.match(/<([^>]+)>/)?.[1] ?? s).trim();
  const local = address.split('@')[0] ?? '';
  const domain = address.split('@')[1] ?? '';
  if (/(^|[._-])(no-?reply|do-?not-?reply|notifications?|alerts?|news(letter)?|digest|brief|updates?|circ|billing|receipts?|support|info|hello|team|marketing|mailer)([._-]|$)/.test(local)) return true;
  if (/(^|\.)(ai|bot)$/.test(domain.split('.')[0] ?? '') || /\.ai$/.test(domain)) return true;
  if (/\b(assistant|bot|digest|newsletter|notifications?)\b/.test(s.split('<')[0] ?? '')) return true;
  return false;
}

function senderOf(i: TrustInput): string | null {
  if (i.from) return i.from;
  const m = (i.text ?? '').match(/^From:\s*(.+)$/m);
  return m ? m[1]!.trim() : null;
}

export function classifyTrust(i: TrustInput): TrustVerdict {
  const t = i.content_type;
  const verdict = (trustClass: TrustClass): TrustVerdict => ({ trustClass, mayClaimInnerLife: trustClass === 'own_words' });

  if (REFERENCE_TYPES.has(t)) return verdict('reference');
  if (RECORD_TYPES.has(t)) return verdict('record');

  if (t === 'gmail') {
    const labels = i.labels ?? [];
    const from = senderOf(i);
    if (labels.includes('SENT') || from === 'me') return verdict('own_words');
    if (labels.some((l) => MACHINE_CATEGORIES.includes(l))) return verdict('automated');
    if (from && isAutomatedSender(from)) return verdict('automated');
    return verdict('third_party');
  }

  if (OWN_WORDS_TYPES.has(t)) {
    const a = i.authorship ?? 'self';
    return verdict(a === 'self' ? 'own_words' : 'third_party');
  }

  // Unknown types are never trusted as the person's own words.
  return verdict('third_party');
}
