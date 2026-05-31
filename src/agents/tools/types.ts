import type OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';

export interface ToolContext {
  userId: string;
}

export interface AgentTool<Args, Result> {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
  execute: (args: Args, ctx: ToolContext) => Promise<Result>;
}

export function asOpenAITool(tool: AgentTool<unknown, unknown>): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  };
}

export function asAnthropicTool(tool: AgentTool<unknown, unknown>): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool['input_schema'],
  };
}
