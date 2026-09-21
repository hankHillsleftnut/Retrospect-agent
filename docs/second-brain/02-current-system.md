# Current system (as of this briefing)

Read this so you do not “fix” a layer that is not the one running. The older docs in `docs/retrospect-data-model-and-pipeline.md` still describe a **legacy** path (`POST /content` → `insight_units`). That path is **not** what content upload does now.

---

## Topology

```
iOS app
   │  HTTPS + JWT
   ▼
retrospect-api   (this repo, backend/, Express, Render)
   │  X-Internal-Secret, HTTP
   ▼
retrospect-agent (sibling repo, private Render service)
   │
   ▼
Supabase Postgres (shared) + Storage (podcast audio)
```

The phone never calls the agent. If the API is up and the agent is down, `POST /content` can still **insert** `raw_content` and then fail in the background.

How to run this locally and hit the path with a throwaway user: [08-day-0-handoff.md](./08-day-0-handoff.md).

---

## Repos and entry points

### API (`retrospect-main/backend`)

| File | Role |
|------|------|
| `src/routes/content.ts` | `POST /content` inserts `raw_content`, returns **202**, then `setImmediate` → `runAgentIngest` |
| `src/services/agent-client.ts` | HTTP client. **Does not retry 5xx.** Comment: `/ingest/run` is long, side-effectful, **non-idempotent**; a retry would double-run Cook 0. Retries **only 429**. Timeout 450s, 3 attempts on 429. |
| `src/routes/pipeline.ts` | Manual ingest triggers (also `runAgentIngest`) |
| `src/routes/podcasts.ts` | Triggers agent `POST /podcasts/generate` |
| `src/routes/integrations.ts` | OAuth / device batches → agent integration endpoints |
| `src/routes/graph.ts` | Read assertions; confirm/contradict/retire; entity resolution RPC |
| `src/services/goals.ts` | Goal CRUD + embeddings; `synthesizeOnboardingGoals` runs **full ingest + Cook 0** then reads UUD `active_goals` |
| `src/services/observations.ts` | **Legacy** observation extraction (chunk + cosine ≥ 0.35 vs **goal embedding** + LLM). Still in the repo. Podcast/content path uses the **agent**, not this, for new uploads. |
| `src/utils/config.ts` | Embeddings: `text-embedding-3-large`, **`dimensions: 3072`** |
| `src/utils/supabase.ts` | Table name constants including graph tables the API can read |

### Agent (`retrospect-agent`)

| File | Role |
|------|------|
| `src/pipelines/ingest.ts` | `runIngest` — load pending `raw_content`, batch by ~35k chars, call ingestion agent, persist observations/insights/candidates/identity_inferences, embed those rows, mark raw completed, run Cook 0 |
| `src/agents/ingestion-agent.ts` | LLM that proposes observations / insights / goal_candidates / identity_inferences from raw text |
| `src/agents/cook0-agent.ts` | `runCook0`, `applyCook0Decisions`, `writeNewDocumentVersion` — rewrite UUD |
| `src/pipelines/graph-v2.ts` | `materializeGraphV2`, `materializeIdentityHypothesis` — **real graph writes** |
| `src/pipelines/integration-sync.ts` | Calls `materializeGraphV2` (integrations only) |
| `src/pipelines/podcast.ts` | `loadContext` (14-day dump) → Cook A → Cook B → Cook C → TTS |
| `src/agents/podcast-agent.ts` | Cook B tool loop, `agentMaxIterations` default **6** |
| `src/prompts/historical-agent-system.ts` | Cook B system prompt (lists **5** tools; code registers **7**) |
| `src/agents/tools/*.ts` | The seven tools |
| `src/config.ts` | `pipeline.agentMaxIterations: 6` |
| `src/db/tables.ts` | Table constants |
| `supabase/migrations/100_agent_extensions.sql` | Adds `raw_content.embedding`, `match_raw_content`, podcast summary embeddings. **Explicitly no IVFFlat on 3072-d raw_content.** |

---

## Path A — journal / onboarding ingest (the main path)

### 1. Phone uploads

`POST /content` (`content.ts`):

1. Validate body (`contentType`, `content`, `contentDate`, `metadata`).
2. Look up `data_sources` by name = contentType (optional).
3. Insert `raw_content` with `processing_status: 'pending'`.
4. Best-effort upsert `integration_connections` if contentType is in the catalog. **Failure is only logged.** Ingest continues.
5. Return **202** with empty insight counts. The phone does **not** wait.
6. `setImmediate`: `runAgentIngest({ userId, rawContentIds: [id] })`.
7. On success, mark `raw_content` completed. On throw, mark **failed** with the error string.

**Robustness holes**

- If the Node process dies after 202 and before the agent finishes, the row can sit **pending** with nothing watching.
- There is a `processing_queue` table in the old schema. **Nothing writes it** (only a constant in `supabase.ts`).
- API will not retry a hung agent (non-idempotent).
- No lease, no heartbeat on this hop (the agent has `pipeline_run_traces` for its own run; the API fire-and-forget is still a gap).

### 2. Agent `runIngest`

`ingest.ts` roughly:

1. Select `raw_content` for the user that is not successfully processed (or the IDs you passed).
2. Batch so each LLM call stays under `MAX_BATCH_CHARS` (35,000). Per-entry cap 4,000 chars (10,000 for `onboarding_profile`).
3. For each batch: `runIngestionAgent(...)` with current UUD, goals, etc.
4. Insert **observations** (goal_id may be null in this path — the insert uses `o.goal_id ?? null`; the *original* SQL migration required `goal_id NOT NULL` — if production still has that constraint, goal-less facts **cannot** persist. Check live schema before assuming.)
5. Embed each observation (`content — reason_why`) and UPDATE the row.
6. Insert insights, embed them.
7. Insert `goal_candidates` (pending). **Nothing in the app promotes these automatically.** Founder research later said AI-suggested goals measured as useless; do not invest in promotion.
8. Insert `identity_inferences`, embed them.
9. Mark those raw rows `completed`.
10. Run **Cook 0** to rewrite `user_understanding`. If Cook 0 fails, ingest can still have written observations; the document stays old (`cook0_failed` in the summary).

**What this path does *not* do**

- It does **not** call `materializeGraphV2`.
- It does **not** write `assertions` / `assertion_evidence` / `entity_aliases` for journals.
- It does **not** check that a quote exists as a span in the source (it cites raw_content **indexes** in the LLM output — better than nothing, not span-verified).
- It does **not** supersede old identity claims. Audit found identity inferences were not retired.
- It does **not** create Pattern rows.

### 3. Cook 0

One (or few) LLM calls that produce a new **User Understanding Document** version: who the person is, active goals, live tensions, etc. It is a **document rewrite**, not “patch these slots from new assertions.”

That is why we say Letta’s *idea* (named always-on blocks, rest retrieved) matches the *intent*, but Cook 0 today collapses extract/consolidate/forget into one prompt.

Onboarding: `synthesizeOnboardingGoals` in the API stores answers as `raw_content` type `onboarding_profile`, runs this whole ingest, then reads `document.active_goals` (or top `goal_candidates`) and upserts `goals` rows.

---

## Path B — integrations (the graph path that already exists)

Device or OAuth sync lands in `source_items` / payloads / jobs (agent). Then:

- `integration-sync.ts` → `materializeGraphV2(userId, sourceItemIds)`
- `graph-v2.ts` resolves entities via **aliases** (namespace + alias). If two aliases point at different entities, it writes `entity_resolution_candidates` instead of silently merging everything.
- It upserts **assertions** with evidence rows (`assertion_evidence`) tied to analysis units / source items / raw_content.

This is the write path we want **journals to share**. Do not invent a second graph. Call this from ingest (or extract a shared “write fact” function both use).

`materializeIdentityHypothesis` writes `assertion_kind: 'inferred'` — related to identity, still not a Pattern promoter.

---

## Path C — podcast / story (how reading works today)

### Cook A — no search

`podcast.ts` `loadContext(userId, daysBack)` default **14 days**:

- user
- active goals
- insights with `updated_at >= since`
- observations with `observation_date >= since`
- preferences
- unprocessed episode feedback (limit 10)
- last ready episode
- latest onboarding_profile raw_content
- latest `user_understanding` by version

If insights, observations, onboarding, and document are all empty, generation **throws** (hard gate).

Cook A writes Outline V1 from that dump + the UUD as a “lens.” Identity inferences are **not** loaded here.

This is “what’s loud this week,” accidentally used as “who this person is.”

### Cook B — the only retrieval agent

`podcast-agent.ts`:

- Model: configured Cook B Claude model.
- Tools: **all seven** from `src/agents/tools/index.ts`.
- Loop: up to **6** iterations. Last iteration `tool_choice: none` (must answer).
- Prompt (`historical-agent-system.ts`) still describes **five** tools and says to make **3–5** calls, max 6. It tells B to find patterns the user has not named and classify them (`hidden_strength`, `distortion_habit`, …) into `notRealizedYet`. Those types **are not written to the database**.

#### The seven tools

| Tool | File | Mechanism | Notes |
|------|------|-----------|--------|
| `search_insights` | `search-insights.ts` | Embed query → RPC `match_user_insights` | Prompt’s “primary” tool. Optional join of supporting observations **after**. Default threshold 0.3, limit 8. |
| `search_observations` | `search-observations.ts` | Embed → `match_observations` | Threshold 0.3, limit 10. |
| `search_previous_podcasts` | `search-previous-podcasts.ts` | Embed → `match_podcast_summaries` | Avoid repetition. Needs `summary_embedding` on episodes. |
| `search_raw_content` | `search-raw-content.ts` | Embed → `match_raw_content` | Last resort. Limit 4, truncate 800 chars. **Only rows with non-null embedding.** |
| `search_identity_inferences` | `search-identity-inferences.ts` | Embed → `match_identity_inferences` | **Not mentioned in the Cook B prompt.** |
| `search_personal_graph` | `search-personal-graph.ts` | `SELECT` up to **500** assertions, rank by **how many query tokens appear in `JSON.stringify(row)`** | The only graph tool. Not vector. Not “current only.” Prompt omits it. Table was empty in the production audit. |
| `internet_research` | `internet-research.ts` | Perplexity | One web call. Prompt allows “proof of others.” Audit: **zero calls** in a sampled 67-tool window. |

**Date filters** on insights/observations: applied **in JavaScript after** the RPC. The SQL function does not receive start/end for those two. “Only March” still ranks globally by cosine, then throws rows away.

**No BM25. No typed pulls. No valid_to filter. No Pattern table.**

### Cook C

Writes the transcript from the enriched outline. Then TTS (ElevenLabs). Playback bugs on iOS (wrong player class in library path) are **out of scope** for the brain project; see older product audit if you touch audio.

---

## Embeddings and indexes (why search is structurally weak)

- Model: OpenAI `text-embedding-3-large` at **3072** dimensions (`backend` config and agent embeddings service).
- pgvector **IVFFlat** maximum dimension is **2000**. Indexes created as `ivfflat (embedding vector_cosine_ops)` on 3072-d columns **fail or never apply**. Agent migration `100_agent_extensions.sql` **admits this** for `raw_content` and chooses sequential scan.
- `match_raw_content` requires `embedding IS NOT NULL`.
- Production audit (same product review): **0 of 2,207** raw rows embedded for the account that mattered. Ten embedded rows belonged to **another** user. `search_raw_content` would return nothing useful for the primary user.
- A `scripts/backfill-embeddings.ts` exists in the agent. Running it is part of phase 1, not a side quest.

**Research note we already have:** on conversational memory, an off-the-shelf cross-encoder **hurt** Hit@1; BM25 + late interaction helped. Do not “just add a reranker” to Cook B as the brain project.

**Contradiction note:** cosine distinguishes a contradicted fact from a duplicate at ~**AUROC 0.59** (near chance) in MemStrata (2026). This is why supersession is not optional.

---

## Schema: two generations in one database

### Generation 1 (checked into `retrospect-main/supabase/migrations`)

`users`, `data_sources`, `categories`, `raw_content`, `insight_units`, `insight_connections`, `patterns` (**old** pattern-detection on insight_units — **not** the new Pattern object), `processing_queue` (unused), `goals`, `observations`, `insights`, `pipeline_runs`, `podcast_episodes`.

The old `patterns` table is correlation/trend/habit over **insight_units**. Do not reuse it for the new Pattern promoter without a migration and a rename discussion. Prefer a new table (e.g. `behavior_patterns`) to avoid colliding with leftover cron jobs (`cron:daily` / insight_units patterns).

### Generation 2 (agent migrations + API constants)

`user_understanding`, `goal_candidates`, `identity_inferences`, `pipeline_run_traces`, `episode_feedback`, `user_preferences`, integration ledger, `entities`, `entity_aliases`, `entity_resolution_candidates`, `assertions`, `assertion_evidence`, `assertion_relations`, `source_items`, `analysis_units`, …

The API `graph.ts` already implements human feedback on assertions (confirm / contradict / retire) and `resolve_entity_candidate` RPC. That is the correction UX for **facts**. Patterns will need the same idea.

---

## Dual pipelines (do not get confused)

| Pipeline | Input | Output | Still running? |
|----------|--------|--------|----------------|
| Legacy API extraction | `POST /content` historically | `insight_units` + connections | **Not** on the current content route |
| Legacy `observations.ts` | Pipeline routes / admin | Goal-gated observations | Code exists; new content uses **agent** ingest |
| Agent ingest | `/ingest/run` | observations, insights, candidates, identity_inferences, UUD | **Yes — main path** |
| Agent graph-v2 | Integration sync | entities, assertions | **Yes — integrations only** |
| Old daily/weekly **insight_units** pattern crons | Render / node-cron | old `patterns` table | Check if still enabled; do not extend |

When you add Fact writes, attach them to **agent ingest + graph-v2**, not to `insight_units`.

---

## Production snapshot (from the product audit)

Treat as “last measured,” not a live query. Re-measure before you declare coverage fixed.

- ~2,267 raw rows; **one user held 2,207**.
- That user’s raw embedding coverage: **0**.
- `entities`, `assertions`, `source_items`, `integration_jobs`: **empty** at audit time (or unused).
- `goal_candidates`: 43 pending, **never read** by a product path (except onboarding fallback).
- Cook B: 67 tool calls sampled; **never** called `internet_research`, `search_raw_content`, `search_personal_graph`.
- Traces could sit in `running` with no finalization.

If your local/dev DB is empty, you will not see these numbers. The architecture problems still hold.

---

## What “works” vs what “exists”

| Piece | Exists in code | Filled / correct in behavior |
|-------|----------------|------------------------------|
| Store a journal | Yes | Yes (insert is fine) |
| Durable ingest | Partial traces | No (202 + setImmediate, non-idempotent) |
| Goal-tied observations | Yes | Partial (LLM, no span verify) |
| Graph for journals | Tables + graph-v2 | **No write from journals** |
| Living portrait | Cook 0 + UUD | Yes as a blob, no as slots-from-facts |
| Search | 7 tools | Cosine on sparse/empty shelves; graph is grep |
| Patterns as memory | Prompt taxonomy | **No store** |
| Story | Cooks A/B/C | Writes from dump + invented history |

You are not starting from zero. You are starting from a **working podcast pipeline pointed at the wrong memory**.

Next: [03-research-and-comparables.md](./03-research-and-comparables.md) — what we looked at and what to steal.
