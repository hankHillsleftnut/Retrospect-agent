import { research } from '../../services/perplexity';
import type { AgentTool } from './types';

interface Args {
  query: string;
  context?: string;
}

export const internetResearchTool: AgentTool<
  Args,
  { answer: string; citations: { source: string; url?: string }[] }
> = {
  name: 'internet_research',
  description:
    'Use Perplexity to look up external information — research papers, frameworks, statistics, expert opinions — when you need to ground a point in something beyond the user\'s personal data. Use sparingly and only when it would meaningfully strengthen the episode.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A focused research question' },
      context: {
        type: 'string',
        description: 'Optional 1-sentence context to help the research model understand what you need',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const result = await research(
      args.query,
      args.context ??
        'You are a research assistant for a personal growth podcast. Answer concisely with citations.'
    );
    return { answer: result.answer, citations: result.citations };
  },
};
