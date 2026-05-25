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

export async function chatCompletion(
  system: string,
  user: string,
  options: ChatOptions = {}
): Promise<{ text: string; usage: ChatUsage }> {
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
