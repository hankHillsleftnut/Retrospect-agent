/**
 * A passive sensor reporting zero is reporting that it measured nothing.
 *
 * Found on 18 October 2026: 746 of the founder's 749 daily HealthKit summaries
 * read `Sleep: 0.0 hours`, while steps and heart rate on the same days were
 * real. Nothing was measuring sleep. But the model was shown "Sleep: 0.0 hours"
 * and did the reasonable thing with it -- it believed it. The live portrait came
 * to say, in eight separate sentences, that he was "logging repeated zero-sleep
 * nights" and that "the gap between intention and behavior has" widened.
 *
 * That is the product passing judgement on someone's follow-through, about their
 * health, from a sync defect. It is the precise failure the claim ladder exists
 * to prevent: something unmeasured presented as something observed.
 *
 * The rule here: in a health summary, a reading of exactly zero means "not
 * recorded". Not because zero is impossible for every field -- someone can
 * genuinely log no mindfulness -- but because a passive sensor cannot tell "you
 * did none" from "I saw nothing", and only the second is ever safe to assume.
 * A heart rate of 0 BPM makes the point on its own.
 *
 * Applied only to what the model is shown, never to the stored row: raw_content
 * is the immutable source. And because fact extraction verifies every quote
 * against the original text, a quote of a rewritten line cannot match -- so this
 * cannot manufacture a fact, including one about a non-measurement.
 */

/** A labelled reading whose value is zero: "Sleep: 0.0 hours", "Steps: 0". */
const ZERO_READING = /^(\s*[^:\n]+:\s*)0+(?:\.0+)?(?:\s*[A-Za-z%]+)?[ \t]*$/gm;

export function normalizeHealthSummary(text: string): string {
  return text.replace(ZERO_READING, (_line, label: string) => `${label}not recorded`);
}

/** Whether a content type is a passive health summary this applies to. */
export function isHealthSummary(contentType: string): boolean {
  return contentType === 'healthkit';
}
