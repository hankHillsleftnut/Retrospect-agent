# Implementation plan

This is the work plan for a junior (or anyone) who has read files 00–05. It is sequenced so each phase makes the **requested end state** more true. Do not reorder to “get a visible podcast win” first. The podcast already runs. The bank does not.

**End state this plan serves** (from the founder): a robust system for ingestion, reading, and inferring patterns, then using that bank to write a good story about the person — including facts, patterns, why-after-pattern, portrait + search, people-with-significance, and an agent that asks many questions before audio.

---

## Effort (honest)

Estimates assume one engineer who has read this folder, can run both repos, and does not also rebuild iOS. Calendar time, not “ideal hours.”

| Cut | One engineer sequential | Two people (bank + story split after phase 1) |
|-----|-------------------------|-----------------------------------------------|
| **Full plan** (phases 1–4, tests, thin search, Cooks retargeted) | **9–14 weeks** | **7–9 weeks** |
| **Thinner cut** (phase 1 + supersession + promoter v1 + Cook B reads `live_patterns` only) | **6–8 weeks** | **5–6 weeks** |
| **Install Graphiti + Letta + LangExtract** as products, then adapt | **Add ~3–6 weeks** | Do not do this |

These are not a deadline. They are so you do not propose a weekend spike for the whole brain.

**Phase 1 alone** (the first slice): about **1.5–2.5 weeks** if graph-v2 is reused cleanly; **3+** if you rediscover identity and write a second upsert.

---

## Phase map

```
Phase 0   Orientation (this folder). No code required.
Phase 1   Journal → Facts. Durability. Embed sources.          ← start here
Phase 2   Time + identity hardening (supersession, current truth, aliases)
Phase 3   Pattern promoter + Why-after-pattern
Phase 4   Typed pulls + story agent consumes the bank
Phase 5   Optional: hybrid search, portrait polish, backfills, search UI
```

Phases 2 and 1 can overlap slightly (supersession belongs in `writeFact` — if you can land a small version in phase 1, do). Phase 3 **must not** start before Facts exist for journals. Phase 4 **must not** start before there is something to pull (Facts at least; Patterns if you want the story to use them).

---

## Phase 0 — Read and measure (1–2 days)

### Do

1. Read this folder in order. **Boot and first curl:** [08-day-0-handoff.md](./08-day-0-handoff.md) — do not skip it.
2. Run both repos locally; confirm `POST /content` hits the agent (exact commands in 08).
3. Re-measure the “production snapshot” numbers on the environment you will use (coverage of `raw_content.embedding`, counts of `assertions`, `entities`, `identity_inferences`). The numbers in `02` are last measured, not live.
4. Confirm whether live `observations.goal_id` is still `NOT NULL`. If it is, goal-less Facts **cannot** live in that table — another reason Facts go to `assertions`.
5. Confirm whether old `insight_units` pattern crons are still enabled. Do not extend them.

### Done when

- You can name the file that writes assertions (`graph-v2.ts`) and the file that does not (`ingest.ts`).
- You have a current count of assertions for a test user.

---

## Phase 1 — Journal ingest writes Facts (first tickets)

**Goal:** A journal that lands in `raw_content` produces **spanned, idempotent assertions**, the source is embedded, and a dead/retried ingest does not double-write.

This is the only phase you should start without further product debate.

### Ticket 1.1 — Shared `writeFact`

**Where:** `retrospect-agent/src/pipelines/graph-v2.ts` (extract; do not fork).

**Do**

- Extract `writeFact` / `writeObservedAssertion` so it can be called without a `source_items` row.
- Require `origin_key`.
- Accept `raw_content_id` evidence.
- Keep alias resolution + resolution candidates.

**Done when**

- `materializeGraphV2` still works (integrations are a regression test).
- A unit or integration test writes one assertion with only `raw_content_id` evidence.

### Ticket 1.2 — Ingestion agent emits Fact candidates

**Where:** `ingestion-agent.ts`, prompts, `ingest.ts`.

**Do**

- Structured output: `FactCandidate[]` with `excerpt` (see `04`).
- After the model returns: **substring check** against `raw_content.content`. Drop failures. Count them in the run summary.
- Map candidates → `writeFact` with deterministic `origin_key = journal:{raw_content_id}:{predicate}:{normalized_object}`.
- Resolve Self via existing `retrospect:user` / userId alias.
- **Do not** require `goal_id`.

**Compatibility:** you may still write observations so Cook A does not empty. That is not the success metric.

**Done when**

- Fixture journal: “I skipped Thursday standup” → ≥1 assertion, excerpt is a real substring.
- Invented excerpt → 0 assertions from that candidate.
- Re-running ingest on the same `raw_content_id` → **same assertion ids** (upsert), not 2x rows.

### Ticket 1.3 — Idempotent completion + lease

**Where:** agent `ingest.ts` + traces; API `content.ts` / `agent-client.ts` only as needed.

**Do**

- If this `raw_content_id` is already `completed` and origin keys exist, skip extract (or run extract as no-op upsert).
- Heartbeat / lease so a dead run is `failed` or `pending`, never `running` forever.
- **Do not** enable API 5xx retries until this ticket is true. Then you may retry.

**Done when**

- Kill the agent mid-ingest; row is not stuck `running` after lease TTL.
- Retry does not duplicate Facts (acceptance test 1–2).

### Ticket 1.4 — Embed `raw_content` on ingest + backfill

**Where:** agent embeddings path; `scripts/backfill-embeddings.ts` if it still exists.

**Do**

- On successful ingest, write `raw_content.embedding`.
- Backfill the user you care about. Do not treat 0% coverage as fine.
- Do **not** create a 3072-d IVFFlat index (it cannot work). Sequential scan is acceptable for phase 1.

**Done when**

- New journals have non-null embeddings.
- Backfill has a measured coverage % for the target user (not “we ran the script”).

### Phase 1 definition of done (gate)

All of these must be true on a **real** journal path (phone or equivalent `POST /content`), not only a unit test:

| # | Gate | Evidence |
|---|------|----------|
| 1 | Assertions exist for the journal | SQL count > 0 tied to that `raw_content_id` via `assertion_evidence` |
| 2 | Span rule | A tampered excerpt is rejected |
| 3 | Idempotency | Two ingest calls → one Fact set |
| 4 | Integrations unbroken | Existing `materializeGraphV2` path still writes |
| 5 | Embeddings | New row has `embedding` |
| 6 | No Pattern / Why yet | Zero new Pattern rows (table may not even exist) |

**Do not** start Cook B work at this gate.

---

## Phase 2 — Time, identity, current truth

**Goal:** “Quit marathon” retires “training.” Portrait current goals can be correct. `changed_since` has meaning.

### Tickets

2.1 **Supersession in `writeFact`.** Same subject+predicate, contradicting object → `valid_to`, `status=superseded`, `supersedes_id`, `assertion_relations`. Code, not the LLM.

2.2 **`current_truth` query.** `valid_to IS NULL AND status = 'active'`. Use this in any “what is true now” read, including a first Cook 0 patch if you start it here.

2.3 **Alias hygiene for journals.** People names from text: do not merge on first name alone. Prefer `(person, "Alex", namespace journal:name)` + resolution candidate if two Alexes appear. Email/calendar aliases remain exact.

2.4 **Significance stub.** On person-entity touch, bump a simple score (mentions + recency). Good enough for later pulls. Do not build profiles.

2.5 **Optional Cook 0 start:** `current_goals` block rebuilt from live goal assertions + `goals` table. If you only have time for one block, this is the one (Example B).

### Phase 2 done

- Example B as a test: January training + March quit → one live assertion (quit), one superseded (training).
- `changed_since(February)` returns the pair.
- Cosine would still return both; we do not care. The **query** is correct.

---

## Phase 3 — Pattern promoter + Why

**Goal:** Repeated behavior becomes a **stored Pattern**. Why exists only on that Pattern.

### Tickets

3.1 **Migration:** `behavior_patterns` + `behavior_pattern_facts` (+ `behavior_pattern_whys` or equivalent). Do **not** reuse `patterns`.

3.2 **Promoter v1 (boring).** After Fact write (or a follow-up job):

- Cluster by conservative features (predicate family + weekday / entity / time window).
- Open `status=candidate` after 2 standard facts if you want visibility; **promote to `live` only at the bar**.
- High severity: shorter bar. Extreme: do not mark usable-for-episode.

3.3 **Do not over-merge.** Tests: three Thursday skips → one Pattern; one skip → zero; two unrelated loops → two candidates, not one “avoidance.”

3.4 **Why job.** Only if `pattern.status=live`. Low confidence, `kind=inferred`, provisional. User-stated why stays a Fact.

3.5 **Feedback shape.** `user_rejected` / retire. API can wait; column must exist.

### Phase 3 done (product tests 6–8)

- Example A encoded as fixtures: week1 → no Pattern; week3 → one Pattern; Why only then.
- `live_patterns()` can be a simple SQL select. Implement the function even if Cook B does not call it yet.
- Promoter version column set.

**Do not** spend this phase on CAMI, COM-B full taxonomy, or CCD-CBT.

---

## Phase 4 — Story consumes the bank

**Goal:** Cooks ask the bank. Audio cannot invent Patterns.

### Tickets

4.1 **`src/brain/pulls.ts` (name flexible)** implementing the catalog in `04`. Unit tests with fixtures, no LLM.

4.2 **Cook A** loads portrait blocks + this week’s facts + live pattern **ids/labels**, not only a 14-day observation dump. Dump can remain as supplement.

4.3 **Cook B** tools: typed pulls. **Delete or demote** cosine-as-primary from the **prompt**. Fix the 5-vs-7 tool lie while you are there. `notRealizedYet` may only reference Pattern ids (or the field is removed).

4.4 **Evidence pack** written onto the run/episode.

4.5 **Cook C** constraint: no Pattern name/id unless in the pack. Test with a fixture pack.

4.6 **Gaps** in the pack (`gaps(this_week)`).

### Phase 4 done (product tests 9–12)

- Transcript contains no Pattern that is not in the pack.
- User search (even if only an internal HTTP or agent REPL) and Cook B share `pulls.ts`.
- Example E is the default loop (or a documented subset if you are on the thinner cut: at least `live_patterns` + `facts_for` + `changed_since`).

---

## Phase 5 — Optional hardening (do not confuse with “the brain is not done”)

Only after 1–4, or in parallel if staffed:

- Hybrid BM25 + vectors + `valid_to` in SQL
- Contextual chunk prefixes (Anthropic)
- Dimension strategy if sequential scan hurts (1536-d or HNSW) — **measure first**
- Backfill historical journals into Facts (batch extract). This is large; do not block the live path on it
- iOS search UI
- STORM-like citation metrics on episodes
- State / stage-of-change field if the founder wants evoke-vs-plan later
- Raise Cook B iterations **after** pulls return IDs

The **thinner cut** can stop after 4.3 with a subset of pulls and still be a real brain.

---

## First week, if you are the junior assigned tomorrow

Do these in order. Do not “explore Cook B.”

1. Read 00–05. Skim `ingest.ts`, `graph-v2.ts`, `content.ts`, `agent-client.ts`.
2. Phase 0 measure on your DB.
3. Ticket 1.1 `writeFact` extract + test.
4. Ticket 1.2 one fixture journal → assertions.
5. Ticket 1.3 lease/idempotency.
6. Ticket 1.4 embed + backfill script for your user.

If you finish 1.1–1.2 in a week, you are on pace. If you spend the week in `historical-agent-system.ts`, you are off the plan.

---

## Suggested PR titles (use the object names)

- `feat(agent): extract writeFact for raw_content evidence`
- `feat(agent): journal ingest writes spanned assertions`
- `fix(agent): idempotent ingest completion and lease`
- `feat(agent): embed raw_content on ingest`
- `feat(agent): supersede contradicting assertions in writeFact`
- `feat(agent): behavior_patterns promoter v1`
- `feat(agent): typed pulls for live_patterns and current_truth`
- `feat(agent): cook B researches via typed pulls`

Reject:

- `improve cook B prompt to find more patterns`
- `add mem0`
- `install graphiti`
- `add reranker to search_insights`

---

## Test plan (minimum)

You do not need a huge framework. You need **fixture-in, rows-out** tests that encode Examples A–E.

| Example | Phase | Assert |
|---------|-------|--------|
| A week 1 | 1, 3 | Facts yes; Pattern no; Why no |
| A week 3 | 3 | One Pattern; Why allowed |
| B marathon | 2 | Supersession; current_truth omits training |
| C barista vs Alex | 2–3 | Significance barista ≪ Alex |
| D extreme | 3 | Fact stored; not episode-promoted |
| E pack | 4 | Cook C subset of pack |

Plus: idempotent retry; span reject; integration graph still writes.

Do **not** use “the podcast sounded smarter” as a gate.

---

## Staffing (if two people)

| Person | Owns | Must not own alone |
|--------|------|--------------------|
| A (bank) | Phases 1–3, `writeFact`, promoter, pulls SQL | Cook C copy |
| B (story) | Phase 4 **after** pulls exist, pack, prompts | A second Fact schema |

Person B can fix the 5-vs-7 prompt **documentation** anytime; they must not invent retrieval.

---

## Risks (read before you cut scope the wrong way)

| Risk | Wrong response | Right response |
|------|----------------|----------------|
| Extraction quality is messy | Install LangExtract as production | Log drop rate; tighten schema; optional offline spike |
| Two “Alex”s | Fuzzy auto-merge | Resolution candidate |
| Empty historical graph | Pause live writes to backfill everything | Live path first; backfill as phase 5 |
| Podcast worse during transition | Keep Cook B cosine forever | Shim observations; point B at new pulls as soon as Facts exist |
| Promoter too aggressive | Ship it to audio immediately | Under-merge; candidate vs live |
| Time pressure | Only a prompt change | Ship phase 1 only; leave the goal honest |

---

## Definition of done for the **whole** project

The goal is not “docs exist” or “a PR landed.” The product is done when the **acceptance tests in `01`** are true in the running system:

1. Ingest retry does not duplicate Facts.
2. Dead ingest is `failed` or `leased`, not `running` forever.
3. Fact without verifiable span is not stored.
4. Two names → one entity or a resolution candidate.
5. Contradicting facts: old retired, current queries omit it.
6. Three standard repeats across two weeks → exactly one Pattern.
7. One standard journal → zero Patterns, zero Whys.
8. `get(live_patterns)` does not scan raw journals.
9. Transcript contains no Pattern that is not in the pack.
10. Portrait current goals match live assertions.
11. Once-mentioned person ≠ rich profile; frequent person has higher significance.
12. Search and episode research share the typed pull layer.

Until those are true, the second brain is **not** shipped. A thinner cut may leave 11 or a search UI incomplete; it may **not** leave 1–3, 5–7, or 9 incomplete and call the project done.

---

## What this plan deliberately does not schedule

- iOS redesign
- TTS / player bugs
- Nango / connector rewrite
- Temporal
- Vendoring gbrain
- Goal-candidate inbox
- Next-week prediction
- Clinical stack

See [05-decisions-and-non-goals.md](./05-decisions-and-non-goals.md).

---

## After the docs

These files are the briefing. **Implementation is a separate goal.** Do not start tickets unless someone assigns phase 1. When they do, start at ticket 1.1, not at Cook B.

If something in the repo has changed since this briefing (dates: September 2026), **the working tree wins**. Update the briefing in the same PR that invalidates it.

---

## File checklist for the junior

You should have read:

- [00-README.md](./00-README.md)
- [01-locked-product-behavior.md](./01-locked-product-behavior.md)
- [02-current-system.md](./02-current-system.md)
- [03-research-and-comparables.md](./03-research-and-comparables.md)
- [04-target-architecture.md](./04-target-architecture.md)
- [05-decisions-and-non-goals.md](./05-decisions-and-non-goals.md)
- This file
- [07-sota-capability-map.md](./07-sota-capability-map.md) (audit-era research; optional after 03)
- [08-day-0-handoff.md](./08-day-0-handoff.md) **before you run servers**

Code you open first:

- `retrospect-main/backend/src/routes/content.ts`
- `retrospect-main/backend/src/services/agent-client.ts`
- `retrospect-agent/src/pipelines/ingest.ts`
- `retrospect-agent/src/pipelines/graph-v2.ts`
- `retrospect-agent/src/agents/ingestion-agent.ts`
- `retrospect-agent/supabase/migrations/108_integration_operations_graph_v2.sql`
