import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { ALL_TOOLS, TOOLS_BY_NAME, asAnthropicTool } from './tools';
import { HISTORICAL_AGENT_SYSTEM_PROMPT } from '../prompts/historical-agent-system';
import type { Trace } from '../pipelines/trace';
import type { OutlineV1, OutlineV2, DbRawContent, DbUserPreferences, AgentToolCall, VoicePersona } from '../types';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set — Cook B cannot run.');
    }
    _client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return _client;
}

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

const TOOL_DEFS = ALL_TOOLS.map((t) => asAnthropicTool(t as Parameters<typeof asAnthropicTool>[0]));

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

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let finalContent: string | null = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iter = 1; iter <= maxIterations; iter++) {
    const response = await client().messages.create({
      model: config.anthropic.cookBModel,
      system: HISTORICAL_AGENT_SYSTEM_PROMPT,
      messages,
      tools: TOOL_DEFS,
      tool_choice: iter === maxIterations ? { type: 'none' } : { type: 'auto' },
      temperature: 0.4,
      max_tokens: 4096,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Collect text and tool_use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );

    // No tool calls → final response
    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      finalContent = textBlock?.text ?? '';
      break;
    }

    // Push assistant turn with all content blocks
    messages.push({ role: 'assistant', content: response.content });

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const tool = TOOLS_BY_NAME[toolUse.name];
      const startedAt = Date.now();
      let result: unknown;
      let preview: string;
      let count = 0;

      if (!tool) {
        result = { error: `Unknown tool: ${toolUse.name}` };
        preview = JSON.stringify(result);
      } else {
        try {
          result = await tool.execute(toolUse.input as Record<string, unknown>, { userId: input.userId });
          count = (result as { count?: number }).count
            ?? (Array.isArray((result as { hits?: unknown[] }).hits) ? (result as { hits: unknown[] }).hits.length : 0);
          preview = previewJson(result);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
          preview = JSON.stringify(result);
        }
      }

      const duration = Date.now() - startedAt;
      const traceEntry: AgentToolCall = {
        iteration: iter,
        tool: toolUse.name,
        arguments: toolUse.input as Record<string, unknown>,
        result_preview: preview,
        result_count: count,
        duration_ms: duration,
        ts: new Date().toISOString(),
      };
      input.trace?.addToolCall(traceEntry);
      if (toolUse.name === 'internet_research') {
        input.trace?.addCost({ perplexity_calls: 1 });
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    // Push all tool results in a single user turn
    messages.push({ role: 'user', content: toolResults });
  }

  input.trace?.addCost({
    anthropic_tokens_input: totalInputTokens,
    anthropic_tokens_output: totalOutputTokens,
  });

  if (!finalContent) {
    throw new Error(
      `Cook B agent did not produce a final response after ${maxIterations} iterations.`
    );
  }

  return parseAgentJson(finalContent, input.outlineV1);
}

function formatOnboardingFoundation(
  onboardingProfile: DbRawContent | null,
  voicePersona: VoicePersona | null
): string {
  if (!onboardingProfile) {
    return `# Foundational Onboarding Profile\n(none yet)`;
  }
  const metadata = onboardingProfile.metadata
    ? `\nmetadata: ${JSON.stringify(onboardingProfile.metadata).slice(0, 1200)}`
    : '';
  return `# Foundational Onboarding Profile
This is the user's first self-description inside Retrospect. Use it as a lens for historical enrichment.
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
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
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
    console.warn(`[podcast-agent] Failed to parse final JSON (${err instanceof Error ? err.message : err}). Falling back.`);
    return {
      ...fallback,
      historicalConnections: [],
      notRealizedYet: [],
      researchFindings: [],
      toolCallsSummary: 'Agent returned malformed JSON; using Cook A outline directly.',
    };
  }
}
