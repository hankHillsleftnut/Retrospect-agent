# Lint design

The design A9 implements. Companion to [09](./09-agent-execution-plan.md); object model in [04](./04-target-architecture.md); what the system is permitted to claim in [01](./01-locked-product-behavior.md).

---

## Goal

**Detect when the derived layer has drifted from being a truthful model of the person, before a podcast reads it aloud.**

Not database inconsistencies in the abstract. The conditions under which the system would say something false, unsupported, or cruel about someone.

The documented failure mode of this exact system is already on record: `identity_inferences` carried `superseded_by`, `retired_at` and `retirement_reason` columns, and the audit found rows were **never retired**. The schema supported decay; nothing watched for it. That is the class of thing lint exists to catch.

---

## The test every check passes

For each check, write **the sentence a user would hear if this went undetected.** That sentence is part of the check's definition. If you can't write a plausible one, it is not a lint check — drop it or make it an ops metric.

Two candidates were dropped by this rule during design, and they're recorded below so nobody re-adds them.

## Severity

| | Meaning | Path |
|---|---|---|
| **safety** | The system could say something harmful | Separate alert, looked at immediately |
| **bug** | An invariant is violated; this should have been impossible | Findings list, treated as a defect |
| **rot** | Becoming true over time; a claim decaying toward false | Findings list, normal maintenance |
| **info** | Worth a glance; no wrong sentence results | Findings list, low priority |

---

## Hard rules

1. **Lint reports. It does not fix.** Auto-repairing a derived layer is how you silently delete evidence. Findings carry a suggested remediation; a human, or a separate explicit job, applies it.
2. **Every machine correction records** what changed, why, which check triggered it, and when. Remediation needs provenance for the same reason facts do — otherwise lint is an unaudited mutation path into the bank, which is worse than the rot it was built to catch.
3. **Never auto-merge patterns.** Two live patterns sharing facts is a flag for a human. Merging is the exact failure the promoter is designed to prevent; lint must not become a back door to it.
4. **Every finding names the rows.** A count is not actionable.
5. **A clean golden corpus produces zero findings.** Lint that always fires is ignored within a week — and then the rot is invisible again *and* you believe you're watching for it.
6. **Two fixtures per check:** one that triggers it, one that doesn't.
7. **Nightly over the whole bank.** SQL, not an LLM call per row.
8. **Rare and meaningful beats frequent and maybe.**

---

# The checks

## Sources

| ID | Condition | The sentence it prevents | Sev | Remediation |
|---|---|---|---|---|
| **S1** | `raw_content` `completed`, zero assertions reference it via evidence | *"You haven't mentioned work much lately."* — they journaled about it three times and extraction silently produced nothing | bug | Re-process source row **(new)** |
| **S2** | `raw_content` in `processing` past lease TTL | *"Sounds like a quiet week."* — the entry describing the week never finished | bug | Lease expiry should auto-release (A3); if it didn't, that's the defect — escalate |
| **S3** | `raw_content` `pending` older than N hours | *"Quiet week."* — they wrote every day and none of it was ingested | bug | Trigger ingest for named rows *(exists — CLI)* |

**Dropped by the sentence test:** *`raw_content` completed with null embedding.* It degrades `search_nl` fallback only; no episode sentence follows from it. **Ops metric, not lint.**

## Facts

| ID | Condition | The sentence it prevents | Sev | Remediation |
|---|---|---|---|---|
| **F1** | Evidence `excerpt` is no longer a substring of its source row | *"You told yourself you were too tired."* — they never wrote that | bug | Machine-retire with reason **(new kind)** + investigate, because sources are supposed to be immutable |
| **F2** | Assertion with no `assertion_evidence` row | *"You skipped standup three Thursdays."* — with no way to show which | bug | Machine-retire **(new)** |
| **F3** | Two `active` assertions, same subject + predicate, contradicting objects | *"Your goal is the half marathon."* — in an episode that elsewhere says they quit | bug | Re-run supersession over the pair **(new)** |
| **F4** | `valid_to` set but `status` still active | *"You're still training for the half."* — retired in the data, live in the query | bug | Repair status consistency **(new)** |
| **F5** | Assertion marked `superseded` with no `supersedes_id` pointing at it | *"Three months ago you were training."* — with nothing linking it to what replaced it, so `changed_since` can't return the pair | bug | Repair relation chain **(new)** |
| **F6** | Near-duplicate facts under different `origin_key`s | *"You've mentioned this six times."* — it was three, counted twice | bug | Merge assertions, evidence preserved **(new)** |

**F6 is the one to weight.** Duplicate facts inflate `instance_count`, which can push a behaviour over the promotion bar that never earned it. A duplication bug becomes an invented pattern.

## Entities

| ID | Condition | The sentence it prevents | Sev | Remediation |
|---|---|---|---|---|
| **E1** | Two entities with high alias overlap and no resolution candidate | *"Alex came up twice this week."* — it was six times across two unmerged identities, and neither crossed the significance threshold | rot | Create resolution candidate retroactively **(new, small)** |
| **E2** | Resolution candidates unresolved for N days | Same sentence as E1, arriving through a queue nobody drains | rot | Escalate to human. *Action exists (`resolve_entity_candidate`); the surfacing doesn't* |
| **E3** | Significance score with no mentions in N weeks | *"Alex has been a big part of your life."* — about someone they stopped seeing in March | rot | Recompute significance **(new)** |

**Dropped by the sentence test:** *entity with zero assertions.* No episode sentence follows. **Ops metric.**

## Patterns

| ID | Condition | The sentence it prevents | Sev | Remediation |
|---|---|---|---|---|
| **P1** | Live pattern with no supporting fact in N weeks | *"You're still disappearing on Thursdays."* — they stopped six weeks ago | rot | Confidence decay should have demoted it (A6); this check verifies decay actually ran |
| **P2** | Pattern whose supporting facts were all retired or superseded | *"This keeps happening to you."* — built entirely on facts the system no longer believes | rot | Retire pattern *(exists)* |
| **P3** | Live pattern with `instance_count` below the current bar | *"You've done this three times."* — it was two | bug | Re-run promoter at a stated version **(new — this is what `promoter_version` is for)** |
| **P4** | Two live patterns sharing more than X% of their facts | *"There are two things you keep doing."* — it's one thing described twice, which makes the person sound more troubled than they are | rot | **Escalate to human. Never auto-merge (rule 3)** |
| **P5** | `extreme`-severity pattern marked episode-promotable | *"Let's talk about your breakup."* — the thing the product promised never to do unasked | **safety** | Correct the flag + **immediate alert (new path)** |

**Dropped by the sentence test:** *candidate never promoted after N months.* Candidates aren't readable by episodes, so no sentence follows. **Ops metric.**

## Whys

| ID | Condition | The sentence it prevents | Sev | Remediation |
|---|---|---|---|---|
| **W1** | Why attached to a pattern that isn't `live` | *"You avoid things when they get hard."* — derived from a pattern that never cleared the bar. **This is "it called me avoidant after one bad day" arriving through the back door** | bug | Retire why *(exists after A7)* |
| **W2** | Why whose evidence assertions were retired | *"You do this because you're ambivalent about the job."* — the facts behind that were retired in March | rot | Retire why *(exists)* |
| **W3** | Why with confidence above the provisional ceiling | *"The reason you do this is..."* — stated as fact when the object is explicitly labelled inferred | bug | Repair or retire |
| **W4** | Why attached to an `extreme`-severity pattern | *"The reason you're struggling is..."* — psychoanalysing a crisis | **safety** | Retire + **immediate alert (new path)** |

## Portrait

| ID | Condition | The sentence it prevents | Sev | Remediation |
|---|---|---|---|---|
| **Po1** | Block citing superseded or retired assertion IDs | *"Your goal is the half marathon."* — January's answer, in September | rot | Rebuild block *(exists after A8)* |
| **Po2** | Block citing pattern IDs that aren't live | *"One of your live tensions is..."* — about a pattern that retired | rot | Rebuild *(exists)* |
| **Po3** | Block with prose but no source IDs | *"You're someone who treats consistency as self-respect."* — from where? Untraceable, and the design says empty beats unsupported | bug | Rebuild or empty *(exists)* |
| **Po4** | Portrait older than N days while facts changed | *"Here's where you are right now."* — from a month-old snapshot | info | Rebuild |
| **Po5** | User with facts but no portrait at all | Episode silently falls back to a 14-day dump and sounds generic | bug | Rebuild |

---

# Capabilities this requires

Each is stated as an outcome. Most don't exist yet — and they are **A12**, not A9.

**Detection ships before remediation.** Building eight capabilities speculatively, before knowing which findings ever fire, is the kind of work this plan avoids everywhere else. A9 is read-only and cannot break anything; A12 builds only what A9's real output proves is needed. Until then a human fixes the rare finding by hand — tractable precisely because the target is a near-empty findings list.

The one exception that ships with A9: the **safety alert path**. A safety finding sitting in a list waiting for tooling *is* the failure that class of check exists to prevent.

| Capability | Outcome required | Resolves | Exists? |
|---|---|---|---|
| **Re-process a source row** | A named `raw_content` row can be run through ingest again, overriding A3's completed-skip, without duplicating facts (`origin_key` still holds) | S1 | **New** |
| **Re-run a derivation at a stated version** | Supersession, the promoter, significance and the portrait can each be re-run over existing data, recording which version produced the result | F3, P3, E3, Po1–Po5 | **New** for supersession/promoter/significance; portrait exists after A8 |
| **Machine-initiated retire** | Something can be retired by the system rather than a user, with a recorded reason and the triggering check, distinguishable from `user_confirmed`/`contradicted` | F1, F2, W1–W4, P2 | **Partial** — `graph.ts` retires on human feedback only; a machine kind is new |
| **Structural repair** | Status and relation inconsistencies can be corrected by a defined operation, never ad-hoc SQL | F4, F5 | **New** |
| **Merge duplicates, evidence preserved** | Two assertions collapse into one, all evidence rows moving to the survivor, original IDs recorded | F6 | **New** |
| **Escalate to a human** | A finding reaches a person, with the rows named and the remediation proposed | E1, E2, P4 | **New** — needs the search window (A4.2b) |
| **Alert on safety findings** | `safety` findings leave the findings list entirely and reach someone immediately | P5, W4 | **New** |
| **Audit the remediation** | Every machine correction records what changed, why, which check, and when | All of the above | **New** |

**Deliberately absent: automatic pattern merging.** P4 flags and stops. Merging is the failure the promoter guards against; lint does not get a back door to it.

---

# Storage

**`lint_findings`** — **one stable row per finding, not one per run.** Keyed by `(check_id, subject_row_ids)`, carrying: severity, user, the specific row IDs, the sentence the check prevents (denormalised so a reader doesn't need the catalog), suggested remediation, `first_seen_at`, `last_seen_at`, `run_count`, and a resolution state so a finding can be acknowledged or marked false-positive without being silently dropped.

**`first_seen_at` is the most important debugging field in this design.** A finding that first appeared three weeks ago points at a deploy three weeks ago. Writing a new row per nightly run would give you the same finding thirty times, no way to tell new from persistent, and no date to correlate against — which is the difference between a diagnosis and a list.

**`remediation_log`** — one row per machine correction: what changed (table, row, before/after), the triggering finding, the capability used, the actor, the timestamp. This table is the answer to *"why does the bank say this now when it said something else last week."*

Rule 2 exists because of this table. Every other claim in the system is traceable — facts to spans, patterns to facts, episodes to packs. A remediation path that mutates the bank without leaving the same trail would be the single unaccountable thing in an otherwise accountable system.

---

# Debuggability

A finding tells you a state. Debugging needs the cause. What makes that possible here:

| Affordance | Gives you |
|---|---|
| Every finding names rows (rule 4) | Go straight to the data, not a count |
| Each check carries its sentence | What it *means*, not just what matched |
| Whole pass is SQL | Run any check by hand, mid-investigation |
| Two fixtures per check | Reproduce it in isolation |
| `first_seen_at` | Correlate against deploys and migrations |
| `assertions.model_version` / `normalizer_version` | Which code wrote this fact |
| `behavior_patterns.promoter_version` + grouping features in `metadata` | **Why** the promoter grouped these facts — the hardest thing in the system to debug |
| `remediation_log` | Every mutation of the derived layer, with its trigger |

**One gap worth closing in A1:** `assertions` has `model_version` and `normalizer_version` but **no link to the pipeline run that created it**. The older `identity_inferences` table carried `source_ingestion_run_id`; the newer graph tables dropped it. So "why did this fact appear on the 14th" is answerable only by inference.

Add `source_run_id` to `assertions` (and to `behavior_patterns`) when `writeFact` is extracted. It's one nullable column, it costs nothing, and without it the chain from a lint finding back to the run that caused it is broken at exactly the link you need most.

# Gates

**Tier A**
- Every check has a fixture that triggers it and one that doesn't.
- Corrupt an excerpt → F1 fires. Retire a why's evidence → W2 fires. Add a duplicate under a second origin key → F6 fires.
- **The golden corpus (doc 10) produces zero findings.** This is the real gate. A lint that fires on healthy data is noise, and noise is how the rot becomes invisible again.
- The full pass is SQL. No check makes an LLM call per row.

**Tier B**
- Run against the full golden corpus after A8. Every finding is either real or the check is wrong — there is no third option, and "acceptable background noise" is not a category.
- A safety finding routes to the alert path, not the list. Test with a fixture `extreme` pattern.

---

# What success looks like

Findings trend toward zero as bugs get fixed. The steady state is a small number of `rot` findings representing genuine maintenance — a person who changed, a pattern that ended, a merge needing human judgment.

If the noise level is constant, either the checks are wrong or nobody is acting on them. Either way lint has failed, and it has failed in the most dangerous way available: by looking like diligence.
