import { jsonChatCompletion } from '../services/openai';
import { INGESTION_SYSTEM_PROMPT } from '../prompts/ingestion';
import type { Trace } from '../pipelines/trace';
import type {
  DbGoal,
  DbInsight,
  DbRawContent,
  IngestionResult,
  UserUnderstandingDocument,
} from '../types';

/**
 * Long-form writing the user actually sat down to produce is the richest
 * evidence there is. A brain dump runs well past 4,000 characters, and
 * truncating it silently loses whatever they got to last -- usually the part
 * they were working up to. Structured connector payloads stay capped because
 * they are repetitive and cheap to sample.
 */
const LONGFORM_TYPES = new Set([
  'journal_entry', 'text_entry', 'voice_journal', 'voice_recording', 'google_docs',
]);

/**
 * How many characters of one entry actually reach the model.
 *
 * Exported because the batcher in pipelines/ingest.ts has to agree with it. It
 * previously carried its own copy of these numbers, drifted to a quarter of the
 * real value, and so packed batches four times larger than it believed --
 * putting every request over the account's tokens-per-minute ceiling. A batcher
 * that cannot measure what it is sending will always eventually send too much,
 * so there is now one definition and both sides read it.
 */
export type Authorship = 'self' | 'other' | 'unknown';

/**
 * Whose words these are, when the row does not say.
 *
 * Kept as a fallback for rows written before authorship was recorded. New rows
 * carry the column; this only fills the gap, and it errs toward `unknown`,
 * because assuming the user wrote something they merely collected is the
 * failure this whole idea exists to prevent.
 */
const SELF_AUTHORED = new Set([
  'text_entry', 'journal_entry', 'voice_recording', 'voice_journal',
  'video_entry', 'onboarding_profile',
]);
const NOT_WRITING = new Set([
  'healthkit', 'screen_time', 'calendar', 'apple_music', 'photos', 'contacts',
]);

export function inferAuthorship(contentType: string): Authorship {
  if (SELF_AUTHORED.has(contentType)) return 'self';
  if (NOT_WRITING.has(contentType)) return 'other';
  return 'unknown';
}

/** The line that tells the model how to read a block. */
export function authorshipLabel(a: Authorship): string {
  switch (a) {
    case 'self':
      return 'WRITTEN BY THE USER — their own words';
    case 'other':
      return 'NOT WRITTEN BY THE USER — a third party or a device reading. Context only: never attribute any statement here to the user';
    default:
      return 'AUTHOR UNKNOWN — collected material that may or may not be the user\'s writing. Do not attribute statements here to the user unless the text itself makes their authorship explicit';
  }
}

export function contentCharLimit(contentType: string): number {
  if (contentType === 'onboarding_profile') return 20000;
  return LONGFORM_TYPES.has(contentType) ? 16000 : 4000;
}

interface IngestionInput {
  newRawContent: DbRawContent[];
  recentInsights: DbInsight[];
  activeGoals: DbGoal[];
  openGoalCandidates: { id: string; title: string; description: string | null }[];
  /** Latest User Understanding Document (if any) — lets the agent avoid re-deriving known truths. */
  currentDocument: UserUnderstandingDocument | null;
  trace?: Trace;
}

type PromptContext = Pick<
  IngestionInput,
  'recentInsights' | 'activeGoals' | 'openGoalCandidates' | 'currentDocument'
>;

/**
 * Everything in the prompt that is NOT the raw content: the document block,
 * goals, recent insights, open candidates.
 *
 * Exported so the batcher can measure the real fixed cost of a call instead of
 * estimating it. The first attempt at that estimate ran JSON.stringify over
 * these objects and came back with 614,896 tokens -- the stored document and
 * the full insight rows are far larger than what is actually rendered here,
 * where insights are capped at 25 and reduced to a line each. That estimate
 * collapsed the content budget to its floor and turned one call into 411.
 *
 * Rendering it once, the way it is actually sent, removes the guess.
 */
export function renderPromptContext(input: PromptContext): string {
  const goalLines = input.activeGoals.map(
    (g) => `- [${g.id}] "${g.title}"${g.description ? `: ${g.description}` : ''}`
  );

  const insightLines = input.recentInsights
    .slice(0, 25)
    .map(
      (i) =>
        `- (${i.created_at.slice(0, 10)}) "${i.title}": ${i.content}\n    Goal: ${i.goal_id}`
    );

  const candidateLines = input.openGoalCandidates.map(
    (c) => `- [${c.id}] "${c.title}"${c.description ? `: ${c.description}` : ''}`
  );

  return `${formatDocumentForAgent(input.currentDocument)}

# Active Goals
${goalLines.join('\n') || '(none — propose goal candidates freely)'}

# Recent Insights (last 2-4 weeks, for context only)
${insightLines.join('\n') || '(none)'}

# Open Goal Candidates (already-noticed patterns awaiting user confirmation)
${candidateLines.join('\n') || '(none)'}`;
}

export async function runIngestionAgent(input: IngestionInput): Promise<IngestionResult> {
  const goalLines = input.activeGoals.map(
    (g) => `- [${g.id}] "${g.title}"${g.description ? `: ${g.description}` : ''}`
  );

  const insightLines = input.recentInsights
    .slice(0, 25)
    .map(
      (i) =>
        `- (${i.created_at.slice(0, 10)}) "${i.title}": ${i.content}\n    Goal: ${i.goal_id}`
    );

  const candidateLines = input.openGoalCandidates.map(
    (c) => `- [${c.id}] "${c.title}"${c.description ? `: ${c.description}` : ''}`
  );

  const onboardingBlocks = input.newRawContent.filter(
    (rc) => rc.content_type === 'onboarding_profile'
  );

  const rawBlocks = input.newRawContent.map((rc, idx) => {
    const date = rc.content_date ?? rc.created_at;
    const isOnboarding = rc.content_type === 'onboarding_profile';
    const limit = contentCharLimit(rc.content_type);
    const label = isOnboarding ? 'FOUNDATIONAL ONBOARDING PROFILE' : 'Raw content';
    const authorship = (rc.authorship as Authorship | null) ?? inferAuthorship(rc.content_type);

    const body = rc.content.slice(0, limit);
    if (rc.content.length > limit) {
      // Never silent. A dropped tail is a dropped fact.
      console.warn(
        `[ingestion] TRUNCATED ${rc.content_type} ${rc.id}: ${rc.content.length} chars -> ${limit}. ` +
          `${rc.content.length - limit} characters were not analysed.`
      );
    }
    return `### [index=${idx}] ${label} [${rc.id}] (type: ${rc.content_type}, date: ${date})\n[AUTHORSHIP] ${authorshipLabel(authorship)}\n${body}`;
  });

  const onboardingInstruction =
    onboardingBlocks.length > 0
      ? `# Onboarding Priority
The NEW content includes the user's onboarding answers. Treat this as the richest evidence you'll ever get. Produce 6–12 identity inferences from it. Do not gate on "needs 2+ observations".`
      : '';

  const documentBlock = formatDocumentForAgent(input.currentDocument);

  const userMessage = `${documentBlock}

${onboardingInstruction}

# Active Goals
${goalLines.join('\n') || '(none — propose goal candidates freely)'}

# Recent Insights (last 2-4 weeks, for context only)
${insightLines.join('\n') || '(none)'}

# Open Goal Candidates (already-noticed patterns awaiting user confirmation)
${candidateLines.join('\n') || '(none)'}

# NEW Raw Content to Process
${rawBlocks.join('\n\n---\n\n') || '(nothing new — return empty arrays)'}

Extract identity_inferences first, then observations, insights, and any goal_candidates from the NEW raw content above. Use raw_content indexes (shown in each ### heading) to cite evidence in both identity_inferences.supporting_raw_content_indexes and observations.supporting_raw_content_indexes.`;

  const { data, usage } = await jsonChatCompletion<IngestionResult>(
    INGESTION_SYSTEM_PROMPT,
    userMessage,
    { temperature: 0.25, maxTokens: 8000 }
  );

  input.trace?.addCost({
    openai_tokens_input: usage.promptTokens,
    openai_tokens_output: usage.completionTokens,
  });

  return {
    fact_candidates: data.fact_candidates ?? [],
    identity_inferences: data.identity_inferences ?? [],
    observations: data.observations ?? [],
    insights: data.insights ?? [],
    goal_candidates: data.goal_candidates ?? [],
    processingNotes: data.processingNotes,
  };
}

function formatDocumentForAgent(doc: UserUnderstandingDocument | null): string {
  if (!doc) {
    return `# Current User Understanding Document
(none yet — this is the first ingestion. Generate identity inferences freely; nothing to deduplicate against.)`;
  }

  const goalsBlock = doc.active_goals
    .map((g) => `  - "${g.title}" — ${g.what_its_really_about}`)
    .join('\n');
  const tensionsBlock = doc.live_tensions.map((t) => `  - ${t}`).join('\n');
  const emergingBlock = doc.emerging_dimensions
    .map((d) => `  - [${d.label}] ${d.content}`)
    .join('\n');

  return `# Current User Understanding Document
This is what we already believe about the user. Do NOT duplicate these claims. Only add identity inferences that REFINE, CORROBORATE with new evidence, CONTRADICT, or open up something NEW.

## Identity Core
${doc.identity_core || '(empty)'}

## Active Goals
${goalsBlock || '  (none)'}

## Behavioral Patterns
${doc.behavioral_patterns || '(empty)'}

## Emotional Baseline
${doc.emotional_baseline || '(empty)'}

## Live Tensions
${tensionsBlock || '  (none)'}

## Track Record
${doc.track_record || '(empty)'}

## Forward Focus
${doc.forward_focus || '(empty)'}

## Emerging Dimensions
${emergingBlock || '  (none)'}`;
}
