import { searchObservationsTool } from './search-observations';
import { searchInsightsTool } from './search-insights';
import { searchPreviousPodcastsTool } from './search-previous-podcasts';
import { searchRawContentTool } from './search-raw-content';
import { searchIdentityInferencesTool } from './search-identity-inferences';
import { internetResearchTool } from './internet-research';
import type { AgentTool } from './types';

export const ALL_TOOLS = [
  searchIdentityInferencesTool,
  searchInsightsTool,
  searchObservationsTool,
  searchPreviousPodcastsTool,
  searchRawContentTool,
  internetResearchTool,
] as const;

export const TOOLS_BY_NAME: Record<string, AgentTool<any, any>> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t as AgentTool<any, any>])
);

export {
  searchObservationsTool,
  searchInsightsTool,
  searchPreviousPodcastsTool,
  searchRawContentTool,
  searchIdentityInferencesTool,
  internetResearchTool,
};
export type { AgentTool, ToolContext } from './types';
export { asOpenAITool } from './types';
