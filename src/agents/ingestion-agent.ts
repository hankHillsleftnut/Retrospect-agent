import { jsonChatCompletion } from '../services/openai';
import { INGESTION_SYSTEM_PROMPT } from '../prompts/ingestion';
import type { Trace } from '../pipelines/trace';
import type {
  DbGoal,
  DbInsight,
  DbRawContent,
  IngestionResult,
} from '../types';

interface IngestionInput {
  newRawContent: DbRawContent[];
  recentInsights: DbInsight[];
  activeGoals: DbGoal[];
  openGoalCandidates: { id: string; title: string; description: string | null }[];
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

  const rawBlocks = input.newRawContent.map((rc) => {
    const date = rc.content_date ?? rc.created_at;
    const isOnboarding = rc.content_type === 'onboarding_profile';
    const limit = isOnboarding ? 10000 : 4000;
    const label = isOnboarding ? 'FOUNDATIONAL ONBOARDING PROFILE' : 'Raw content';
    return `### ${label} [${rc.id}] (type: ${rc.content_type}, date: ${date})\n${rc.content.slice(0, limit)}`;
  });

  const onboardingInstruction =
    onboardingBlocks.length > 0
      ? `# Onboarding Priority
The NEW content includes the user's onboarding answers. Treat these as foundational: preserve explicit goals, preferences, fears, motivation, identity language, and desired support style as durable observations and goal candidates. This may be the first podcast experience, so the extracted structure should make Retrospect feel like it truly listened.`
      : '';

  const userMessage = `${onboardingInstruction}

# Active Goals
${goalLines.join('\n') || '(none — propose goal candidates freely)'}

# Recent Insights (last 2-4 weeks, for context only)
${insightLines.join('\n') || '(none)'}

# Open Goal Candidates (already-noticed patterns awaiting user confirmation)
${candidateLines.join('\n') || '(none)'}

# NEW Raw Content to Process
${rawBlocks.join('\n\n---\n\n') || '(nothing new — return empty arrays)'}

Extract observations, insights, and any goal_candidates from the NEW raw content above.`;

  const { data, usage } = await jsonChatCompletion<IngestionResult>(
    INGESTION_SYSTEM_PROMPT,
    userMessage,
    { temperature: 0.25, maxTokens: 6000 }
  );

  input.trace?.addCost({
    openai_tokens_input: usage.promptTokens,
    openai_tokens_output: usage.completionTokens,
  });

  return {
    observations: data.observations ?? [],
    insights: data.insights ?? [],
    goal_candidates: data.goal_candidates ?? [],
    processingNotes: data.processingNotes,
  };
}
