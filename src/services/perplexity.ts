import { config } from '../config';

interface PerplexityResponse {
  choices: { message: { content: string } }[];
  citations?: string[];
  search_results?: { url: string; title?: string; snippet?: string }[];
  usage?: { total_tokens: number };
}

export interface ResearchResult {
  answer: string;
  citations: { source: string; url?: string }[];
  raw?: PerplexityResponse;
}

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';

/**
 * Single research query against Perplexity Sonar.
 * Returns an empty result if no API key is configured (useful in --dry-run / dev).
 */
export async function research(
  query: string,
  systemContext = 'You are a research assistant. Answer concisely with citations.'
): Promise<ResearchResult> {
  if (!config.perplexity.apiKey) {
    return {
      answer: `[perplexity disabled — would have researched: "${query}"]`,
      citations: [],
    };
  }

  const res = await fetch(PERPLEXITY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.perplexity.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.perplexity.model,
      messages: [
        { role: 'system', content: systemContext },
        { role: 'user', content: query },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Perplexity request failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as PerplexityResponse;
  const answer = data.choices?.[0]?.message?.content ?? '';
  const citations =
    data.search_results?.map((s) => ({ source: s.title ?? s.url, url: s.url })) ??
    (data.citations ?? []).map((url) => ({ source: url, url }));

  return { answer, citations, raw: data };
}
