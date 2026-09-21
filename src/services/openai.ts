import OpenAI from 'openai';
import { config } from '../config';

export const openai = new OpenAI({ apiKey: config.openai.apiKey });

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  responseFormat?: 'json_object' | 'text';
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * A 429 means one of two opposite things, and they need opposite responses.
 *
 *   "you are going too fast"  -> wait, then send the same request again
 *   "this request is too big" -> waiting changes nothing; it must be split
 *
 * Both arrive as status 429, and treating the second as the first is what made
 * the ingestion failures permanent: the same oversized batch was resent three
 * times, refused three times, and the entries were marked failed forever.
 */
export class RequestTooLargeError extends Error {
  readonly requested?: number;
  readonly limit?: number;

  constructor(message: string, requested?: number, limit?: number) {
    super(message);
    this.name = 'RequestTooLargeError';
    this.requested = requested;
    this.limit = limit;
  }
}

/**
 * Distinguishes the two. OpenAI phrases the size refusal as "Request too large"
 * and includes both figures, so when they are present we can say precisely how
 * far over the request was.
 */
export function classifyRateLimit(err: unknown): 'too_big' | 'too_fast' | null {
  if (!(err instanceof OpenAI.APIError) || err.status !== 429) return null;
  const msg = err.message ?? '';
  return /request too large|reduce the length|maximum context length/i.test(msg)
    ? 'too_big'
    : 'too_fast';
}

function parseSizeFigures(msg: string): { requested?: number; limit?: number } {
  const limit = msg.match(/Limit (\d+)/i);
  const requested = msg.match(/Requested (\d+)/i);
  return {
    limit: limit ? Number(limit[1]) : undefined,
    requested: requested ? Number(requested[1]) : undefined,
  };
}

// Retry on 429 (rate limit) with the wait time OpenAI tells us to use.
async function withRateLimitRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const kind = classifyRateLimit(err);

      // Too big: retrying identical bytes can only fail identically. Surface it
      // as its own error so the caller can split the work and try again, rather
      // than burning the remaining attempts on a request that cannot succeed.
      if (kind === 'too_big') {
        const msg = err instanceof Error ? err.message : 'request too large';
        const { requested, limit } = parseSizeFigures(msg);
        console.warn(
          `[openai] request too large${requested && limit ? ` (${requested} tokens against a ${limit} limit)` : ''} — not retrying; caller should split`,
        );
        throw new RequestTooLargeError(msg, requested, limit);
      }

      const isRateLimit = kind === 'too_fast';
      if (!isRateLimit || attempt === maxRetries) throw err;

      // Parse "Please try again in Xs" from the error message
      const msg = err instanceof Error ? err.message : '';
      const match = msg.match(/try again in ([\d.]+)s/i);
      const waitMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 500 : 10000;

      console.warn(`[openai] 429 rate limit — waiting ${waitMs}ms then retrying (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error('unreachable');
}

export async function chatCompletion(
  system: string,
  user: string,
  options: ChatOptions = {}
): Promise<{ text: string; usage: ChatUsage }> {
  return withRateLimitRetry(async () => {
    const completion = await openai.chat.completions.create({
      model: options.model ?? config.openai.chatModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: options.temperature ?? 0.5,
      max_tokens: options.maxTokens ?? 4096,
      ...(options.responseFormat === 'json_object'
        ? { response_format: { type: 'json_object' } }
        : {}),
    });
    const text = completion.choices[0]?.message?.content ?? '';
    return {
      text,
      usage: {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  });
}

export async function jsonChatCompletion<T>(
  system: string,
  user: string,
  options: Omit<ChatOptions, 'responseFormat'> = {}
): Promise<{ data: T; usage: ChatUsage }> {
  const { text, usage } = await chatCompletion(system, user, {
    ...options,
    responseFormat: 'json_object',
  });
  try {
    return { data: JSON.parse(text) as T, usage };
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from model. Raw text:\n${text.slice(0, 500)}\nError: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
