import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import type { AgentToolCall, CostBreakdown } from '../types';

export type TraceKind = 'ingest' | 'podcast' | 'cookA' | 'cookB' | 'cookC';
export type TraceTrigger = 'manual' | 'cron' | 'http' | 'cli' | 'replay';

export interface TraceOptions {
  userId: string;
  kind: TraceKind;
  triggeredBy?: TraceTrigger;
  inputsSnapshot?: Record<string, unknown>;
  parentRunId?: string | null;
  notes?: string;
}

const emptyCost: CostBreakdown = {
  openai_tokens_input: 0,
  openai_tokens_output: 0,
  embedding_tokens: 0,
  perplexity_calls: 0,
  elevenlabs_chars: 0,
  est_usd: 0,
};

/**
 * Trace handle — created at the start of any pipeline run.
 * Every intermediate step calls one of the .setX or .addX methods,
 * and finally .complete() or .fail() persists the row.
 */
export class Trace {
  readonly id: string | null;
  private startedAt = Date.now();
  private toolCalls: AgentToolCall[] = [];
  private fields: Record<string, unknown> = {};
  private cost: CostBreakdown = { ...emptyCost };
  private persistDisabled = false;

  private constructor(id: string | null) {
    this.id = id;
  }

  static async start(options: TraceOptions): Promise<Trace> {
    const { data, error } = await supabase
      .from(Tables.PIPELINE_RUN_TRACES)
      .insert({
        user_id: options.userId,
        kind: options.kind,
        status: 'running',
        triggered_by: options.triggeredBy ?? 'manual',
        inputs_snapshot: options.inputsSnapshot ?? {},
        parent_run_id: options.parentRunId ?? null,
        notes: options.notes ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.warn(
        `[trace] Could not create pipeline_run_traces row (${error.message}). ` +
          `Continuing without persistence — make sure migration 101 has been applied.`
      );
      const t = new Trace(null);
      t.persistDisabled = true;
      return t;
    }
    return new Trace(data!.id);
  }

  /** Create a trace that never persists — useful for --dry-run. */
  static memoryOnly(): Trace {
    const t = new Trace(null);
    t.persistDisabled = true;
    return t;
  }

  setOutlineV1(outline: unknown) {
    this.fields.outline_v1 = outline;
  }

  setOutlineV2(outline: unknown) {
    this.fields.outline_v2 = outline;
  }

  setFinalScript(script: string) {
    this.fields.final_script = script;
  }

  setAudioUrl(url: string | null) {
    this.fields.audio_url = url;
  }

  setEpisodeSummary(summary: string) {
    this.fields.episode_summary = summary;
  }

  setEpisodeId(id: string) {
    this.fields.episode_id = id;
  }

  addToolCall(call: AgentToolCall) {
    this.toolCalls.push(call);
  }

  addCost(partial: Partial<CostBreakdown>) {
    for (const k of Object.keys(partial) as (keyof CostBreakdown)[]) {
      const inc = partial[k] ?? 0;
      this.cost[k] = (this.cost[k] ?? 0) + inc;
    }
    this.cost.est_usd = this.estimateUsd();
  }

  private estimateUsd(): number {
    // Rough estimates — adjust as pricing changes.
    const inputCost = this.cost.openai_tokens_input * (5 / 1_000_000);
    const outputCost = this.cost.openai_tokens_output * (15 / 1_000_000);
    const embedCost = this.cost.embedding_tokens * (0.13 / 1_000_000);
    const ppxCost = this.cost.perplexity_calls * 0.005;
    const ttsCost = this.cost.elevenlabs_chars * (0.30 / 1000) * 0.001; // very rough
    return Math.round((inputCost + outputCost + embedCost + ppxCost + ttsCost) * 10000) / 10000;
  }

  snapshot() {
    return {
      id: this.id,
      ...this.fields,
      agent_tool_calls: this.toolCalls,
      cost_breakdown: this.cost,
    };
  }

  async complete(): Promise<void> {
    await this.persist('completed');
  }

  async fail(err: unknown): Promise<void> {
    await this.persist(
      'failed',
      err instanceof Error ? err.message : String(err)
    );
  }

  private async persist(status: 'completed' | 'failed', errorMessage?: string) {
    if (this.persistDisabled || !this.id) return;
    const duration = Date.now() - this.startedAt;
    const payload: Record<string, unknown> = {
      status,
      duration_ms: duration,
      finished_at: new Date().toISOString(),
      agent_tool_calls: this.toolCalls,
      cost_breakdown: this.cost,
      ...this.fields,
    };
    if (errorMessage) payload.error_message = errorMessage;

    const { error } = await supabase
      .from(Tables.PIPELINE_RUN_TRACES)
      .update(payload)
      .eq('id', this.id);

    if (error) {
      console.warn(`[trace] Failed to persist trace ${this.id}: ${error.message}`);
    }
  }
}
