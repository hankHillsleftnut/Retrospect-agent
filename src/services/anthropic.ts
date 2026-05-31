import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

/**
 * Anthropic client. Lazy-constructed so the app can boot without
 * ANTHROPIC_API_KEY set — Cook 0 will fail with a clear error at call time,
 * but other pipelines (which only use OpenAI) keep working.
 */
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!config.anthropic.apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Cook 0 cannot run. ' +
          'Set ANTHROPIC_API_KEY in .env (and in Render env vars for prod).'
      );
    }
    _client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return _client;
}

export interface ClaudeOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Plain text completion. Claude doesn't have an OpenAI-style "json_object"
 * response format — JSON is enforced by prompt instruction + parse-with-retry.
 */
export async function claudeCompletion(
  system: string,
  user: string,
  options: ClaudeOptions = {}
): Promise<{ text: string; usage: ClaudeUsage }> {
  const res = await client().messages.create({
    model: options.model ?? config.anthropic.cook0Model,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 8000,
  });

  // Claude returns content blocks. For our use case (no tools) all output is text.
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    text,
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    },
  };
}

/**
 * Sibling of jsonChatCompletion from services/openai.ts.
 * Extracts the first {...} block from the response (defensive against
 * Claude wrapping JSON in prose despite instructions).
 */
export async function claudeJsonCompletion<T>(
  system: string,
  user: string,
  options: ClaudeOptions = {}
): Promise<{ data: T; usage: ClaudeUsage }> {
  const { text, usage } = await claudeCompletion(system, user, options);
  const json = extractJsonBlock(text);
  try {
    return { data: JSON.parse(json) as T, usage };
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from Claude. Raw text:\n${text.slice(0, 800)}\nError: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in Claude response. Got: ${trimmed.slice(0, 200)}`);
  }
  return trimmed.slice(start, end + 1);
}
