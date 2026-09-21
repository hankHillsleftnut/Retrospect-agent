# Target architecture

This is the system we are building. It is **not** a rewrite of the iOS app, the API host, or the podcast TTS path. It is a change to **what ingest writes**, **what lives in Postgres**, and **what the story agent is allowed to read**.

If you get lost, go back to the object ladder in [01-locked-product-behavior.md](./01-locked-product-behavior.md#objects-you-must-not-collapse). Every section below maps to one of those objects.

---

## Design principles (do not violate these in a PR)

1. **Sources are immutable.** `raw_content.content` is never rewritten to “fix” the graph. If extraction was wrong, write a new derived row or retire an assertion. Do not edit the journal.
2. **Facts are checkable.** No span (or excerpt that is a substring of the source) → no Fact. Schema-valid JSON from an LLM is not enough.
3. **Current truth is queryable.** `valid_to IS NULL` (or `status = 'active'`) is how “what is still true” works. Cosine cannot do this.
4. **Identity is alias merge.** Two names for one person become one `entities` row, or an `entity_resolution_candidates` row. Never two competing pages that the writer must guess between.
5. **Patterns are not facts.** They are promoted after a bar. They have their own table. Cook B must not mint them.
6. **Why is not a fact.** It is inferred only after a Pattern exists, and is labeled inferred.
7. **Portrait is generated.** Named blocks are rebuilt from live assertions + live patterns. Cook 0 must not remain “rewrite a blob from a dump.”
8. **The story is a consumer.** Cook C may only use the evidence pack. The pack may only contain IDs that exist in the bank.
9. **One graph.** Journals and integrations write through the same `graph-v2` functions. Do not add a second store.
10. **Typed pulls first.** Natural language is a compiler into named queries, plus a fallback. It is not the primary API.

---

## Where the work lives

| Layer | Repo | What changes |
|-------|------|--------------|
| Upload / 202 / retries | `retrospect-main/backend` | Receipts, lease, idempotent completion, maybe a real queue write |
| Fact extract + graph write | `retrospect-agent` | Ingestion agent + `graph-v2.ts` shared from journals |
| Pattern promoter | `retrospect-agent` | New job, new table |
| Portrait blocks | `retrospect-agent` Cook 0 | Patch named slots from live graph |
| Typed pull API | `retrospect-agent` (and thin API routes if search UI needs them) | Named queries over assertions / patterns |
| Story | `retrospect-agent` Cooks A/B/C | A becomes “this week + portrait + live patterns”; B becomes “ask typed pulls → pack”; C writes from pack |
| Embeddings | both (same 3072-d model today) | Embed `raw_content` on ingest; backfill; do not treat this as the brain |

The phone stays a client of `POST /content` and podcast playback. Do not put graph logic in Swift.

---

## Object model (target)

Use existing tables where they already match. Add tables only when the object is new.

### 1. Source — already exists: `raw_content`

**Job:** the immutable file. The Obsidian lesson.

| Field you must treat as sacred | Why |
|--------------------------------|-----|
| `id` | Receipt. Every Fact points here. |
| `content` | The only text a span can be checked against. |
| `content_type` / `data_source` | Provenance. |
| `content_date` | Event time fallback. |
| `processing_status` | `pending` / `processing` / `completed` / `failed` — plus lease fields we will add. |
| `embedding` | Optional retrieval aid. **Not** required for a Fact to exist. |

**Never:** UPDATE `content` after insert. **Never:** derive Facts from a Cook B paraphrase.

Integrations already have a parallel source: `source_items` + `analysis_units`. Graph-v2 already accepts `raw_content_id` on `assertion_evidence`. Journals should use that column.

### 2. Entity — already exists: `entities` + `entity_aliases`

**Job:** one row per person / goal / event / topic / Self.

Existing types (do not invent a parallel enum without a migration):

```
person | organization | project | place | topic | event | goal | identity | emotion | habit
```

**Self** is already created in `materializeGraphV2` as:

```
entity_type: identity
canonical_name: Self
alias namespace: retrospect:user
alias: <userId>
```

Journal facts about the user should use this same Self entity. Do not create “User” as a second identity.

**Aliases:** `UNIQUE (user_id, namespace, alias)`. Exact alias match is how merge happens today. Ambiguous matches (same alias, two entity ids) write `entity_resolution_candidates` instead of silently merging. **Keep that.** ATOM paper: cheap exact/similarity first, escalate ambiguous pairs.

**People significance** is **not** a separate product. Store it as entity `attributes` (or a small `entity_significance` table if attributes get messy):

```
significance ≈ recency-weighted interactions × intensity × explicit closeness
```

Recompute on ingest when a person entity is touched. A barista mentioned once stays near 0. A partner mentioned weekly grows. Do not auto-grow a biography.

**Do not add** gbrain-style company/deal pages as first-class world objects.

### 3. Fact — already exists: `assertions` + `assertion_evidence` + `assertion_relations`

This is the Graphiti / SodaMem contract, already in SQL.

An assertion is:

```
(subject_entity_id, predicate, object_entity_id | object_value)
+ assertion_kind
+ valid_from / valid_to
+ event_time / observed_at
+ origin_key   UNIQUE per user  ← idempotency
+ supersedes_id
+ status
```

**Kinds already in the CHECK constraint:**

`observed | inferred | user_confirmed | contradicted | superseded`

**Use them this way:**

| Kind | When |
|------|------|
| `observed` | Default Fact from a source span. Almost everything ingest writes. |
| `inferred` | **Rare on Facts.** Prefer inferred **Why** on a Pattern. `materializeIdentityHypothesis` already writes inferred assertions — do not expand that as the Pattern store. |
| `user_confirmed` / `contradicted` | Human feedback via existing `POST /graph/assertions/:id/feedback`. |
| `superseded` | After a newer Fact retires this one. Also set `valid_to`, `supersedes_id` on the new row, and an `assertion_relations` row of type `supersedes`. |

**`origin_key` is the retry lock.** Today integrations use a deterministic key from source item + predicate. Journals must do the same:

```
origin_key = journal:{raw_content_id}:{predicate}:{normalized_object}
```

A second ingest of the same journal upserts the same key. It does **not** insert a second Fact.

**Evidence (required):** every new journal Fact writes `assertion_evidence` with:

- `raw_content_id`
- `evidence_role = 'supports'`
- `excerpt` that **is a substring** of `raw_content.content`
- later: `char_start` / `char_end` in `metadata` or new columns — add columns if you need them; do not skip the substring check while waiting for columns

If the excerpt is not a substring, **drop the Fact**. Log the reject. Do not store it with `confidence: 0.4` “anyway.”

**Supersession algorithm (implement in the shared write function, not in the LLM):**

1. Extract candidate Fact with span.
2. Verify span.
3. Resolve entities.
4. Look for an **active** assertion with same subject + same predicate (and comparable object type).
5. If the new object **contradicts** the old (quit vs training; broken up vs dating):
   - set old `valid_to = new.event_time` (or observed_at)
   - set old `status = 'superseded'`
   - set new `supersedes_id = old.id`
   - write `assertion_relations` (`supersedes`)
6. If it is the **same** claim again: attach new evidence to the existing assertion; bump `observed_at`; do not clone.
7. If it is **compatible additional** detail: new assertion, maybe `refines` relation.

The LLM must **not** be asked “please set valid_to.” It proposes claims. Code applies time.

**What is a journal Fact (examples):**

- User skipped Thursday standup on 2026-03-12.
- User said “I’m too tired” (self-talk quote — the quote is the object).
- User is training for a marathon (until superseded).
- User mentioned Alex in the role of manager.

**What is not a journal Fact:**

- “User has an avoidance attachment style.”
- “This is a hidden strength.”
- “They will skip next Thursday.” (predict is out of scope)

### 4. Pattern — **new table**. Do not reuse `patterns`

The existing `patterns` table (migration `001_initial_schema.sql`) is correlation/trend/habit over **legacy `insight_units`**. Different object. Different job. If a cron still writes it, do not extend it.

**Create** something like `behavior_patterns` (name TBD in the ticket; this briefing uses **Pattern** in prose and `behavior_patterns` in SQL so you do not collide).

Suggested columns (you may refine types; do not refine birth rules):

| Column | Purpose |
|--------|---------|
| `id` | Stable ID for pulls and episodes |
| `user_id` | Tenant |
| `slug` | Boring machine name: `thursday_standup_avoidance` |
| `label` | Short human label, still boring: “Skips Thursday standup when the week is sharp” |
| `status` | `candidate` / `live` / `retired` / `user_rejected` |
| `severity` | `standard` / `high` / `extreme` |
| `first_seen_at` / `last_seen_at` | Span of supporting facts |
| `instance_count` | How many supporting facts currently attached |
| `source_count` | Distinct `raw_content` / `source_item` ids |
| `significance` | Optional; can derive |
| `subject_entity_id` | Usually Self; sometimes a person-in-life loop |
| `metadata` | Grouping features, promoter version |
| `promoter_version` | So you can re-run without mystery |

**Link table** `behavior_pattern_facts`:

```
pattern_id, assertion_id, role (supports | weakly_related)
UNIQUE (pattern_id, assertion_id)
```

**Birth rules (from locked spec):**

| Severity | Bar to `live` |
|----------|----------------|
| Standard | ≥ 3 supporting facts, and (> 1 week span **or** > 1 source) |
| High | 2 facts, **or** 1 fact + a journal that names the same loop |
| Extreme / safety | Store Facts. **Do not** auto-promote into an episode. Different path. |

A single standard journal → **zero** Patterns.

**Grouping** (the hard part of phase 3): the promoter must decide that “skipped Thursday” and “couldn’t face standup” are the same loop. v1 can be conservative:

- Same predicate family + same weekday / same entity, or
- Embedding similarity **plus** a shared entity, or
- An LLM **proposal** that a human-equivalent test can reject (proposal is not the store)

v1 should **under-merge** rather than invent one giant “avoidance” pattern. Wrong merges poison the bank.

**Correction:** same shape as assertion feedback — confirm / reject / retire. Add API later; schema should allow `user_rejected` from day one.

### 5. Why — **new**, attached only to Pattern

Either columns on `behavior_patterns` or a child table `behavior_pattern_whys`:

| Column | Purpose |
|--------|---------|
| `pattern_id` | Required. No Pattern → no Why. |
| `kind` | `user_stated` is **not** this object (user-stated why is a Fact). This row is `inferred`. |
| `mechanism` | Short code: `avoidance`, `ambivalence`, `capacity`, `unclear` |
| `confidence` | Low by default |
| `status` | `provisional` / `live` / `retired` |
| `model_version` | |
| `evidence_assertion_ids` | The facts the inference used |

**Never** write a Why from one event. **Never** put Why text on `observations.reason_why` and call it done. That column is “why this observation relates to a goal.”

If the inferred Why is wrong, retire it. The Pattern and Facts stay.

### 6. Portrait — exists as `user_understanding.document`, must become named blocks

Today Cook 0 rewrites a JSON blob. Target: **Letta-style named blocks** stored either:

- as keys inside `document` with a stable schema **and** a rebuild function, or
- as rows in `portrait_blocks (user_id, slot, text, source_assertion_ids[], source_pattern_ids[], version)`

**Required slots (minimum):**

| Slot | Filled from |
|------|-------------|
| `current_goals` | Live goal assertions + `goals` table; **must** respect `valid_to` |
| `current_state` | Recent state-ish facts + live high-severity patterns (keep short) |
| `live_tensions` | Live patterns (ids + one-line labels), not poetry |
| `significant_people` | Person entities above a significance threshold + how the user is around them |
| `open_threads` | Unresolved loops the user named, as facts |
| `self_talk_now` | Recent self-talk facts (quotes) |
| `what_changed` | `changed_since(last_portrait_or_episode)` summary, generated |

Blocks must be **short**. If a block cannot be traced to live IDs, it is stale — rebuild or leave empty. Empty is better than January’s marathon.

Cook 0’s job becomes: **patch slots from new facts/patterns**, not “read 14 days of observations and rewrite the novel.”

### 7. Evidence pack — ephemeral per story run

Not necessarily a table (a JSON artifact on `pipeline_run_traces` or the episode row is enough).

```
{
  "portrait_block_ids": [...],
  "pattern_ids": [...],
  "assertion_ids": [...],
  "why_ids": [...],
  "gaps": ["no HealthKit this week", "Alex mentioned but no 1:1 facts since April"],
  "query_log": [ { "pull": "live_patterns", "count": 4 }, ... ]
}
```

Cook C may not mention a Pattern whose id is not in this pack. That is acceptance test 9.

### 8. Story — already exists: outline + transcript + audio

No new object. New **constraint**: the writer is not allowed to invent `notRealizedYet` types after the Pattern table exists. Historical “you haven’t named this” content is a **Pattern row**.

---

## End-to-end write pipeline (target)

```
POST /content
  1. INSERT raw_content (immutable)
  2. Return 202 + receipt { raw_content_id, revision }
  3. Enqueue ingest with lease (or mark processing + heartbeat)

Agent ingest (idempotent)
  4. Claim lease. If already completed for this revision, no-op.
  5. Extract candidate facts (structured output, json_schema)
  6. For each candidate: verify excerpt ⊆ raw_content.content; else drop
  7. Resolve entities (aliases). Ambiguous → resolution candidate, skip merge
  8. writeObservedAssertion / shared graph-v2 write
       - origin_key upsert
       - supersession in code
       - assertion_evidence with raw_content_id
  9. Embed raw_content (and optionally assertion text)
 10. Pattern promoter (cheap, can be same process or a follow-up job)
       - attach new facts to existing candidate patterns or open a candidate
       - promote to live if bar hit
       - only then maybe infer Why
 11. Cook 0: rebuild/patch portrait blocks from live graph
 12. Mark raw_content completed. Write receipt. Heartbeat end.
```

**On crash:** row is `failed` or lease expired → `pending` again. Re-run uses `origin_key` so Facts do not duplicate. Cook 0 is patch-based so a second run does not invent a second personality.

**On retry from the API:** same `raw_content_id` → same origin keys → upsert. This is why the current comment in `agent-client.ts` (“ingest is non-idempotent, do not retry 5xx”) can be **deleted after** phase 1 lands, not before.

Integrations keep calling `materializeGraphV2`. Extract a shared `writeFact(...)` so journals and integrations do not drift.

---

## Extraction (LangExtract’s contract, in our agent)

File to change: `retrospect-agent/src/agents/ingestion-agent.ts` and whatever persist function `ingest.ts` calls.

**Input:** raw text + existing UUD/portrait + known entity aliases (so the model can reuse names).

**Output (structured):** a list of candidates, not observations:

```ts
type FactCandidate = {
  subject: string;          // "Self" or a person name
  predicate: string;        // controlled vocab + escape hatch
  object: string | object;
  event_time?: string;
  excerpt: string;          // MUST appear in source
  char_start?: number;
  char_end?: number;
  severity_hint?: 'standard' | 'high' | 'extreme';
};
```

**Controlled predicates (v1 starter — extend carefully):**

```
stated_goal
quit_or_stopped
skipped_or_avoided
attended
said_about_self          // self-talk quote
mentioned_person
felt                     // user-stated feeling, still a fact
health_metric            // if source is Health
scheduled
communicated_with
```

The model may emit a free predicate. Code should **prefer** the list. Unknown predicates are allowed if spanned; they just make grouping harder.

**Still write observations?** During a transition window, you may keep writing observations so Cook A does not go empty. That is a compatibility shim. New Facts **must not** require `goal_id`. Do not spend phase 1 polishing observation quality.

**Do not** keep minting `identity_inferences` as the source of truth. Optional: stop inserting new ones once Facts exist.

---

## Typed pulls (primary read API)

This is what “easy to retrieve” means. Implement these as functions in the agent (and later HTTP if a search UI needs them). Cook B and any user search **share this layer**.

Natural language is allowed as:

1. A **compiler**: “how have I been with Alex since March?” → `facts_about(Alex) + since(March) + person_significance(Alex)`
2. A **fallback** when no pull fits: hybrid search over excerpts, still returning IDs

### Pull catalog

| Pull | Returns | Notes |
|------|---------|-------|
| `portrait()` | Named blocks | Always-on, small |
| `live_patterns()` | Pattern rows `status=live` | No journal scan |
| `pattern(id)` | Pattern + why + fact ids | |
| `facts_for(pattern_id)` | Supporting assertions + excerpts | |
| `facts_about(entity_id)` | Assertions where subject or object is the entity | Current and/or historical via flag |
| `current_truth(predicate?)` | Assertions with `valid_to IS NULL` and `status=active` | The Graphiti query |
| `changed_since(ts)` | Assertions with `valid_to` or `valid_from` after `ts`, plus supersession pairs | Example B |
| `goals_vs_behavior()` | Stated goals vs live/quit assertions vs related patterns | |
| `significant_people(opts?)` | People entities sorted by significance; optional `this_week` filter | |
| `self_talk(range)` | `said_about_self` facts | Quotes only |
| `gaps(range)` | Missing expected sources (no Health, no journal this week, …) | Required in the pack |
| `search_nl(q)` | Compiler + fallback | Last resort, not Cook B’s only move |

### What Cook B should do (target)

Replace “embed a vibe, cosine 8 insights” with something like Example E in the locked spec:

1. `portrait()`
2. `live_patterns()`
3. `facts_for` each live pattern (cap)
4. `changed_since(last_episode)`
5. `goals_vs_behavior()`
6. `significant_people({ since: this_week })`
7. `self_talk(this_week)`
8. `gaps(this_week)`
9. Optional `search_nl` for leftover outline questions
10. Build pack
11. Stop. Do not invent `notRealizedYet`.

`agentMaxIterations` can stay 6 or go up **after** tools return structured IDs. Raising the iteration cap on today’s cosine tools is not the project.

### Hybrid search (phase 2+, not the brain)

When `search_nl` fallback needs text:

- BM25 on excerpts / raw_content
- Vectors as a second signal
- RRF to fuse
- **Filter `valid_to` in SQL**, not in JavaScript after the fact
- Do **not** add a web cross-encoder as the first fix (research: Hurt Hit@1 on conversational memory)

Embeddings remain useful for “find similar journals.” They are not “what is still true.”

---

## Story pipeline (target)

```
Cook A   load: portrait blocks + this week’s new facts + live patterns (ids/labels)
         write: Outline V1 that points at IDs

Cook B   run typed pulls → evidence pack + gaps
         write: Outline V2 that may only cite pack IDs
         delete notRealizedYet invention

Cook C   write transcript from Outline V2 + pack
         TTS unchanged
```

Cook A’s 14-day dump can remain as a **supplement** for “what happened this week” while fact coverage is thin. It must not remain the definition of the person.

**Gap lines are product, not polish.** “We have no email this week” is a required pack field.

**Predict** is forbidden in outline and transcript.

---

## Shared write function (the one refactor that matters)

Today `graph-v2.ts` is integration-shaped: it maps `canonical_type` → predicate, then `writeObservedAssertion`.

Target: a function both paths call:

```ts
writeFact({
  userId,
  subjectEntityId,
  predicate,
  objectEntityId?,
  objectValue?,
  eventTime?,
  originKey,          // required
  evidence: {
    rawContentId? | sourceItemId? | analysisUnitId?,
    excerpt,
    role: 'supports',
  },
  kind?: 'observed',
})
```

Inside: span/excerpt check (journals), upsert on `origin_key`, supersession, evidence upsert.

`materializeGraphV2` becomes a **mapper** from integration records into `writeFact`. Journal ingest becomes a **mapper** from `FactCandidate` into `writeFact`.

If you add a second upsert path in `ingest.ts` that inserts into `assertions` directly, you will drift. Don’t.

---

## Durability (gbrain receipts + Temporal’s contract, without Temporal)

Minimum to call ingest “robust”:

| Mechanism | Why |
|-----------|-----|
| Receipt `{ raw_content_id, revision }` on 202 | Client and logs can see what was accepted |
| Lease + heartbeat on the row or `pipeline_run_traces` | Dead worker → expired lease → retryable, not `running` forever |
| `origin_key` unique | Retry ≠ duplicate Facts |
| Verifier before commit | Span check **before** insert. Self-healing paper: verifier → 0% silent bad commits in their harness |
| Idempotent Cook 0 | Patch by slot, or version vector so a double run is a no-op |
| Do not retry the HTTP call until the above exists | Current `agent-client.ts` comment is correct **until** phase 1 |

You do **not** need Temporal, DBOS, or River for v1. If leases fail at scale, then consider a queue. The contract is the point.

---

## How this maps to today’s files

| Target piece | Start from this file | Do not start from |
|--------------|----------------------|-------------------|
| Fact write | `graph-v2.ts` | `observations.ts` in the API |
| Journal extract | `ingestion-agent.ts` + `ingest.ts` | Cook B tools |
| Portrait | `cook0-agent.ts` | Rewriting the iOS onboarding copy |
| Typed pulls | New module, e.g. `src/brain/pulls.ts` | `search-insights.ts` cosine |
| Pattern promoter | New module + new table | `notRealizedYet` in the historical prompt |
| Story | `podcast.ts`, `podcast-agent.ts`, `historical-agent-system.ts` | After the bank has rows |
| Embed raw | Agent embeddings + `100_agent_extensions.sql` RPC | A new embedding model as a blocker |

---

## What stays (so you do not boil the ocean)

- iOS journaling and playback
- Express API auth and `POST /content` as the upload door
- Shared Supabase
- ElevenLabs TTS
- Integration sync → `materializeGraphV2` (extend, don’t replace)
- Assertion confirm/contradict/retire API
- `goals` as the user-facing goal list (the bank **mirrors** pursuit/quit; it does not replace the goals product)
- Observations/insights as a **compatibility** read for Cook A until pulls exist

---

## Failure modes you must design for

| Failure | Correct behavior |
|---------|------------------|
| LLM invents a quote | Span check drops it. Ingest still completes. |
| LLM splits one person into two names | Alias miss → two entities + maybe a resolution candidate. Promoter and people pulls will look worse until merged. Do not auto-merge on first-name only. |
| Ingest dies after facts, before Cook 0 | Facts stay. Portrait stale until retry. Retry must not duplicate facts. |
| Promoter over-merges | One junk Pattern. Prefer under-merge. Version the promoter. |
| Cook B ignores pulls | Prompt + tool list must match. Today they already don’t (5 vs 7). When you add pulls, **delete** the cosine-as-primary tools from the prompt or the model will keep using them. |
| Empty graph in prod | Expected until journals write it. Measure coverage. Do not declare “search is done” on an empty table. |

---

## Mental model for debugging

```
User says: “the podcast doesn’t know me”
  → Did ingest write assertions for this week’s journals?     (phase 1)
  → Are they current (valid_to)?                              (phase 2)
  → Did a Pattern exist before the writer needed it?          (phase 3)
  → Did Cook B pull those IDs into a pack?                    (phase 4)
  → Did Cook C stay inside the pack?                          (phase 4)

User says: “it called me avoidant after one bad day”
  → A Why or Pattern was born too early. This is a spec bug.
```

Next: [05-decisions-and-non-goals.md](./05-decisions-and-non-goals.md) — why we copy contracts and refuse products.
