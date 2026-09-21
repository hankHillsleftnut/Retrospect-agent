# Research and comparables

This file is the “what products and papers match the behavior we want?” section. It exists so a junior developer does not independently decide to `npm install mem0` or merge gbrain into the iOS app.

**Rule we already locked:** steal **contracts**, do not install these as sibling brains. See [05-decisions-and-non-goals.md](./05-decisions-and-non-goals.md).

Dates: research was done in September 2026. Links were HTTP-checked in that session unless noted. Papers can be superseded; the **contracts** (spans, supersession, named memory blocks, typed retrieval) are what we keep.

---

## How to use this file

For each system:

1. What it is
2. What behavior of **ours** it matches
3. What it does **not** do (especially: nuanced behavioral analysis)
4. Whether we **adopt the product**, **replicate the contract**, or **ignore**

If you only need the verdict table, jump to [Summary verdicts](#summary-verdicts).

---

## The behavior we were matching

From [01-locked-product-behavior.md](./01-locked-product-behavior.md):

- Robust ingest (receipts, retries that do not double-write, sources never rewritten)
- Categorize / file knowledge into a coherent model of **one person**
- Search **current truth** and history, not just similar text
- Infer **patterns** only after repetition (faster if severe)
- Infer **why** only after a pattern exists
- Keep a small **portrait** another writer can read
- People in the user’s life with **significance**, not a company CRM
- A narrative agent that **asks many questions** of the bank, then writes audio

No single shipping product does all of that. Several do the **bank**. None do the **pattern promoter + user-life psychology** as a first-class store.

---

## Complete shipping “second brains”

### gbrain (Garry Tan) — closest complete brain, wrong product shape

- Repo: [https://github.com/garrytan/gbrain](https://github.com/garrytan/gbrain) (MIT, very active, 30k+ stars as of research)
- One-liner: a **memory daemon** for agents he already uses (OpenClaw, Hermes, Claude Code, Codex). Markdown wiki + Postgres/PGLite. 24/7 “dream cycle.”
- His scale claim: ~155k pages, ~24k people, ~5k companies, dozens of crons.

**What it matches**

| Our need | gbrain |
|----------|--------|
| Immutable sources | Raw sources never rewritten; `.raw/` sidecars |
| One home per entity | MECE directories + `RESOLVER.md` |
| Current vs history | Compiled truth **above** the line, append-only timeline **below** |
| Facts with provenance | Fact store: claim + source + confidence + time |
| Identity | Entity registry + aliases; merge is a DB operation |
| Contradiction | Two facts for one field; visible, not silently overwritten |
| Search | BM25 + vectors + RRF + **graph traversal**. BrainBench: P@5 **49.1%**, R@5 **97.9%**, about **+31 P@5** vs hybrid without graph / vs vanilla RAG |
| Answers not chunks | `gbrain think` — synthesized answer **plus gap analysis** (“nothing about Alice since April 22”) |
| Robust writes | Capture returns a **receipt**; replace needs the revision you read |
| Overnight maintenance | Dream cycle: enrich, fix citations, consolidate |
| Graph edges cheap | Regex / conventions on write, **zero LLM** for many link types |

**What it does not match**

- It is a **world model** (people, companies, deals, open loops: “who is waiting on me?”).
- It will not infer that Thursday skipping is **avoidance**, or maintain a COM-B impediment, or a stage-of-change field, unless you build that — and the product is not designed for it.
- Runtime: Bun, local/PGLite or self-hosted Postgres, MCP verbs, markdown files as the human UI. Not a hosted iOS + Render + Supabase podcast factory.
- Installing it **as** Retrospect would throw away the app.

**Verdict:** **Spec, not dependency.** Read `docs/GBRAIN_RECOMMENDED_SCHEMA.md` and `docs/architecture/RETRIEVAL.md` in that repo if you need the primary-source version of these ideas. Do not vendor gbrain.

**Steal exactly**

1. Sources are immutable.
2. Facts have provenance and validity.
3. Identity is alias merge, not filename hope.
4. Compiled truth is **generated** from facts.
5. Retrieval is hybrid + structure, not cosine alone.
6. Writes have receipts and optimistic concurrency.
7. Answers include **gaps**.

---

### Knowledge-base products (Obsidian, Roam, Notion, Logseq)

We compared these when asking “how do knowledge bases work?” They are **manual** or lightly assisted. Humans resolve identity (“is this the same Alex?”). The graph is usually **derived** from links the user typed.

| Product | Source of truth | Lesson |
|---------|-----------------|--------|
| Obsidian | Files | Index can be rebuilt; files win. Like our `raw_content`. |
| Roam | Block graph | Fine-grained linking; still human-driven. |
| Notion | Server blocks | Properties are typed; still not automatic psychology. |
| Logseq | Moved toward DB | Same story: query layer over human structure. |

**Verdict:** **Ignore as implementations.** Steal the lesson: **source of truth vs derived views.** Our `raw_content` is files-as-truth. Assertions/patterns/portrait are derived. Never rewrite the source to “fix” the graph.

---

## Embeddable memory / graph products

These were the three we told the founder they could *use* to make a functioning brain **if** we were assembling a greenfield stack. We then **decided not to run them**, because we already have the tables and a TypeScript agent. A junior must understand **why they were suggested** and **why we are not adding them**.

### Graphiti (Zep) — temporal knowledge graph

- Code: [https://github.com/getzep/graphiti](https://github.com/getzep/graphiti)
- Paper: [Zep, arXiv:2501.13956](https://arxiv.org/abs/2501.13956)

**Matches:** entities, facts, bi-temporal validity, edges, “what is true now” vs “what was true.” This is the production system closest to our **empty** `assertions` / `entities` / `valid_from` / `valid_to`.

**Does not match:** user-life Pattern promoter; podcast evidence packs; our ingest queue.

**Why we suggested it:** finishing a temporal graph is the core of “search everything that is still true.”

**Why we do not install it:** `retrospect-agent/src/pipelines/graph-v2.ts` already upserts entities, aliases, assertions, evidence. Integrations already call `materializeGraphV2`. A second graph means two identities and sync. **Replicate supersession + journal writes into graph-v2.**

Related papers (do not implement all of them):

- [SodaMem, arXiv:2608.08055](https://arxiv.org/abs/2608.08055) — evidence-grounded temporal graph, source spans, supersedes/contradicts/updates. **Closest research picture of our intended assertion model.**
- [PGMem, arXiv:2608.01708](https://arxiv.org/abs/2608.01708) — persona nodes vs event nodes; validity per assertion. Maps to “portrait vs fact log.”
- [ATOM, arXiv:2510.22590](https://arxiv.org/abs/2510.22590) — do **not** LLM-call every entity merge; use similarity and escalate ambiguous pairs. Matches `entity_resolution_candidates`.
- [MemStrata, arXiv:2606.26511](https://arxiv.org/abs/2606.26511) — cosine **cannot** see contradiction (AUROC ~0.59); deterministic `(s,r,o)` supersession; stale-serve 15–40% → ~0%. **Cite this if someone wants to “just tune embeddings.”**

**Verdict:** **Replicate contract. Do not add the service.**

### Letta — living agent memory (MemGPT lineage)

- Code: [https://github.com/letta-ai/letta](https://github.com/letta-ai/letta)
- Docs: core **blocks** always in the prompt (`human`, `persona`, custom); **archival** memory retrieved on demand; conversation recall separate.

**Matches:** Cook 0 / UUD intent — a **small always-on portrait** plus a large store you query. Named slots you can diagnose (“current goals block is stale”).

**Does not match:** our Pattern bar; our graph; iOS; we already have an agent runtime.

**Why we do not install it:** another process, another store, adapters for every cook. **Replicate: split UUD into named blocks; rebuild them from live assertions + patterns, not from a raw dump.**

Foundational (dated) papers: [MemGPT, arXiv:2310.08560](https://arxiv.org/abs/2310.08560), [Generative Agents, arXiv:2304.03442](https://arxiv.org/abs/2304.03442). 2026 surveys: [Memory in the LLM Era, arXiv:2604.01707](https://arxiv.org/abs/2604.01707), [MemoryArena, arXiv:2602.16313](https://arxiv.org/abs/2602.16313). Use surveys if you need to justify “split extract / consolidate / retrieve / forget.”

**Verdict:** **Replicate contract. Do not add the runtime.**

### LangExtract (Google) — extraction with source offsets

- Code: [https://github.com/google/langextract](https://github.com/google/langextract)

**Matches:** every field carries source offsets. That is the Fact birth rule: no span, no row.

**Does not match:** graph, patterns, story.

**Why we do not vendor it by default:** Python library vs TypeScript agent. The **rule** is “constrained extraction + verify span is a substring of `raw_content.content`.” Instructor / `json_schema` + a 20-line verifier is enough. A spike may use LangExtract offline to compare quality; it is not the production architecture.

Related:

- [Enoki, arXiv:2609.00581](https://arxiv.org/abs/2609.00581) — extract text-anchored triples, verify vs evidence, project failures back to spans. Cheap regimes (encoder/rules) exist.
- [EAEV, arXiv:2609.08267](https://arxiv.org/abs/2609.08267) — entity–evidence alignment.
- [LLM Hallucination survey, arXiv:2510.06265](https://arxiv.org/abs/2510.06265) — **self-consistency cannot catch confident errors** and never checks a source. Do **not** “add Chain-of-Verification” as our Fact gate.
- [Instructor](https://github.com/567-labs/instructor), [BAML](https://github.com/BoundaryML/baml), OpenAI [structured outputs](https://platform.openai.com/docs/guides/structured-outputs) (`json_schema` + `strict: true`).

**Verdict:** **Replicate the span rule in the ingestion agent.** Optional offline spike only.

---

## Other tools we mentioned (do not expand scope)

| Thing | Why it came up | What you should do |
|-------|----------------|--------------------|
| **Nango / Airbyte / Singer** | Connector frameworks for ingest **sources** | Out of this project’s critical path. Journal ingest + graph first. Connectors are a later operations problem. |
| **Temporal / DBOS / River / Graphile Worker / pgmq / Absurd workflows** | Durable jobs | Steal **heartbeat, lease, idempotency, verifier-before-commit**. Implement on our traces/queue. Do not add Temporal unless ingest durability fails at scale. Paper: [Self-Healing Orchestrators, arXiv:2606.01416](https://arxiv.org/abs/2606.01416) (verifier → 0% silent failure in their harness). [Safe to Resume?, arXiv:2608.29381](https://arxiv.org/abs/2608.29381) — retrying non-idempotent effects causes double writes. |
| **Mem0** | Thin fact extraction | Too thin. Ignore. |
| **STORM** ([paper](https://arxiv.org/abs/2402.14207), [repo](https://github.com/stanford-oval/storm)) | Outline → research → cited article | Our Cook A/B/C **already** match this shape. Steal: research **loop** then write. Point the research at **our bank**, not Wikipedia. |
| **Deep research surveys** | Query planning + FACT citation metrics | Instrument citation accuracy on episodes later. Not phase 1. [Survey](https://arxiv.org/abs/2512.02038), [DeepResearch Bench](https://arxiv.org/abs/2506.11763). |
| **PLOTTER / ConWriter / SuperWriter** | Long-form consistency | Phase 4+ story quality. Typed outline + per-section repair. Not the brain. |
| **Splink / dedupe / Zingg** | Record linkage | ATOM’s point: cheap similarity first; human queue for ambiguous pairs. We already have `entity_resolution_candidates`. |
| **ParadeDB / pgvector / RAGatouille** | Hybrid search | Phase 2. BM25 + vectors. Do not start here. |

---

## Behavioral / coaching research (nuance layer — we write this)

These match **Pattern / Why / state / goals**, not the graph vendor.

| Work | Year | What it says for us |
|------|------|---------------------|
| [Supporting Effective Goal Setting, arXiv:2602.08636](https://arxiv.org/abs/2602.08636) | 2026 RCT N=543 | **Guidance + feedback** improve goal quality. **Adaptive suggestions do nothing.** Our `goal_candidates` table is the suggestions condition. Do not build promotion. |
| [AI-assisted goal setting, arXiv:2603.17887](https://arxiv.org/abs/2603.17887) | 2026 RCT N=517 | Progress mediated by **felt accountability** (follow-ups), not self-concordance. A one-way episode does not create accountability. Narrative can *invite* a plan; it is not the same as a coach chat. |
| [CAMI](https://aclanthology.org/2025.acl-long.1024.pdf) | ACL 2025 | Separate **state inference** module (93% on **simulated** clients — inflated). Use as “stage lives in a field,” not as “copy their accuracy.” They infer from **conversation**; we have **logs**. Fit is imperfect. |
| CHI 2026 motivation-aware coaching (10.1145/3772318.3791123) | 2026 | Switch **evoke vs plan** on readiness. Needs a state field. ACM may 403 automated fetches. |
| [CCD-CBT, arXiv:2604.06551](https://arxiv.org/abs/2604.06551) | 2026 | Living formulation, reconstructed; do not hand the writer ground truth. Maps to Pattern/Why as **maintained state**, not a static profile. **Low confidence / clinical framing — do not import CBT as UX.** |
| BCT Taxonomy v1 (Michie 2013), COM-B (2011), Gollwitzer implementation intentions | older | Shared vocabulary for impediments and plans. Use internally if useful. Not a library to install. |

**Verdict:** implement a **small, boring Pattern promoter** (counts, severity, time span). Do **not** implement a full CAMI counselor or CCD-CBT therapy stack. Confidence on “impediment detection as clinical formulation” was the **lowest** in our SOTA scoring (~55). Stay consumer-safe.

---

## Retrieval research (how to read the bank)

| Work | Takeaway for us |
|------|-----------------|
| gbrain BrainBench | Graph + extract quality >> vector-only. Our graph tool is currently **substring**, which is worse than their hybrid. |
| [Lexical–dense fusion, arXiv:2606.04194](https://arxiv.org/abs/2606.04194) | Off-the-shelf reranker **hurt** conversational memory Hit@1 (−6.9). BM25 + late interaction helped. **Do not add a web reranker as the first search fix.** |
| [TSM, arXiv:2601.07468](https://arxiv.org/abs/2601.07468) | Semantic timeline + durative memories; big gains on temporal / multi-session questions. |
| [EvoEmbedding, arXiv:2606.21649](https://arxiv.org/abs/2606.21649) | Better embeddings can beat fancy memory **on their benchmark**. We still need supersession; better embeddings do not replace `valid_to`. |
| Anthropic contextual retrieval | Prepend chunk context before embed. Cheap, later. |

Cook B today is **vector-only on derived tables** + a 14-day dump. That is the 2010s RAG default the papers above beat.

---

## Structured output / verification

- Hosted API: use `json_schema` + `strict: true` on agent calls (weaker than XGrammar-2, which needs **self-hosted logits** — [XGrammar-2, arXiv:2601.04426](https://arxiv.org/abs/2601.04426), **out of reach**).
- Schema-valid ≠ true. Span check is the Fact gate.

---

## Does any of this create “very nuanced behavioral analysis”?

**No product we researched does that out of the box.**

| Layer | Who provides it |
|-------|-----------------|
| Grounded facts, time, identity | Graphiti-like / gbrain-like / **our graph-v2** |
| Small current portrait | Letta-like / **our Cook 0, rebuilt** |
| Span-safe extract | LangExtract-like / **our ingestion constraint** |
| Repeated-behavior Patterns + Why + significance | **We write this** |
| Story from an evidence pack | STORM-like loop / **our cooks, retargeted** |

If someone says “just use Letta and we’ll get nuance,” they are wrong. Letta will remember a paragraph. It will not enforce “3 times or it isn’t a pattern.”

---

## Summary verdicts

| System | Adopt product? | Replicate contract? | Priority |
|--------|----------------|---------------------|----------|
| gbrain | No | Yes — receipts, MECE, compiled vs timeline, hybrid+graph, gaps | Read, don’t install |
| Graphiti / Zep | No | Yes — temporal facts, identity | **Already half-built in graph-v2** |
| Letta | No | Yes — named portrait blocks | Cook 0 change |
| LangExtract | No (default) | Yes — spans or drop | Ingestion agent |
| Mem0 | No | No | — |
| Obsidian et al. | No | Source vs derived only | — |
| Temporal | No (default) | Lease + idempotency | Ingest phase |
| STORM | No | Research-then-write | Story phase |
| CAMI / CCD-CBT | No | Optional state field later | After patterns exist |
| Goal-suggestion RCTs | N/A | **Do not promote `goal_candidates`** | Immediate non-goal |

---

## Primary links (keep this list in PRs)

**Products**

- https://github.com/garrytan/gbrain
- https://github.com/getzep/graphiti
- https://github.com/letta-ai/letta
- https://github.com/google/langextract
- https://github.com/stanford-oval/storm
- https://github.com/hankHillsleftnut/Retrospect-agent (our agent)

**Papers we actually used for decisions**

- https://arxiv.org/abs/2606.26511 MemStrata (cosine ≠ contradiction)
- https://arxiv.org/abs/2608.08055 SodaMem
- https://arxiv.org/abs/2602.08636 Goal-setting RCT (suggestions fail)
- https://arxiv.org/abs/2609.00581 Enoki (span-level verify)
- https://arxiv.org/abs/2606.04194 Fusion / reranker hurts
- https://arxiv.org/abs/2606.01416 Self-healing orchestrators
- https://arxiv.org/abs/2501.13956 Zep
- https://arxiv.org/abs/2402.14207 STORM

The 16-area scored table, implement-vs-decline tiers, and “advice this conversation reversed” live in [07-sota-capability-map.md](./07-sota-capability-map.md). Read that after 06 if you need the audit-era research; do not treat the canvas as required.

Next: [04-target-architecture.md](./04-target-architecture.md).
