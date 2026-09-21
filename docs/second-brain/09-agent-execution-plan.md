# Agent execution plan

Operational companion to [06-implementation-plan.md](./06-implementation-plan.md). 06 says *what* to build and in what order. This file says *who runs each piece* — one sub-agent per atomic task, run consecutively, each with a gate that can fail.

**This file does not reopen any product lock.** If an agent's work conflicts with [01](./01-locked-product-behavior.md) or a D-number in [05](./05-decisions-and-non-goals.md), the agent stops and escalates. It does not decide.

---

## Where the work happens

Almost every agent below works in **`~/Projects/retrospect-agent`**, a sibling repo. This folder lives in `retrospect-main`. Agents must use absolute paths and must not assume the session's working directory.

Verified state at time of writing (2026-09-19):

| Fact | Evidence |
|------|----------|
| Agent repo HEAD | `277f7f8` (2026-08-08) — no brain work started |
| `ingest.ts` never calls graph-v2 | zero references in `src/pipelines/ingest.ts` |
| `writeObservedAssertion` is private, integration-shaped | `src/pipelines/graph-v2.ts:149`, `origin_key` hardcoded `source_item:…` at `:159` |
| Journal evidence impossible today | evidence rows write `raw_content_id: null` |
| No supersession | no `valid_to` / `supersedes` anywhere in graph-v2 |
| No spans | `ingestion-agent.ts` cites *raw_content indexes*, has no excerpt field |
| No pattern table | migrations stop at `109_` |
| `raw_content` not embedded on ingest | ingest embeds observations / insights / identity_inferences only |

---

## The atomicity test

A task is one agent when **all four** are true:

1. It produces **one commit** with a title from 06's suggested list.
2. It has **one gate** that can fail, and the agent can run that gate itself.
3. It requires **no product decision** — every judgment call is already written down in 00–08.
4. A reviewer can read the diff in one sitting.

Three agents stay standalone even though they could be merged, because they **fail quietly**: A1 (`writeFact` — everything downstream inherits its shape), A4 (supersession — wrong in either direction), A6 (the promoter — a bad merge poisons the bank and you cannot see it from the output). Everything else is merged where splitting was tidiness rather than caution.

---

## Why consecutive, not parallel

A1 → A2 all touch `graph-v2.ts` and `ingest.ts`, and each stage changes the next agent's input. Two places are safe to parallelise if you want speed: **A9 (lint)** alongside **A8**, and the persona connector work (doc 12) alongside anything. Everything else: one at a time.

---

## Verification tiers

| Tier | Means | Self-verifiable? |
|------|-------|------------------|
| **A** | typecheck + unit/fixture tests, mocked Supabase, no network | **Yes.** Every agent must pass Tier A before reporting done. |
| **B** | real `POST /content` or `npm run ingest` against a non-prod Supabase, SQL counts | **No.** Batched into human checkpoints. |

An agent with no database reports `TIER-B: NOT VERIFIED`. It does not write "should work."

---

## Uniform agent contract

Issued with every prompt below.

```
REPO: /Users/shauryanarang/Projects/retrospect-agent  (absolute paths; the
      session cwd is a different repo)

READ FIRST: only the docs listed for your agent.

SCOPE: touch only the files under "Touches". If the task seems to need a
       file outside that list, STOP and report why.

PRODUCT LOCKS — you may not decide any of these. STOP and escalate:
  - Pattern bar numbers, severity thresholds, table names
  - Whether a Why may be inferred, and from what
  - Whether to install any external library (default: no)
  - Anything changing user-facing behaviour or copy

FORBIDDEN ALWAYS:
  - No new dependency without written approval (D1)
  - No second assertion-write path (D3) — one writeFact, no direct inserts
  - No Fact stored without a verified span
  - No Pattern minted outside the promoter (D4)
  - Never UPDATE raw_content.content
  - No IVFFlat index on a 3072-d column — it cannot exist (D13)
  - Do not touch Cook B before A10

GATE: run it yourself. Report PASS/FAIL with real output. Never report a
      Tier-B gate as passing without a database.

COMMIT: exactly one, with the stated title. Do not push.

REPORT: (1) what changed, file:line  (2) gate output verbatim
        (3) anything contradicting docs 00-08  (4) unverified Tier-B items
```

`/code-review` runs on **A1, A4 and A6** before the next agent starts. The others have gates that fail loudly.

---

## The sequence — 13 agents

| # | Agent | Tier | Review |
|---|-------|------|--------|
| A0 | Ground truth — env, access, schema, call graph | A | — |
| **A1** | **Extract `writeFact`** | A | ✔ |
| A2 | Journals write spanned facts | A+B | — |
| A3 | Harden ingest — lease, idempotency, embeddings | A+B | — |
| — | **CHECKPOINT 1** — Phase 1 gate | | |
| **A4** | **Supersession** | A | ✔ |
| A5 | Time, identity, significance | A | — |
| — | **CHECKPOINT 2** — Example B and C pass | | |
| **A6** | **Pattern schema + promoter** | A | ✔ |
| A7 | Why + `live_patterns` | A | — |
| — | **CHECKPOINT 3** — highest risk. Read the diff yourself. | | |
| A8 | Portrait blocks + pulls catalog | A | — |
| **A9** | **Lint — detection only, read-only over the bank** | A+B | — |
| A10 | Cook A, Cook B, evidence pack | A | — |
| A11 | Cook C constraint + gaps | A+B | — |
| — | **CHECKPOINT 4** — acceptance tests 1–12 from 01 | | |
| A12 | Remediation capabilities + audit log — **scoped by what A9 actually found** | A+B | ✔ |

Access (non-prod Supabase, keys, shared secret) is needed before **Checkpoint 1**, not before A0. A0 and A1 run with nothing.

---

## A0 — Ground truth

- **Reads:** `08`, `02`, `04`
- **Touches:** nothing. Two reports.
- **Does:** (1) Inventory access against 08's checklist — `.env` presence, var *names* only (**never values**), whether any configured `SUPABASE_URL` looks like production, Node version, whether `npm install` succeeds in both repos. (2) From migrations and source only: is `observations.goal_id` NOT NULL and did anything alter it; exact signature and line of every function writing `assertions`; every `materializeGraphV2` call site; the full `assertion_kind` CHECK values; whether `assertion_relations` supports `supersedes`; the exact unique constraint on `assertion_evidence`; whether `scripts/backfill-embeddings.ts` still exists.
- **Gate:** every item KNOWN or NEEDS-HUMAN; every claim cites `file:line`; no answer is "probably."
- **Escalate:** any sign a configured database is production.

## A1 — Extract `writeFact` ✔

- **Reads:** `04` §"Shared write function", `05` D3
- **Touches:** `src/pipelines/graph-v2.ts` + test
- **Does:** Make `writeObservedAssertion` (`graph-v2.ts:149`) callable without a `source_items` row. `originKey` becomes a **required parameter** instead of the hardcoded `source_item:…` at `:159`. Evidence accepts `rawContentId` instead of the hardcoded `null`. Export as `writeFact`. `materializeGraphV2` (`:258`) and `materializeIdentityHypothesis` (`:360`) become thin callers.
- **Also:** add a nullable `source_run_id` to `assertions` (and later `behavior_patterns`) linking a row to the pipeline run that created it. The older `identity_inferences` table carried `source_ingestion_run_id`; the graph tables dropped it, which breaks the chain from a lint finding back to its cause. One column, added while the write path is already open.
- **Must not:** change integration behaviour. Pure refactor — the new column is nullable and unset by existing callers.
- **Gate:** snapshot every row the integration path writes before the change; re-run after; **byte-identical**. Plus one new test writing an assertion with only `raw_content_id` evidence.
- **Commit:** `feat(agent): extract writeFact for raw_content evidence`

## A2 — Journals write spanned facts

- **Reads:** `04` §Extraction + §"End-to-end write pipeline", `01` Example A, `03` §LangExtract
- **Touches:** new `src/brain/verify-span.ts`, `src/agents/ingestion-agent.ts` + prompt, `src/pipelines/ingest.ts`
- **Does:** three things that form one idea —
  1. **Span verifier:** `verifyExcerpt(excerpt, source) → {ok, charStart, charEnd} | {ok:false, reason}`. Exact substring baseline; each allowed normalisation (whitespace collapse, smart quotes, NFC/NFD) is a **named, individually-toggleable, tested** rule. No similarity scoring, no thresholds.
  2. **Fact candidates:** ingestion agent emits `fact_candidates[]` — `{subject, predicate, object, event_time?, excerpt, severity_hint?}` via `json_schema` + `strict:true`, using the v1 controlled predicate list. Existing observations/insights/identity_inferences outputs **stay** — Cook A's shim.
  3. **Wiring:** verify each candidate against that row's `raw_content.content`, drop failures and **count them in the run summary**, resolve Self via `retrospect:user`, resolve people via aliases, call `writeFact` with `originKey = journal:{raw_id}:{predicate}:{normalized_object}`, write evidence with `raw_content_id` + excerpt + offsets.
- **Onboarding rule:** `onboarding_profile` extracts aggressively — expect dozens of facts from one submission, keep the larger character budget. Self-named loops ("I always start things and don't finish") are marked so A6 can seed a candidate from them. Onboarding claims are **facts, not patterns**, and are not exempt from any bar.
- **Must not:** insert into `assertions` directly. Require `goal_id`. Create a second user identity. Mint a Pattern or Why.
- **Gate (A):** span tests — exact hit, invented quote (reject), smart quotes (accept + offsets), collapsed double space (accept), real quote from the *wrong* source row (**reject**), 90%-overlap paraphrase (**reject**), empty string (reject). Fixture journal → ≥1 assertion with a real substring; tampered excerpt → 0 assertions, drop counted; mapper run twice → same origin keys.
- **Gate (B):** `npm run ingest` twice → identical assertion IDs.
- **Commit:** `feat(agent): journal ingest writes spanned assertions`

## A3 — Harden ingest

- **Reads:** `04` §Durability, `05` D11 + D13, `02` §"Robustness holes"
- **Touches:** `src/pipelines/ingest.ts`, `src/pipelines/trace.ts`, embeddings path, `scripts/backfill-embeddings.ts`
- **Does:** Claim a lease before work, heartbeat during, mark `completed` at the end; a dead run's lease expires back to `pending` rather than stranding `running`. If a `raw_content_id` is already completed with origin keys present, skip extraction. On success, write `raw_content.embedding`. Backfill reports a **coverage percentage**, not "done."
- **Must not:** enable 5xx retries in the API's `agent-client.ts` — that's follow-on F1, and the current refusal comment is correct until this lands. Add Temporal or any queue infrastructure. Create a 3072-d IVFFlat index.
- **Gate (A):** expired-lease unit test → row retryable, never `running`. **Gate (B):** kill mid-ingest; after TTL the row is `pending` or `failed`; re-run produces no duplicates; a new journal has a non-null embedding.
- **Commit:** `fix(agent): idempotent ingest completion and lease`

> ### CHECKPOINT 1 — human, Tier B
> 06's Phase 1 gate on a real `POST /content`: assertions exist for the journal, tampered span rejected, two ingests → one fact set, integrations still write, embeddings non-null, **zero** Pattern rows. Nothing starts until all six are green.

## A4 — Supersession ✔

- **Reads:** `04` §3 "Supersession algorithm", `01` Example B, `03` §MemStrata
- **Touches:** `src/pipelines/graph-v2.ts`
- **Does:** Steps 4–7 **in code, never in the LLM**. Same subject + predicate, contradicting object → old gets `valid_to`, `status='superseded'`, new gets `supersedes_id`, plus an `assertion_relations` row. Same claim again → attach evidence, bump `observed_at`, no clone. Compatible detail → new assertion, optional `refines`.
- **Gate:** Example B — Jan "training for a half" + Mar "I quit" → exactly one active (quit), one superseded, one relation. **And the negative:** "ran three miles" **refines**, it does not retire.
- **Commit:** `feat(agent): supersede contradicting assertions in writeFact`

## A5 — Time, identity, significance

- **Touches:** new `src/brain/pulls.ts` (first two functions), alias resolution, entity attributes
- **Does:** `current_truth(predicate?)` → `valid_to IS NULL AND status='active'`, **filtered in SQL**. `changed_since(ts)` → validity changes plus supersession pairs. Journal person-names resolve in a `journal:name` namespace; two candidates for one alias → `entity_resolution_candidates`, **never a silent merge, never first-name-only**. Person-entity touch bumps a recency-weighted significance score stored in entity attributes.
- **Must not:** filter validity in JavaScript after the query — that's the existing Cook B bug. Build people profiles or fetch anything external.
- **Gate:** `changed_since(Feb)` returns the training/quit pair; `current_truth` omits training; two different "Alex" contexts → 2 entities + 1 candidate; barista-once scores far below manager-weekly.
- **Commit:** `feat(agent): current truth, alias hygiene and significance`

> ### CHECKPOINT 2 — Examples B and C pass. Portrait is now *capable* of being right.

## A6 — Pattern schema + promoter ✔

- **Reads:** `01` Q6 + Examples A/D, `04` §4, `05` D4 + D10
- **Touches:** new migration `110_behavior_patterns.sql`, new promoter module
- **Does:** Create `behavior_patterns`, `behavior_pattern_facts` (UNIQUE `(pattern_id, assertion_id)`), `behavior_pattern_whys` — with `user_rejected` and `promoter_version` from day one. Then the promoter: attach new facts to candidates or open one; group conservatively (predicate family + weekday / entity / window); promote at the bar — standard **≥3** and (>1 week span OR >1 source), high **2**, extreme **never**.
- **Promoter hardening (agreed additions):**
  - **Confidence decay** — a live pattern with no new supporting fact loses confidence over time and can fall back to `candidate` or `retired`. Patterns must be able to die.
  - **Source-frequency weighting** — "three instances" from a calendar producing ~10 rows/day is not the same evidence as three journals. Weight instances by source cadence so a noisy connector cannot manufacture a pattern.
  - **Onboarding seeding** — a self-named loop from A2 opens a `candidate`; the first corroborating behaviour promotes it on the **high** bar, not the standard one.
- **Must not:** reuse the legacy `patterns` table. Over-merge — prefer two candidates to one invented "avoidance." Use an LLM as the store (a proposal is allowed; the promoter decides). Touch Cook B.
- **Gate:** three Thursday skips across two weeks → **exactly one** live pattern. Three cancellations with a flight, a fever and a funeral → **zero** (the corpus-2 case). Both loops together → **two**, never one. One skip → zero. Two skips → candidate, not live. Extreme fixture → fact stored, not episode-promotable. Re-run → same IDs.
- **Commit:** `feat(agent): behavior_patterns schema and promoter v1`

## A7 — Why + live_patterns

- **Reads:** `01` Q5, `04` §5
- **Does:** For `status='live'` patterns only, infer a mechanism from the controlled vocabulary (`avoidance`, `ambivalence`, `capacity`, `unclear`) — `kind='inferred'`, low confidence, `status='provisional'`, carrying evidence assertion IDs. Add `live_patterns()`, `pattern(id)`, `facts_for(pattern_id)` to `pulls.ts`.
- **Must not:** run on candidates, on extreme-tagged patterns, or on one event. Store user-stated reasons here — those are `said_about_self` facts.
- **Gate:** Example A week 1 → zero whys; week 3 after promotion → at most one provisional why with evidence IDs; candidate pattern → zero; `live_patterns()` returns without reading `raw_content` (**assert on the query**, not just the result).
- **Commit:** `feat(agent): infer why for live patterns only`

> ### CHECKPOINT 3 — **read the promoter diff yourself.** Examples A, C, D pass. This is where a wrong call poisons the bank invisibly.

## A8 — Portrait blocks + pulls catalog

- **Reads:** `04` §6 + §"Pull catalog", `03` §Letta
- **Does:** Rebuild named slots — `current_goals`, `current_state`, `live_tensions`, `significant_people`, `open_threads`, `self_talk_now`, `what_changed` — from `current_truth` + `live_patterns`, each carrying source IDs. Cook 0 becomes **patch-by-slot**. Complete the pull catalog: `portrait`, `facts_about`, `goals_vs_behavior`, `significant_people`, `self_talk`, `gaps`, `search_nl`, and `lineage(id, direction)` — walk the provenance chain up or down from any ID ([`14`](./14-lineage.md)). Pure SQL over foreign keys that already exist.
- **Hard constraint:** [`backend/src/services/goals.ts:466`](../../backend/src/services/goals.ts) reads `understanding.document.active_goals` directly for onboarding. **Keep that shape, or change `goals.ts` in the same commit.** Break it and onboarding silently falls through to the goal-candidates graveyard (D9).
- **Must not:** leave a block populated from anything it cannot trace to live IDs. Empty beats January's marathon.
- **Gate:** after Example B, `current_goals` has no marathon; every pull has a fixture test returning IDs; `gaps()` reports the missing source; running Cook 0 twice is a no-op.
- **Commit:** `feat(agent): rebuild portrait blocks from live graph`

## A9 — Lint (detection only)

*Full check catalog, capability requirements and gates: [`13-lint-design.md`](./13-lint-design.md).*

**Why it earns a place:** the audit found `identity_inferences` were never retired despite the schema carrying `superseded_by`, `retired_at` and `retirement_reason`. **Rot is the documented failure mode of this exact system**, and nothing else in the plan notices it.

**Why here, before the cooks:** every derived object now exists, and you want the bank clean *before* a consumer starts reading it.

**Why detection ships alone:** doc 13 identifies eight remediation capabilities, most of them new. Building all eight speculatively — before knowing which findings ever fire — is exactly the kind of work this plan avoids elsewhere. Detection is read-only and cannot break anything; remediation is A12, scoped by what A9 actually finds. Until then a human fixes the rare finding by hand, which is tractable precisely because the target is a near-empty findings list.

- **Reads:** `13`, `04` (statuses), `01` (extreme-severity rules)
- **Touches:** new `src/brain/lint.ts`, `lint_findings` table, a scheduled entry point, the safety alert route
- **Does:** the 21 checks in doc 13, each carrying the sentence it prevents. Write findings with severity, the specific row IDs, and the suggested remediation. **Route `safety` findings off the list entirely** — an `extreme` pattern marked episode-promotable, or a why attached to one, must not sit alongside stale significance scores.
- **Must not:** modify a single row of the derived layer. Auto-merge patterns (rule 3 — P4 flags and stops). Make an LLM call per row. Add a check without a user-facing sentence in its definition.
- **Gate (A):** every check has a fixture that triggers it and one that doesn't — corrupt an excerpt → F1 fires; retire a why's evidence → W2 fires; duplicate a fact under a second origin key → F6 fires. **The golden corpus produces zero findings.** The whole pass is SQL.
- **Gate (B):** run against the full corpus after A8; every finding is either real or the check is wrong — "acceptable background noise" is not a category. A fixture `extreme` pattern routes to the alert path, not the list.
- **Commit:** `feat(agent): lint detection over the derived layer`

## A10 — Cook A, Cook B, evidence pack

- **Reads:** `01` Example E, `04` §"What Cook B should do" + §7
- **Does:** Cook A loads portrait blocks + this week's facts + live pattern IDs (the 14-day dump stays as a **supplement**, not the definition of the person). Cook B runs the Example E pull loop and assembles an evidence pack — portrait block IDs, pattern IDs, assertion IDs, why IDs, gaps, query log — persisted onto the run. **Fix the 5-vs-7 tool lie** in `historical-agent-system.ts`. `notRealizedYet` may only reference existing Pattern IDs, or the field goes.
- **Must not:** add a reranker (D6). Raise `agentMaxIterations` in the same commit. Let Cook B mint Patterns (D5).
- **Gate:** prompt tool list matches registered tools exactly; a fixture run produces a pack of real IDs and invents nothing; every pack ID resolves to a real row.
- **Commit:** `feat(agent): cook B researches via typed pulls`

## A11 — Cook C constraint + gaps

- **Reads:** [`14-lineage.md`](./14-lineage.md)
- **Does:** Cook C emits **cited segments** rather than flat prose — each segment carries the assertion, pattern, why or gap IDs it drew on ([`14`](./14-lineage.md)). Uncited segments are allowed (transitions, framing, questions) and counted, because a transcript that is mostly uncited is mostly improvisation and you should be able to see that as a number. The pack constraint becomes enforceable at write time instead of tested afterwards. Gap lines are a required pack field and surface in the transcript.
- **Must not:** predict next week (D8).
- **Gate (A):** fixture pack → transcript names no unknown Pattern; every citation resolves to a real row; groundedness rate computed automatically from citations; no forward-looking section; the `extreme` fixture never appears. **Gate (B):** one real episode end to end, and `lineage()` walks from one transcript segment back to the journal sentence behind it.
- **Commit:** `feat(agent): constrain cook C to the evidence pack`

## A12 — Remediation capabilities + audit

**Scoped by A9's real output.** Build the capabilities whose findings actually fired; leave the rest unbuilt. Capability table with outcomes: [`13`](./13-lint-design.md#capabilities-this-requires).

The candidates, as outcomes rather than implementations:

| Capability | Outcome | For |
|---|---|---|
| Re-process a source row | A named `raw_content` row runs through ingest again, overriding A3's completed-skip, without duplicating facts | S1 |
| Re-run a derivation at a version | Supersession, promoter and significance re-run over existing data, recording which version produced the result | F3, P3, E3 |
| Machine-initiated retire | The system retires something with a recorded reason and triggering check, distinguishable from `user_confirmed` / `contradicted` | F1, F2, W1–W4, P2 |
| Structural repair | Status and relation inconsistencies corrected by a defined operation, never ad-hoc SQL | F4, F5 |
| Merge duplicates | Two assertions collapse into one, **all evidence moving to the survivor**, original IDs recorded | F6 |
| Escalate | A finding reaches a person with rows named and remediation proposed | E1, E2, P4 |

- **Must not:** auto-merge patterns, ever (rule 3). Apply any correction without writing `remediation_log`. Let lint itself call these — a human or a separate explicit job invokes them.
- **The non-negotiable:** `remediation_log` records what changed (table, row, before/after), the triggering finding, the capability used, the actor and the timestamp. Every other claim in this system is traceable; a remediation path that mutates the bank without the same trail would be the one unaccountable thing in it.
- **Gate:** each capability is idempotent — applying it twice changes nothing the second time. Every invocation writes an audit row. A fixture proves a corrected finding does not reappear on the next lint run.
- **Review:** `/code-review` — these are the only write operations in the system that alter existing derived data.
- **Commit:** `feat(agent): lint remediation capabilities with audit log`

> ### CHECKPOINT 4 — human
> All 12 acceptance tests in `01`. Per 06, a thinner cut may leave #11 or a search UI incomplete; it may **not** leave 1–3, 5–7 or 9 incomplete and call the project done. Then read the judgment corpus (doc 11) and, after that, real journals.

---

## Also in scope, sequenced separately

| | What | When |
|---|---|---|
| **A4.2b** | Read-only search window — facts, patterns, portrait, whys, lint findings, with a "current only" filter | Any time after A8; earlier if you want to see real data sooner |
| **Persona layer** | Doc 12 — public content via connector, divergence promoter, charitable mechanisms | Stage 3.5, after A6 has passed Checkpoint 3 |

---

## What is deliberately not an agent

Per `05` non-goals — if an agent proposes any of these, it has drifted:

iOS work · TTS / player bugs · connector platform · Temporal · vendoring gbrain / Graphiti / Letta / LangExtract · goal-candidate promotion · next-week prediction · clinical/CBT stack · a reranker · a second graph store · historical backfill of `identity_inferences`.

---

## Running this

One agent at a time. Read the diff, run the gate yourself if it was Tier B, then launch the next. `/code-review` on A1, A4, A6. At a checkpoint, stop and decide — do not let momentum carry a bad `writeFact` signature or an over-merging promoter into four downstream agents.

If an agent reports something contradicting 00–08, **the working tree wins** — update the briefing in the same PR.

# Follow-on work (not in the 11)

Recorded here so it isn't lost. Neither of these blocks the plan; both are the natural next project.

## F1 — Fix the API ↔ agent seam

**The problem.** `POST /content` returns 202 and then fire-and-forgets a synchronous HTTP call, with a 450s timeout, to a service that does multi-minute LLM work. That's neither synchronous nor properly asynchronous. Consequences today:

- A transient 5xx means the journal silently sits `pending` with nothing watching it
- [`agent-client.ts:69`](../../backend/src/services/agent-client.ts) must refuse to retry 5xx, because ingest is non-idempotent
- `INTERNAL_API_SECRET` is auth between two services the same team controls

**The fix is a queue, not a merge.** The API writes `raw_content` and enqueues; the agent claims work when it can. No timeout, no shared secret on the handoff, crashes recoverable by construction, retries natural. The `processing_queue` table already exists in the old schema and nothing writes to it.

**Why it's cheap after this project:** A1 (`origin_key` upsert) and A3 (lease + heartbeat + idempotent completion) are ~80% of a queue-based handoff. They're in the plan for durability reasons; the seam fix mostly falls out.

**Explicitly not the fix:** merging the two services into one. That hides the problem rather than solving it — you'd still have a web request triggering a multi-minute job, minus the network hop that makes it visible — and it merges the public surface with the service-role-key surface. Deployment topology is an operational decision; the boundary is the architectural one. See the four rules in the layering discussion: front door, immutability line, pull layer, one writer per table.

**Also worth doing whenever someone is in there:** shared config as a package. Embedding settings, table constants and content types are currently defined in both repos, and they have already drifted once.
