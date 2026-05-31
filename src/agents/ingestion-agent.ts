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

interface IngestionInput {
  newRawContent: DbRawContent[];
  recentInsights: DbInsight[];
  activeGoals: DbGoal[];
  openGoalCandidates: { id: string; title: string; description: string | null }[];
  /** Latest User Understanding Document (if any) — lets the agent avoid re-deriving known truths. */
  currentDocument: UserUnderstandingDocument | null;
  trace?: Trace;
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
    const limit = isOnboarding ? 10000 : 4000;
    const label = isOnboarding ? 'FOUNDATIONAL ONBOARDING PROFILE' : 'Raw content';
    return `### [index=${idx}] ${label} [${rc.id}] (type: ${rc.content_type}, date: ${date})\n${rc.content.slice(0, limit)}`;
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

Extract identity_inferences first, then observations, insights, and any goal_candidates from the NEW raw content above. Use raw_content indexes (shown in each ### heading) to cite evidence in identity_inferences.supporting_raw_content_indexes.`;

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
