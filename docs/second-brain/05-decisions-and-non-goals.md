# Decisions and non-goals

This file is the “why we decided that” companion to [04-target-architecture.md](./04-target-architecture.md). If a junior (or a future you) wants to install Graphiti because a blog post said so, this file is the answer.

Decisions are **locked** unless the founder reopens them. Non-goals are not “maybe later in the same PR.” They are out of this project.

---

## How to read a decision

Each decision has:

- **Choice**
- **Why** (evidence from this conversation, the repo, or research)
- **What we almost did instead**
- **What you must not do in a PR**

---

## D1 — Adopt ideas, not products

**Choice:** Do **not** install gbrain, Graphiti/Zep, Letta, or LangExtract as production services or vendored apps. Replicate their **contracts** inside `retrospect-agent` + Postgres.

**Why**

1. We already have the furniture. `entities`, `assertions`, `assertion_evidence`, `origin_key`, `valid_from` / `valid_to`, `entity_aliases`, Cook 0, a TypeScript ingest agent, a podcast factory. Installing a second brain is a **sync problem**, not a speedup.
2. The founder’s product is an **iOS + Render + Supabase** podcast app about **one person’s life**. gbrain is a local markdown daemon for a founder’s company graph. Letta is an agent runtime. Graphiti is a Python temporal graph service. LangExtract is a Python extraction library. None of them are the Retrospect runtime.
3. The thing we cannot buy is the **Pattern promoter + Why bar + user-life significance**. Those products do not ship that. Installing them would still leave the original work.
4. Two graphs means two identities. “Is this Alex the same Alex?” would be asked twice. That is how you get a worse brain, not a better one.
5. Effort: installing and adapting the three products was estimated to **add** time versus copying contracts into the existing write path. See [06-implementation-plan.md](./06-implementation-plan.md).

**What we almost did instead**

- “Use Graphiti as the store, Letta as the portrait, LangExtract as ingest.” That was the **greenfield** assembly we described when asked “what existing system can we use?” It is the right **assembly of ideas**. It is the wrong **deployment** given this repo.

**What you must not do**

- `pip install graphiti` / `npm install @letta-ai/...` as the memory layer.
- Stand up a Zep cloud project and dual-write.
- Replace Cook 0 with a Letta agent process.
- Block phase 1 on a LangExtract Python sidecar.

**Exception:** a **time-boxed spike** (days, not a platform) to compare extraction quality (LangExtract vs our schema) is allowed if someone writes down the metric. Default is still: Instructor / `json_schema` + span verifier in TypeScript.

---

## D2 — Write path first, not Cook B tools first

**Choice:** The first implementation slice is **journal ingest → graph facts with spans + idempotent completion + embed `raw_content`.** Do not start by rewriting Cook B’s search tools.

**Why**

- Cook B’s tools have nothing honest to retrieve. Production audit: 0/2207 raw embeddings for the main account; `assertions` / `entities` empty; the graph tool is substring over an empty table; Cook B never called the graph tool in a 67-call sample.
- Improving cosine on empty shelves makes the podcast sound more confident and more wrong.
- MemStrata: cosine cannot see contradiction (AUROC ~0.59). A better retriever does not replace `valid_to`.

**What we almost did instead**

- “Raise `agentMaxIterations` and mention `search_personal_graph` in the prompt.” That is a one-line change and does not create a brain.

**What you must not do**

- Ship “we added a reranker” or “we fixed the 5 vs 7 tools prompt” as the second-brain milestone.
- Invent patterns in `notRealizedYet` and call them stored memory.

---

## D3 — One graph, shared write function

**Choice:** Journals call the same graph write path integrations already use (`graph-v2.ts`), via a shared `writeFact`.

**Why**

- The schema already has `assertion_evidence.raw_content_id`.
- Identity (Self alias `retrospect:user` / userId) already exists in that pipeline.
- A second “journal_facts” table would split current truth.

**What you must not do**

- Insert assertions from `ingest.ts` with a different uniqueness story than `origin_key`.
- Create `journal_entities` or store people only as strings in observation text.

---

## D4 — Facts on ingest; Patterns later; Why last

**Choice:** Birth times are different objects. See locked spec.

**Why**

- Founder: patterns are their own section; they appear after a behavior shows a few times; severe is faster; why only after a pattern exists.
- If you infer why on the first skip, you will be wrong often and you will sound clinical. That is the failure mode the founder asked about.

**What you must not do**

- Add `inferred_why` to the observation insert in phase 1.
- Promote a Pattern from one standard journal.
- Reuse `identity_inferences` as the Pattern store.
- Reuse the old `patterns` / `insight_units` cron as the new promoter.

---

## D5 — Brain is a bank; cooks are consumers

**Choice:** The brain is heavily fact-based and easy to query. Narrative warmth lives in Cook C. Internal types (avoidance, COM-B) may exist **inside** the bank. They are not required in audio.

**Why**

- Founder selected: consumed by another system that creates narrative; fact-based; easiest retrieval bank.
- If Pattern labels are poetic, typed pulls break and the writer improvises.

**What you must not do**

- Make `behavior_patterns.label` a metaphor.
- Let Cook C mint a Pattern.
- Put the podcast transcript back into the graph as if it were a source of new psychology (the episode is a **view**. If you ingest it at all, it is a source of “what we already said,” not new Facts about the user’s soul.)

---

## D6 — Typed pulls primary; NL is compiler + fallback

**Choice:** Named queries are the API. Embeddings are not the brain.

**Why**

- Founder: user search + an agent that asks many questions and retrieves a lot, then audio.
- We chose typed pulls because they are testable, cacheable, and they force the bank to be structured.
- gbrain’s lesson: hybrid + graph beat vanilla RAG by a large margin on their bench. Our current Cook B is vanilla RAG on the wrong tables.

**What you must not do**

- Replace `search_insights` threshold 0.3 with 0.25 and call it typed retrieval.
- Add an off-the-shelf cross-encoder as the first search fix (lexical–dense fusion paper: reranker **hurt** conversational memory Hit@1).

---

## D7 — People are part of the user’s life, not a world CRM

**Choice:** Significance ≈ recency × interactions × intensity. Thin profiles. No 24k-person gbrain.

**Why**

- Founder: evaluate the user and their life; close people matter because they shape the user; significance scales with closeness and interactions.

**What you must not do**

- Build company/deal pages.
- Auto-scrape LinkedIn for Alex.
- Give the barista a biography.

---

## D8 — Do not predict next week

**Choice:** Forecasting is out of scope. The founder did not select it.

**What you must not do**

- Outline sections titled “Here’s what you’ll do Thursday.”
- A `predicted_next` table.

---

## D9 — Do not promote `goal_candidates`

**Choice:** Leave the table. Do not build a promotion product.

**Why**

- 2026 RCT (N=543, arXiv:2602.08636): adaptive goal **suggestions do nothing**; guidance + feedback help.
- Production: 43 pending candidates, never read (except onboarding fallback).
- A second RCT: progress was mediated by **felt accountability**, not a one-way suggestion.

**What you must not do**

- A “smart goals inbox” that auto-creates `goals` rows from candidates.
- Spend phase 1–3 on candidate ranking.

Onboarding may still read candidates as a **fallback** when Cook 0 did not produce `active_goals`. That is existing glue, not a product bet.

---

## D10 — Safety / extreme content is not episode fuel

**Choice:** Store the Fact. Do not auto-promote into a Pattern that Cook A/B will cheerfully narrate. Extreme/safety is a different product path.

**Why**

- Founder: severe bar is shorter, but a single rupture may stay a Fact. When in doubt, store, do not auto-write into audio.
- We are not building a clinical diagnostic system. Lowest SOTA confidence in the audit was “impediment as clinical formulation.”

**What you must not do**

- CCD-CBT / therapy-formulator UX.
- Auto-label disorders in audio.
- Train a “crisis classifier” as a side quest in the first tickets. Use a **conservative allow-list**: if the model tags `extreme`, skip episode promotion and do not infer Why. Ask before expanding the classifier.

---

## D11 — Do not install Temporal (by default)

**Choice:** Steal lease, heartbeat, idempotency, verifier-before-commit. Implement on `raw_content` + `pipeline_run_traces`. Add a real queue only if that fails at scale.

**Why**

- Current hole is “202 + setImmediate + non-idempotent ingest,” not “we need a workflow mesh.”
- New infra is a second ops surface for a two-repo product.

**What you must not do**

- Block Fact writes on a Temporal cluster.

---

## D12 — Old docs are not the spec

**Choice:** This folder wins. `docs/retrospect-data-model-and-pipeline.md` still describes `POST /content` → legacy `insight_units`. That is **false** now. Content upload calls the agent.

**What you must not do**

- “Fix” insight_units extraction as the second brain.
- Extend `cron:daily` insight_units patterns as the new Pattern promoter.

---

## D13 — Embeddings: keep the model, fix coverage, do not worship vectors

**Choice:** Keep `text-embedding-3-large` 3072-d for now. Embed `raw_content` on ingest. Run the existing backfill. Accept that IVFFlat cannot index 3072-d (max 2000). Sequential scan or a future dimension drop / HNSW is a **search** ticket, not a Fact ticket.

**Why**

- Facts do not need embeddings to exist.
- 0% raw coverage made `search_raw_content` dead.
- Better embeddings (EvoEmbedding) can win retrieval benches and **still** fail contradiction.

**What you must not do**

- Block phase 1 on migrating to 1536-d or a new vendor.
- Create IVFFlat indexes that cannot exist and then “debug why search is empty.”

---

## Adopt vs replicate vs ignore (quick table)

Full research: [03-research-and-comparables.md](./03-research-and-comparables.md).

| Source | Decision | Contract we keep |
|--------|----------|------------------|
| gbrain | Replicate, don’t install | Immutable sources, receipts, compiled vs timeline, identity aliases, hybrid+graph, gap answers |
| Graphiti / Zep / SodaMem | Replicate into graph-v2 | Temporal facts, supersession, evidence |
| Letta / MemGPT | Replicate into Cook 0 | Named always-on blocks, rest retrieved |
| LangExtract / Enoki | Replicate into ingestion | Span or drop |
| Mem0 | Ignore | Too thin |
| Obsidian / Roam / Notion | Ignore as apps | Source vs derived |
| STORM | Replicate later | Research loop then write, pointed at **our** bank |
| CAMI / CCD-CBT | Ignore as products | Optional state field later; no therapy stack |
| Goal-suggestion RCTs | Follow | Do not promote candidates |
| Temporal / River / … | Steal contract | Lease + idempotency |
| Cross-encoder rerankers | Ignore first | They hurt the relevant bench |

---

## Explicit non-goals (this project)

Write these on the ticket if scope creeps.

1. Rewrite the iOS app or move off SwiftUI.
2. Replace ElevenLabs or fix the iOS player-class bug (out of brain scope).
3. Predict next week.
4. World-model CRM of everyone in the user’s contacts.
5. Install gbrain / Graphiti / Letta / LangExtract as the production brain.
6. Personality-from-onboarding-only (onboarding is a source, not the portrait).
7. Auto-promote `goal_candidates`.
8. Clinical diagnosis, CBT product, or crisis-intervention product.
9. Dual-write to a second graph database (Neo4j, Zep cloud, etc.).
10. Make Cook B the Pattern factory.
11. “Just add Mem0 / a longer context window / GPT-5 with 1M tokens.”
12. Connector platform (Nango/Airbyte) as a prerequisite for the brain. Journals first.
13. Migrate all historical `identity_inferences` before Facts can ship. Backfill is later.
14. Perfect entity resolution. Exact aliases + a candidate queue is v1 (ATOM).
15. Public user-facing search UI in phase 1. The **layer** must exist; the iOS screen can wait.
16. Re-benchmark every 2026 paper. Contracts are stable; leaderboards are not.

---

## Decisions that are **not** locked (ask before assuming)

These came up; they were not chosen by the founder as numbers or UX.

| Topic | Default if you must pick | Ask if it affects UX |
|-------|--------------------------|----------------------|
| Exact Pattern bar numbers | ≥3 / >1 week or >1 source; high = 2 | If you want 4, or 2 for standard |
| Table name `behavior_patterns` vs `user_patterns` | `behavior_patterns` to avoid old `patterns` | Fine either way if migrated cleanly |
| Portrait as JSON keys vs `portrait_blocks` table | Either, as long as slots are named and rebuildable | |
| Whether observations keep being written in parallel | Yes, as a shim until Cook A reads facts | |
| Hybrid search stack (ParadeDB vs tsvector vs …) | Phase 2+; not a phase 1 blocker | |
| Raising Cook B iterations | After pulls exist | |
| Severe classifier | Conservative tag from the extractor; no custom safety model | **Yes, ask** before expanding |

---

## How to disagree

If you think a decision is wrong:

1. Name the decision id (`D1`…).
2. Point at the locked spec in `01` if the conflict is product, or at a file if the conflict is “the code already does X.”
3. Do not silently collapse Pattern into Insight in the PR.

The founder can reopen product locks. A junior cannot reopen them by renaming a column.

---

## One-page “do not” list (print this)

- Do not install the four products.
- Do not start with Cook B.
- Do not skip span checks.
- Do not skip `origin_key`.
- Do not reuse old `patterns`.
- Do not infer Why on one event.
- Do not predict.
- Do not promote goal candidates.
- Do not rewrite `raw_content`.
- Do not add a reranker as the brain.
- Do not build Alex’s Wikipedia page.
- Do not trust cosine for contradiction.

Next: [06-implementation-plan.md](./06-implementation-plan.md) — phases, effort, tickets, definition of done.
