import OpenAI from 'openai';
import { openai } from '../services/openai';
import { config } from '../config';
import { ALL_TOOLS, TOOLS_BY_NAME, asOpenAITool } from './tools';
import { HISTORICAL_AGENT_SYSTEM_PROMPT } from '../prompts/historical-agent-system';
import type { Trace } from '../pipelines/trace';
import type { OutlineV1, OutlineV2, DbRawContent, DbUserPreferences, AgentToolCall, VoicePersona } from '../types';

interface AgentInput {
  userId: string;
  outlineV1: OutlineV1;
  preferences: DbUserPreferences | null;
  unprocessedFeedback: { date: string; text: string }[];
  onboardingProfile?: DbRawContent | null;
  voicePersona?: VoicePersona | null;
  trace?: Trace;
  maxIterations?: number;
}

const TOOL_DEFS = ALL_TOOLS.map((t) => asOpenAITool(t as any));

/**
 * Run Cook B — the historical-enrichment agent.
 *
 * Loops over OpenAI tool-calling up to maxIterations.
 * Records every tool call to the trace.
 * Returns the enriched OutlineV2 when the model finally responds with content (no tool calls).
 */
export async function runPodcastAgent(input: AgentInput): Promise<OutlineV2> {
  const maxIterations = input.maxIterations ?? config.pipeline.agentMaxIterations;

  const prefsBlock = input.preferences
    ? `# User Preferences
tone: ${input.preferences.tone ?? '(none)'}
trusted_voice_description: ${input.preferences.trusted_voice_description ?? '(none)'}
focus_areas: ${input.preferences.focus_areas.join(', ') || '(none)'}
avoid_topics: ${input.preferences.avoid_topics.join(', ') || '(none)'}
directives (most recent first):
${input.preferences.directives
  .slice(-10)
  .reverse()
  .map((d) => `  - (${d.date.slice(0, 10)}) ${d.text}`)
  .join('\n') || '  (none)'}`
    : '# User Preferences\n(none on file yet)';

  const feedbackBlock =
    input.unprocessedFeedback.length > 0
      ? `# Unprocessed Feedback (from recent episodes)
${input.unprocessedFeedback.map((f) => `  - (${f.date.slice(0, 10)}) ${f.text}`).join('\n')}`
      : '';

  const foundationBlock = formatOnboardingFoundation(
    input.onboardingProfile ?? null,
    input.voicePersona ?? null
  );

  const userMessage = `${foundationBlock}

${prefsBlock}

${feedbackBlock}

# Cook A's Current-Context Outline
${JSON.stringify(input.outlineV1, null, 2)}

Use your tools to enrich this outline with historical context. Treat the onboarding profile as the user's identity and intent foundation: it should guide what history you search for, which links feel meaningful, and what unresolved pattern is worth helping the listener notice. Then return the final OutlineV2 JSON.`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: HISTORICAL_AGENT_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  let finalContent: string | null = null;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (let iter = 1; iter <= maxIterations; iter++) {
    const completion = await openai.chat.completions.create({
      model: config.openai.chatModel,
      messages,
      tools: TOOL_DEFS,
      tool_choice: iter === maxIterations ? 'none' : 'auto',
      temperature: 0.4,
      max_tokens: 4096,
    });

    totalPromptTokens += completion.usage?.prompt_tokens ?? 0;
    totalCompletionTokens += completion.usage?.completion_tokens ?? 0;

    const choice = completion.choices[0]!;
    const msg = choice.message;

    // No tool calls → model has produced its final output.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      finalContent = msg.content ?? '';
      messages.push({ role: 'assistant', content: finalContent });
      break;
    }

    // Push assistant message (with tool_calls) before tool responses.
    messages.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
    });

    // Execute each tool call sequentially.
    for (const call of msg.tool_calls) {
      const name = call.function.name;
      const argStr = call.function.arguments || '{}';
      let args: any;
      try {
        args = JSON.parse(argStr);
      } catch {
        args = {};
      }

      const tool = TOOLS_BY_NAME[name];
      const startedAt = Date.now();
      let result: unknown;
      let preview: string;
      let count = 0;

      if (!tool) {
        result = { error: `Unknown tool: ${name}` };
        preview = JSON.stringify(result);
      } else {
        try {
          result = await tool.execute(args, { userId: input.userId });
          count = (result as any).count ?? (Array.isArray((result as any).hits) ? (result as any).hits.length : 0);
          preview = previewJson(result);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
          preview = JSON.stringify(result);
        }
      }

      const duration = Date.now() - startedAt;
      const traceEntry: AgentToolCall = {
        iteration: iter,
        tool: name,
        arguments: args,
        result_preview: preview,
        result_count: count,
        duration_ms: duration,
        ts: new Date().toISOString(),
      };
      input.trace?.addToolCall(traceEntry);
      if (name === 'internet_research') {
        input.trace?.addCost({ perplexity_calls: 1 });
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  input.trace?.addCost({
    openai_tokens_input: totalPromptTokens,
    openai_tokens_output: totalCompletionTokens,
  });

  if (!finalContent) {
    throw new Error(
      `Agent did not produce a final response after ${maxIterations} iterations.`
    );
  }

  // Pull JSON out of the final content (the model is asked to return raw JSON).
  const outlineV2 = parseAgentJson(finalContent, input.outlineV1);
  return outlineV2;
}

function formatOnboardingFoundation(
  onboardingProfile: DbRawContent | null,
  voicePersona: VoicePersona | null
): string {
  if (!onboardingProfile) {
    return `# Foundational Onboarding Profile
(none yet)`;
  }

  const metadata = onboardingProfile.metadata
    ? `\nmetadata: ${JSON.stringify(onboardingProfile.metadata).slice(0, 1200)}`
    : '';

  return `# Foundational Onboarding Profile
This is the user's first self-description inside Retrospect. It is the clearest available statement of what they care about, what they want, what they are afraid of, and what kind of reflection may feel useful.
Use this as a lens for historical enrichment. Do not simply repeat it back; connect it to concrete evidence from tools and current context.
voice_persona: ${voicePersona ?? '(not set)'}
raw_content_id: ${onboardingProfile.id}
created_at: ${onboardingProfile.created_at}${metadata}

${onboardingProfile.content.slice(0, 8000)}`;
}

function previewJson(value: unknown): string {
  const s = JSON.stringify(value);
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}

function parseAgentJson(content: string, fallback: OutlineV1): OutlineV2 {
  const trimmed = content.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    console.warn('[podcast-agent] No JSON in final content. Falling back to OutlineV1.');
    return {
      ...fallback,
      historicalConnections: [],
      notRealizedYet: [],
      researchFindings: [],
      toolCallsSummary: 'Agent returned no JSON; using Cook A outline directly.',
    };
  }
  const jsonStr = trimmed.slice(jsonStart, jsonEnd + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      theme: parsed.theme ?? fallback.theme,
      segments: parsed.segments ?? fallback.segments,
      estimatedMinutes: parsed.estimatedMinutes ?? fallback.estimatedMinutes,
      historicalConnections: parsed.historicalConnections ?? [],
      notRealizedYet: parsed.notRealizedYet ?? [],
      researchFindings: parsed.researchFindings ?? [],
      toolCallsSummary: parsed.toolCallsSummary,
    };
  } catch (err) {
    console.warn(
      `[podcast-agent] Failed to parse final JSON (${err instanceof Error ? err.message : err}). Falling back.`
    );
    return {
      ...fallback,
      historicalConnections: [],
      notRealizedYet: [],
      researchFindings: [],
      toolCallsSummary: 'Agent returned malformed JSON; using Cook A outline directly.',
    };
  }
}
