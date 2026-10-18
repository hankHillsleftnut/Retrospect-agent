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
  // Newer Claude models (e.g. Opus 4.8+ / reasoning variants) reject the
  // temperature parameter. Only include it when the caller explicitly sets one.
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: options.model ?? config.anthropic.cook0Model,
    system,
    messages: [{ role: 'user', content: user }],
    max_tokens: options.maxTokens ?? 8000,
  };
  if (options.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  const res = await client().messages.create(params);

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

/**
 * The JSON object in a model's reply.
 *
 * Usually the whole reply. But a model sometimes writes a partial answer,
 * notices, and writes a corrected one after it ("Wait -- corrected full
 * output:"). Seen from Claude Sonnet 5.5 on 18 October 2026. Taking the span
 * from the first "{" to the last "}" then joins two objects into invalid JSON
 * and the whole call is lost. So: find every complete top-level object and
 * use the LAST one that parses -- the model's final word, never a merge.
 */
export function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { JSON.parse(trimmed); return trimmed; } catch { /* fall through to the scan */ }
  }
  const objects: string[] = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) { objects.push(trimmed.slice(start, i + 1)); start = -1; }
    }
  }
  for (let k = objects.length - 1; k >= 0; k--) {
    try { JSON.parse(objects[k]!); return objects[k]!; } catch { /* try the one before */ }
  }
  throw new Error(`No JSON object found in Claude response. Got: ${trimmed.slice(0, 200)}`);
}
