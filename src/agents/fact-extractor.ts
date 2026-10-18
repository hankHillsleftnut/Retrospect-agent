/**
 * A facts-only extractor -- Option F in the Phase 3 brief, for measurement.
 *
 * NOT used by the pipeline. The live extractor (ingestion-agent.ts) asks one
 * model call for five things -- identity inferences, observations, insights,
 * goal candidates and, as one section among them, fact candidates -- and the
 * test bank shows it stopping early on long writing (3 of 11 facts from an
 * 11,000-character essay). This asks for facts and nothing else, with the
 * vocabulary widened to the founder's actual writing (three-quarters of it is
 * about work) and two rules the bank showed were missing: whose words these
 * are, and that a general "you" is not the writer.
 *
 * Same model as the live extractor by default, so a measured difference comes
 * from the instructions alone. `npm run bank:score -- --extractor facts-only`.
 */

import { jsonChatCompletion } from '../services/openai';
import { claudeJsonCompletion } from '../services/anthropic';
import { config } from '../config';
import { contentCharLimit } from './ingestion-agent';
import { isHealthSummary, normalizeHealthSummary } from '../pipelines/health-summary';
import type { Trace } from '../pipelines/trace';
import type { DbRawContent, FactCandidate } from '../types';

export const FACT_EXTRACTOR_SYSTEM = `You turn a person's writing into atomic, checkable facts -- each carrying the exact words it came from. Nothing else: no interpretation, no summary, no advice.

== WHAT TO PRODUCE ==
A list of fact candidates. Each has:
- subject -- "Self" for the writer, or a person's or organisation's name exactly as written
- predicate -- one of:
    Life:  stated_goal | quit_or_stopped | skipped_or_avoided | attended | felt | said_about_self
           mentioned_person | health_metric | scheduled | communicated_with | money
    Work:  works_at_or_as | building | work_plan | work_result | applied_to
    Mind:  believes | values | wants_to_learn | history
    Attention: consumed_or_followed
  A predicate outside this list only if nothing fits.
- object -- short and concrete ("savings of about $50k", not "the financial situation")
- event_time -- ISO date only if the text states when; otherwise omit
- excerpt -- COPIED VERBATIM. Character for character: keep typos, keep grammar, do not merge sentences. A quote not found in the source is discarded.
- source_index -- the [index=N] of the block
- severity_hint -- standard (default) | high | extreme (acute crisis or safety concern: tag it, never analyse it)
- names_own_loop -- true when the writer describes a repeating pattern in themselves

== COVER THE WHOLE TEXT ==
Long writing holds facts all the way through. Work paragraph by paragraph to the end. A long, multi-topic entry typically yields one to three facts per paragraph. Do not stop after the first few. If a passage repeats an earlier one word for word, extract it once.

== WHOSE WORDS ==
Each block is labelled with authorship:
- self: the writer wrote it. Facts about "Self" are allowed.
- unknown or other: it may be someone else's writing -- a brief, a post, an article the writer saved. Make NO claim with subject "Self". At most one fact describing what the document is, with subject set to the document's apparent author or organisation.
Within the writer's own text, quoted or reported words of others ("He's talking about how...", a passage they are reviewing) are not the writer's claims.

== WHAT IS NOT A FACT ABOUT THE WRITER ==
- Sentences addressed to a general "you" or about people in general ("if you have survived poverty and abuse..."). These are not autobiography. This rule matters most when the content is sensitive.
- Descriptions of other people or target users ("the SF tech bros who want...").
- Plans, hopes and intentions stated as events. "I want to raise money" is stated_goal, never that they raised it.
- App settings, connected services, export errors, keyboard mashing, test notes. Return nothing for these.
- Interpretations, diagnoses, predictions, conclusions. Never.

== VOICE TRANSCRIPTS ==
Machine transcriptions may contain mishearings. A name or company that looks misheard ("Concentra" where the context suggests their employer) is not recorded as a fact. Quote only sentences whose wording is clearly intact.

== FEELINGS ==
A feeling is a fact about a moment: "felt angry at their sister", dated if possible. Never a verdict on a relationship or a trait.

Return STRICT JSON only: {"fact_candidates": [ ... ]}`;

export async function extractFacts(input: {
  items: (DbRawContent & { authorship?: string | null })[];
  model?: string;
  trace?: Trace;
}): Promise<FactCandidate[]> {
  const model = input.model ?? config.openai.chatModel;
  const blocks = input.items.map((rc, idx) => {
    const date = rc.content_date ?? rc.created_at;
    const source = isHealthSummary(rc.content_type) ? normalizeHealthSummary(rc.content) : rc.content;
    const authorship = rc.authorship ?? 'self';
    return `### [index=${idx}] (type: ${rc.content_type}, authorship: ${authorship}, date: ${date})\n${source.slice(0, contentCharLimit(rc.content_type))}`;
  });
  const user = `${blocks.join('\n\n---\n\n')}\n\nExtract every fact. Return STRICT JSON.`;
  // Either provider, so the same instructions can be measured on any model.
  if (model.startsWith('claude')) {
    const { data, usage } = await claudeJsonCompletion<{ fact_candidates?: FactCandidate[] }>(
      FACT_EXTRACTOR_SYSTEM, user, { maxTokens: 8000, model });
    input.trace?.addCost({ anthropic_tokens_input: usage.inputTokens, anthropic_tokens_output: usage.outputTokens }, model);
    return data.fact_candidates ?? [];
  }
  const { data, usage } = await jsonChatCompletion<{ fact_candidates?: FactCandidate[] }>(
    FACT_EXTRACTOR_SYSTEM, user, { temperature: 0.25, maxTokens: 8000, model });
  input.trace?.addCost({ openai_tokens_input: usage.promptTokens, openai_tokens_output: usage.completionTokens }, model);
  return data.fact_candidates ?? [];
}
