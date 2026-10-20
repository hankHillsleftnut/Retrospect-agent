/**
 * Goal 18's deterministic rules for a conversation reply. Pure.
 * See approach-calibration.md, goal 18.
 */

// Crude stemming so "stayed" and "staying" count as the same word.
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
const STOP = new Set(['the', 'and', 'that', 'this', 'with', 'you', 'your', 'for', 'was', 'are', 'but', 'have', 'has', 'had', 'not', 'just', 'like', 'from', 'about', 'it\'s', 'i\'m', 'what', 'when', 'were', 'been', 'they', 'them', 'there', 'their', 'then', 'than', 'into', 'out', 'all', 'can', 'get', 'got', 'did', 'does', 'really', 'very', 'some']);
const FRAMED = /\b(i notice|i noticed|it seems|it sounds like|sounds like|it looks like|i'm hearing|what i'm hearing|it appears|interesting(ly)?|i see that|you seem)\b/i;

/**
 * "Never restates what you just told it as if it discovered it": a sentence
 * framed as an observation whose content words are mostly the person's own
 * from today. Echoing to answer a question is fine; presenting it as insight isn't.
 */
export function restatesAsDiscovery(sentence: string, theirWordsToday: string[]): boolean {
  if (!FRAMED.test(sentence)) return false;
  // The framing ("it seems") isn't content; what's left is compared with their words.
  const mine = words(sentence.replace(FRAMED, ' '));
  if (mine.length < 3) return false;
  const theirs = new Set(theirWordsToday.flatMap(words));
  return mine.filter((w) => theirs.has(w)).length / mine.length >= 0.6;
}

/** Bounded length: about twice their message, 1 to 4 sentences, never a monologue. */
export function sentenceBudget(theirMessage: string): number {
  const theirWords = theirMessage.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.min(4, Math.ceil((theirWords * 2) / 20)));
}

export interface Revealable { kind: 'answer' | 'pattern' | 'saved' | 'item' | 'fact'; id: string; silentDomain?: boolean; flagged?: boolean; severity?: string; trust?: string | null }

/**
 * Context rules (CIMemories, ICLR 2026: prompts don't stop leaks, so rules do).
 * Unasked, nothing from a silent domain, nothing lint has flagged, no
 * extreme-severity pattern, no saved link; and never someone else's or an
 * automated sender's words as a fact about them.
 */
export function mayReveal(x: Revealable, theyAsked: boolean): boolean {
  if (x.flagged) return false;
  if (x.trust === 'automated' || x.trust === 'third_party') return false;
  if (theyAsked) return true;
  if (x.silentDomain) return false;
  if (x.severity === 'extreme') return false;
  if (x.kind === 'saved') return false;
  return true;
}
