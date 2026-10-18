import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import type { AgentToolCall, CostBreakdown, UserUnderstandingDocument } from '../types';

export type TraceKind = 'ingest' | 'podcast' | 'cookA' | 'cookB' | 'cookC';
export type TraceTrigger = 'manual' | 'cron' | 'http' | 'cli' | 'replay';

/**
 * USD per million tokens, keyed by model id.
 *
 * Verified 18 October 2026. Anthropic figures are from Anthropic's own pricing
 * table. OpenAI figures came from third-party aggregators rather than OpenAI's
 * own page — treat them as good but not authoritative, and re-check before
 * relying on an exact number.
 *
 * Keep this table honest. The bug this replaced priced every Anthropic call at
 * Opus rates while all three cooks ran Sonnet (5x over) and every OpenAI call at
 * full rates while Cook A ran a mini model (up to 33x over). The comment in the
 * old code even predicted it: "if we route Cook 0 to a cheaper Sonnet later,
 * swap these constants." Nobody did.
 */
const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  // Anthropic
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  'claude-sonnet-5': { in: 2.0, out: 10.0 },
  'claude-sonnet-5-5': { in: 2.0, out: 10.0 },
  'claude-opus-4-6': { in: 5.0, out: 25.0 },
  'claude-opus-5': { in: 5.0, out: 25.0 },
  'claude-opus-5-5': { in: 4.0, out: 20.0 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  // OpenAI
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
};

/**
 * Used for a model with no entry above. Deliberately set at the top of the
 * current range: an unknown model should make the bill look too big, never too
 * small, and the model name is reported in `unpriced_models` so it gets fixed.
 */
const FALLBACK_PRICE = { in: 5.0, out: 25.0 };

/** text-embedding-3-large, USD per million tokens. */
const EMBEDDING_PRICE_PER_MTOK = 0.13;

/** Perplexity sonar-pro, USD per call. Unverified — a rough placeholder. */
const PERPLEXITY_PRICE_PER_CALL = 0.005;

/**
 * ElevenLabs, USD per 1,000 characters. Tier-dependent and unverified.
 *
 * The previous line multiplied this by a further 0.001, understating every
 * audio charge by a factor of a thousand — the one error in the old estimator
 * that pointed downward, on the only line that is about to grow with a daily
 * brief.
 */
const TTS_PRICE_PER_1K_CHARS = 0.3;

/**
 * Price a cost breakdown. Pure — no database, no clock — so it can be tested
 * directly, which is how the 5x and 1000x errors it replaces would have been
 * caught.
 *
 * Returns the dollar figure plus any model ids that had no price, so an unknown
 * model is reported rather than quietly estimated.
 */
export function estimateCostUsd(cost: CostBreakdown): { usd: number; unpriced: string[] } {
  let llm = 0;
  const unpriced = new Set(cost.unpriced_models ?? []);

  // Attributed tokens, priced by the model that actually spent them.
  let attributedIn = 0;
  let attributedOut = 0;
  for (const [model, usage] of Object.entries(cost.by_model ?? {})) {
    attributedIn += usage.input;
    attributedOut += usage.output;
    const price = MODEL_PRICES[model];
    if (!price) unpriced.add(model);
    const { in: pin, out: pout } = price ?? FALLBACK_PRICE;
    llm += (usage.input * pin + usage.output * pout) / 1_000_000;
  }

  // Anything not attributed to a model — a call site that did not pass one, or a
  // row written before by_model existed. Priced at the fallback rather than
  // dropped, so a missing attribution reads as a rough number, never as free.
  const residualIn = cost.openai_tokens_input + cost.anthropic_tokens_input - attributedIn;
  const residualOut = cost.openai_tokens_output + cost.anthropic_tokens_output - attributedOut;
  llm +=
    (Math.max(0, residualIn) * FALLBACK_PRICE.in +
      Math.max(0, residualOut) * FALLBACK_PRICE.out) /
    1_000_000;

  const embedCost = cost.embedding_tokens * (EMBEDDING_PRICE_PER_MTOK / 1_000_000);
  const ppxCost = cost.perplexity_calls * PERPLEXITY_PRICE_PER_CALL;
  const ttsCost = cost.elevenlabs_chars * (TTS_PRICE_PER_1K_CHARS / 1000);

  return {
    usd: Math.round((llm + embedCost + ppxCost + ttsCost) * 10000) / 10000,
    unpriced: [...unpriced],
  };
}

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
  anthropic_tokens_input: 0,
  anthropic_tokens_output: 0,
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

  setIdentityInferenceIds(ids: string[]) {
    this.fields.identity_inference_ids = ids;
  }

  setUserUnderstanding(document: UserUnderstandingDocument, version: number) {
    this.fields.user_understanding_document = document;
    this.fields.user_understanding_version = version;
  }

  setCook0Failure(error: string) {
    this.fields.cook0_error = error;
  }

  addToolCall(call: AgentToolCall) {
    this.toolCalls.push(call);
  }

  /**
   * Record spend. Pass the model that spent it whenever it is known — that is
   * what makes the estimate correct, because provider totals alone cannot be
   * priced (see CostBreakdown.by_model).
   */
  addCost(partial: Partial<CostBreakdown>, model?: string | null) {
    for (const k of Object.keys(partial) as (keyof CostBreakdown)[]) {
      if (k === 'by_model' || k === 'unpriced_models') continue;
      const inc = (partial[k] as number | undefined) ?? 0;
      (this.cost[k] as number) = ((this.cost[k] as number) ?? 0) + inc;
    }

    if (model) {
      const byModel = (this.cost.by_model ??= {});
      const entry = (byModel[model] ??= { input: 0, output: 0 });
      entry.input += partial.openai_tokens_input ?? partial.anthropic_tokens_input ?? 0;
      entry.output += partial.openai_tokens_output ?? partial.anthropic_tokens_output ?? 0;
    }

    this.cost.est_usd = this.estimateUsd();
  }

  private estimateUsd(): number {
    const { usd, unpriced } = estimateCostUsd(this.cost);
    if (unpriced.length > 0) this.cost.unpriced_models = unpriced;
    return usd;
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
