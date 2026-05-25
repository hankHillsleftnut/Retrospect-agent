import { openai } from './openai';
import { config } from '../config';

const MAX_BATCH = 64;

export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: text,
  });
  return res.data[0]!.embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const res = await openai.embeddings.create({
      model: config.openai.embeddingModel,
      input: batch,
    });
    for (const item of res.data) out.push(item.embedding);
  }
  return out;
}

/**
 * Format a number[] embedding for Supabase's vector column.
 * Supabase accepts the array directly, but if you need to pass a literal
 * pgvector string this is the helper.
 */
export function asPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Parse a pgvector value (which can come back as string or number[]).
 */
export function parseEmbedding(value: number[] | string | null | undefined): number[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  try {
    const trimmed = value.replace(/^\[|\]$/g, '');
    return trimmed.split(',').map(Number);
  } catch {
    return null;
  }
}
