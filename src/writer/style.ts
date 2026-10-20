/**
 * Goal 9: "calm and specific, never therapeutic-generic; it does not perform
 * empathy it cannot ground in something you said." Warmth belongs in the
 * delivery (voice, pacing); the words stay precise. Deterministic: a line
 * that is stock comfort or names a feeling the person never stated is cut,
 * like an unsupported claim. Pure.
 */

// Stock comfort: true of anyone, so it says nothing about this person.
const GENERIC: RegExp[] = [
  /\bbe (kind|gentle) (to|with) yourself\b/i,
  /\bit'?s (okay|ok|alright|normal) to (feel|be|not)\b/i,
  /\byou'?ve got this\b/i,
  /\b(healing|growth|self[- ]discovery) journey\b/i,
  /\byour journey\b/i,
  /\b(your )?feelings are (valid|real)\b/i,
  /\bgive yourself (some )?(grace|permission|space)\b/i,
  /\bself[- ]care\b/i,
  /\byou are enough\b/i,
  /\bproud of you\b/i,
  /\bhold space\b/i,
];

// Performed empathy: claims to know how it felt when the person didn't say.
const PERFORMED: RegExp[] = [
  /\bthat must (have been|be) (really |so |very )?(hard|difficult|tough|painful|exhausting|overwhelming)\b/i,
  /\bi can (only )?imagine\b/i,
  /\bi hear you\b/i,
  /\bit sounds like you'?re feeling\b/i,
  /\bi know how (hard|difficult|tough)\b/i,
];

export function styleIssue(sentence: string): string | null {
  if (GENERIC.some((r) => r.test(sentence))) return 'stock comfort, not about this person (goal 9)';
  if (PERFORMED.some((r) => r.test(sentence))) return 'empathy not grounded in anything they said (goal 9)';
  return null;
}
