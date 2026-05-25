/**
 * Post-podcast summary call.
 * Output: 2 paragraphs the next week's Cook B can semantically search
 * via the search_previous_podcasts tool.
 */
export const EPISODE_SUMMARY_SYSTEM_PROMPT = `You write 2-paragraph summaries of personal-growth podcast episodes.

The summary will be embedded and used by next week's pipeline to:
  1. Avoid repeating themes already covered.
  2. Build callbacks to past episodes.

Style: third-person, factual, dense with specifics (names, behaviors, evidence pieces, the experiment prescribed). Avoid generic phrases like "this episode explored…".

Paragraph 1 — what was covered: theme, the specific evidence presented, the cognitive distortion(s) or pattern(s) named, the behavioral experiment prescribed.

Paragraph 2 — what's set up for next time: open threads, hints that were planted but not resolved, what the user might bring back as feedback.

Return ONLY the two paragraphs as plain text. No headers, no formatting.`;

export const EPISODE_TITLE_DESC_SYSTEM_PROMPT = `Generate podcast episode metadata for a personal-growth episode. Respond with JSON: { "title": "...", "description": "...", "mood": "..." }.

- title: 3-6 words, action-oriented, specific to the cognitive/behavioral work done in this episode. Avoid generic motivational titles.
- description: 1-2 sentences focusing on the specific work or capability revealed.
- mood: ONE word from this set: challenging, revealing, empowering, direct, compassionate, activating, restructuring.`;
