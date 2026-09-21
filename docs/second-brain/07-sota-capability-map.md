# SOTA capability map (from the earlier product audit)

This file is the portable version of the Cursor canvas `state-of-the-art-by-capability.canvas.tsx` (September 2026). That canvas scored **16 product areas** against 2026 research and then asked: *which of these would we actually implement?*

A junior without the canvas still needs this, because later second-brain decisions (do not install Temporal, do not promote `goal_candidates`, span-check Facts, skip CAMI/CBT) were **made on this evidence**.

**This file is history + mapping.** The **spec** is still [01](./01-locked-product-behavior.md). The **plan** is still [06](./06-implementation-plan.md). If this file and 06 disagree, **06 wins** — the founder locked a second-brain product *after* this audit, and some “build now” items (AVPlayer, Now Playing) were explicitly put **out of brain scope**.

---

## How to read the scores

Each area has two scores (0–100), plus an overall that **leans toward fit**:

| Score | Means |
|-------|--------|
| **Evidence** | How strong is the proof that the cited approach is actually best-in-class? Peer review, sample size, whether someone *other* than the authors built the benchmark. |
| **Fit** | How well it transfers from the paper’s setting to Retrospect (journals + integrations + one-way podcast, hosted APIs, no therapy product). |
| **Overall** | Confidence this is the right *answer for this product area*. An unimpeachable result you cannot apply is worth less than a decent one you can. |

These numbers are **calibrated judgment**, not measurements. Each row has a caveat so you can disagree with the reason, not just the number.

**Structural finding:** confidence runs roughly **opposite to novelty**. Product-standard areas averaged ~75; research-frontier areas ~72. Asking for the most cutting-edge approach and asking for the approach most likely to work are different requests.

`pct` in the table is **how developed the area was in the product at audit time**, not how good the SOTA is.

---

## The 16 areas (ranked by overall confidence)

| # | Area | Product then | Basis | Ev | Fit | Overall | SOTA one-liner | What limits the score |
|---|------|--------------|-------|----|-----|---------|----------------|------------------------|
| 16 | Audio delivery | 50% | product | 95 | 100 | **95** | AVPlayer + Now Playing + remote commands (Apple contract) | Nothing novel; leftover is implementation risk |
| 2 | Ingestion and durable execution | 40% | research | 70 | 90 | **80** | Classify failure → bounded repair → **verifier before commit** | Exact %s from author-built harness; pattern proven by Temporal/DBOS |
| 4 | Knowledge graph and identity | 30% | research | 65 | 95 | **80** | Temporal facts, spans, deterministic supersession | Individual papers recent; **four groups converged** |
| 6 | Retrieval | 35% | research | 75 | 80 | **80** | Hybrid BM25 + vectors; **do not** start with a web reranker | Domain is dialogue benches, not journals |
| 7 | Goal lifecycle | 60% | research | 90 | 70 | **80** | Guidance + feedback help; **suggestions do nothing** | RCTs were a **chatbot**, not a one-way episode |
| 3 | Extraction and verification | 55% | research | 70 | 85 | **78** | Extract triples, verify vs source span, drop unsupported | Enoki self-benchmarked; survey on hallucination is solid |
| 10 | Current state of the person | 55% | research | 65 | 85 | **75** | Split extract / consolidate / retrieve / forget (Letta/MemGPT) | Survey taxonomy, not an RCT that splitting Cook 0 helps |
| 11 | External research | 50% | research | 80 | 70 | **75** | Query plan + FACT citation metric | Bench is PhD reports; we ask light questions |
| 14 | Long-form writing | 65% | research | 75 | 75 | **75** | Per-section check-and-repair against a typed outline | Blocked on area 13 existing first |
| 1 | Data sources | 45% | product | 60 | 85 | **70** | Connector framework (Nango/Singer cursors) | High fit, low ceiling; ops, not capability |
| 13 | Episode structure | 70% | research | 75 | 65 | **70** | Typed outline with entry/exit/evidence (PLOTTER-like) | Fiction planner vs our evidence-bound non-fiction |
| 15 | Voice synthesis | 60% | product | 55 | 70 | **60** | Vendor TTS is fine; self-host later | No rigorous listening test; cost we are not paying |
| 8 | Goal / state inference | 40% | research | 60 | 55 | **58** | Separate state-inference module (CAMI) | 93% on **simulated** clients; they have conversation, we have logs |
| 9 | Communication style | 50% | research | 65 | 55 | **58** | Evoke vs plan from readiness (CHI 2026) | Needs area 8’s signal; ACM PDF blocked for bots |
| 12 | Impediment detection | 25% | research | 50 | 60 | **55** | Living CBT formulation (CCD-CBT) | **Lowest.** One paper, synthetic data, clinical framing |
| 5 | Structured output | 65% | bounded | 95 | 15 | **30** | XGrammar-2 constrained decoding at the **logits** | Proven at xAI/Databricks/DeepSeek; **unreachable** on hosted APIs |

**Steal instead of XGrammar-2:** `json_schema` + `strict: true` on hosted calls. Schema-valid ≠ true. Span check is the Fact gate.

---

## What we already matched (said in the audit)

Worth keeping, because the audit was harsh and this part is real:

| We already had | Research cousin |
|----------------|-----------------|
| Cook A draft → Cook B research → Cook C write | STORM’s outline → research → cited article |
| Token-budgeted UUD that Cook 0 rewrites | MemGPT / Letta living profile (intent, not implementation quality) |
| Observations that *cite* a raw row | Precondition for every 2026 verifier — **but we do not check the span** |

The second-brain work is: make the citation **checkable**, write the **graph**, stop inventing patterns in Cook B.

---

## Four papers that changed recommendations

Read these if you read nothing else from the audit. Three of them **contradict** earlier advice from the same conversation (CoVe, rerankers, goal suggestions).

| Paper | Area | Why it matters |
|-------|------|----------------|
| [MemStrata, arXiv:2606.26511](https://arxiv.org/abs/2606.26511) | 4, 6 | Cosine **cannot** see contradiction (AUROC ~0.59). Supersession is not optional. |
| [Goal-setting RCT, arXiv:2602.08636](https://arxiv.org/abs/2602.08636) | 7 | N=543: suggestions do nothing. Do not promote `goal_candidates`. |
| [Self-healing orchestrators, arXiv:2606.01416](https://arxiv.org/abs/2606.01416) | 2 | Verifier-before-commit → 0% silent failure in their harness. |
| [Enoki, arXiv:2609.00581](https://arxiv.org/abs/2609.00581) | 3 | Span-level verify. Cheap regimes exist. Do not use “self-consistency” as the Fact gate. |

Also: [lexical–dense fusion, arXiv:2606.04194](https://arxiv.org/abs/2606.04194) — off-the-shelf reranker **hurt** conversational memory. That is why “add a reranker to Cook B” is forbidden.

---

## What I said I would implement (then)

This list was given **before** the founder locked the second-brain spec. It is still useful. **Strike-through / scope notes** tell you what the later product decision did to each item.

### Build now (original list, ordered)

1. **Backfill `raw_content` embeddings.** Coverage, not research. **In brain plan: phase 1 ticket 1.4.**
2. **Fix vector dimensions so IVFFlat indexes can exist.** 3072 > 2000. **In brain plan: not a Fact blocker.** Sequential scan is acceptable in phase 1. Dimension drop / HNSW is phase 5. Do not create indexes that cannot exist.
3. ~~**Swap AVAudioPlayer for AVPlayer in the library path.**~~ **Out of brain scope** (D, non-goals). Separate iOS ticket if someone wants it.
4. **Heartbeat and lease on pipeline runs.** **In brain plan: phase 1 ticket 1.3.**
5. **Idempotency keys on effect-causing stages.** **In brain plan: `origin_key` on Facts, phase 1.** ElevenLabs double-charge is a podcast-path concern; same contract.
6. **`json_schema` + `strict: true` on agent calls.** **In brain plan: extraction agent, phase 1.** Schema-valid still needs span check.
7. **Write assertions (s, r, o) + span + validity.** **This became the entire first slice.** Tables already exist and were empty.
8. **Deterministic supersession.** **Phase 2** (can land inside `writeFact` during phase 1 if small).
9. **Cheap triple-versus-evidence reject.** **Phase 1 span check.** This is LangExtract’s contract, not the library.
10. **Drop `goal_candidates` promotion.** **Locked non-goal (D9).** There is nothing to delete in a product path; do not *add* promotion.
11. ~~**Now Playing / remote commands.**~~ **Out of brain scope.**

### Then, once an episode generates end to end

12. Verifier gates between cook stages — **phase 4/5**, after the bank exists.
13. Typed outline object — **phase 4/5**, STORM/PLOTTER. Not the brain.
14. Per-section check-and-repair — **phase 5**.
15. FACT citation instrumentation — **phase 5**.

### Would not build on that evidence (still true)

| Area | Why declined | Second-brain status |
|------|----------------|---------------------|
| 12 Impediments as CBT | 55, clinical, unreplicated | Impediments are **in scope as a live object** (founder selected). Implementation is a **boring Pattern/impediment field**, not CCD-CBT. |
| 8 CAMI state inference | 58, simulated clients, needs chat | Optional `current_state` portrait slot later. Not a counselor module. |
| 9 Evoke vs plan | 58, inherits 8 | Phase 5 only if founder wants it. |
| 15 Self-host TTS | 60, cost we don’t pay | Non-goal. Keep ElevenLabs. |
| 1 Connector framework | 70, next connector, not now | Journals first (D, non-goals). |
| 10 Cook 0 four-way split | 75, diagnosability at zero coverage | We **do** split UUD into **named blocks** (Letta contract). We do **not** install Letta or a four-agent rewrite in phase 1. |

### Area 7 is a decision, not a ticket

Strongest evidence on the page. Act 1: do not promote suggestions. Act 2: felt accountability may mean a one-way episode is the wrong *coaching* format. The founder later locked: the brain is a **bank**; the episode is a **consumer**. That does not make the episode a coach. Do not add a chat coach in this project.

---

## How the later product conversation changed this map

After the SOTA canvas, the founder was asked what the **second brain** must do (see [01](./01-locked-product-behavior.md)). That **narrowed** the 16 areas into a smaller object model:

| Founder capability | Closest SOTA area(s) | What we build |
|--------------------|----------------------|---------------|
| Facts | 3, 4 | Spanned assertions via graph-v2 |
| Patterns | *(none of the 16 is a pattern promoter)* | **Original work.** Phase 3. |
| Why after pattern | 12 (weak) | Why object on Pattern only. No CBT stack. |
| State | 8, 10 | Portrait slot. Not CAMI. |
| Goals vs pursuit | 7, 4 | Live vs superseded assertions + existing `goals` table |
| Impediments | 12 | Live object via Pattern, not CCD-CBT |
| People | 4 | Entities + significance. Not gbrain CRM. |
| Self-talk | 3, 4 | Facts with `said_about_self` |
| Change | 4, 6 | `changed_since` + supersession |
| Predict | — | **Out of scope** |
| Story | 11, 13, 14 | Phase 4 consumer, after the bank |

**gbrain / Graphiti / Letta / LangExtract** were researched *after* this 16-area map, when the question became “what existing system can we use?” Verdicts: [03](./03-research-and-comparables.md) and [05](./05-decisions-and-non-goals.md). They map onto areas 3, 4, and 10 — not onto Patterns.

---

## Advice this conversation reversed (so you do not resurrect it)

| Old impulse | Why it died |
|-------------|-------------|
| Add Chain-of-Verification as the Fact gate | Wrong family. CoVe does not check a source. Self-consistency misses confident errors. Use **span verify**. |
| Add a cross-encoder reranker to Cook B | Hurt Hit@1 on conversational memory. Fix the **bank** first. |
| Promote / rank `goal_candidates` | RCT: suggestions do nothing. Table is a graveyard. |
| Install Graphiti + Letta + LangExtract | We already have the tables and a TS agent. Contracts only. |
| Start by making Cook B smarter | Empty graph. Write path first. |
| Infer personality from one journal | Founder: patterns after repetition. |

---

## Product maturity percents (audit-time, not a scorecard you must keep)

These are **how built the area looked** in September 2026, so you know why “add SOTA retrieval” was premature:

- Graph/identity 30%, retrieval 35%, durable ingest 40%, impediments 25%
- Extraction 55%, portrait 55%, goals 60%
- Outline/writing 65–70% (the podcast factory exists; it points at the wrong memory)

Re-measure before you quote these in a PR.

---

## Canvas and other artifacts

| Artifact | Where | Use |
|----------|-------|-----|
| SOTA canvas | Cursor project `canvases/state-of-the-art-by-capability.canvas.tsx` | Original scored page. This file is the briefing copy. |
| FigJam “life of one datum” | [board](https://www.figma.com/board/fPUoyJ0wSBbG6mD7b4ujAX) | 18-step trace of one voice-note sentence. Useful intuition; **not** the spec. |
| Older architecture docs | `docs/retrospect-*.md` | Stale on `POST /content` → agent. |

If the canvas and this file drift, **update this file** in the same change. The junior is sent the markdown folder, not the canvas.

Next: you should already have read [06-implementation-plan.md](./06-implementation-plan.md). Start at ticket 1.1 when assigned. Do not start at area 16.
