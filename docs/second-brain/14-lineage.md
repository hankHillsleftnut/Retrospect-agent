# Lineage

How to answer two questions the system currently cannot:

- **Backward:** *"Why did it say that?"* — point at a sentence in an episode, get the facts behind it and the journals those came from.
- **Forward:** *"Where did this journal end up?"* — point at something you wrote, see what it became, or where it stopped.

---

## What already exists

Every link in the chain is a foreign key that the plan already creates:

```
raw_content ←── assertion_evidence ←── assertions ←── behavior_pattern_facts ←── behavior_patterns
                                            ↑                                          ↑
                                   portrait blocks                          behavior_pattern_whys
                                            └──────── evidence pack ────────┘
                                                            ↓
                                                        episode
```

Plus `source_run_id` on assertions (added in A1), `promoter_version` and grouping features on patterns, and `model_version` on everything derived.

**Two things are missing, and only one of them is hard.**

## Missing 1 — nothing walks the chain

The links exist; no code follows them end to end. This is a traversal, not new data.

## Missing 2 — the pack is a permission list, not a citation map

This is the real gap. Today's design ([04 §7](./04-target-architecture.md)) gives Cook C a pack of IDs it's *allowed* to use, and a test that it used nothing else.

It never records **which sentence used which ID**.

So "why did it say that" is answerable only as "it was allowed to say that." The chain breaks at the last link, which is exactly the one a person asking the question is standing on.

---

## The fix: a cited transcript

Cook C emits segments rather than prose, each carrying the IDs it drew on:

```
{
  "segments": [
    {
      "text": "Three Thursdays in a row you didn't make it to standup.",
      "cites": { "pattern_ids": ["pat_7"], "assertion_ids": ["a_31","a_44","a_58"] }
    },
    {
      "text": "You told yourself you were too tired.",
      "cites": { "assertion_ids": ["a_32"] }
    },
    {
      "text": "We don't have anything from your calendar this week.",
      "cites": { "gap": "no_calendar_data" }
    }
  ]
}
```

Segments with no citation are allowed — transitions, framing, questions. They're just marked as such, which is itself informative: **a transcript that is 70% uncited is mostly improvisation**, and you can now see that as a number.

### What this unlocks beyond lineage

| | Before | After |
|---|---|---|
| Groundedness rate ([10](./10-test-plan.md)) | Counted by hand | Computed from citations |
| "No Pattern outside the pack" (test 9) | A test after the fact | Enforceable at write time |
| Lint: episode cited a retired fact | Impossible to check | Trivial |
| "Why did it say that?" | Unanswerable | One lookup |

The groundedness one matters most. It was going to be a manual count you'd do occasionally; it becomes a number on every episode automatically.

---

## Backward traversal

Given a transcript segment:

```
segment
  → cited pattern      → its supporting facts
                       → its why (if any), and that why's evidence
  → cited assertions   → evidence rows
                       → excerpt + char offsets
                       → raw_content: the journal, its date, the surrounding text
  → cited gaps         → which expected source was missing
```

Every hop is a foreign key. The answer to *"why did it say I avoid Thursdays"* becomes three journal entries with their dates and the exact sentences, plus the promoter version that grouped them.

## Forward traversal

Given a `raw_content` row:

```
journal
  → facts extracted from it        (and: how many candidates were dropped for failing the span check)
  → which of those are still current, which were superseded and by what
  → patterns those facts support   (and whether each is candidate, live, or retired)
  → whys resting on those patterns
  → portrait blocks citing any of them
  → evidence packs that included them
  → episodes, and the specific segments that cited them
```

**Show where it stopped.** Most information never reaches a podcast — by design, there are five places it can halt. Forward lineage is most useful when it names the stop:

> *3 facts extracted, 1 dropped (excerpt not found in source).*
> *2 still current. 1 superseded on 5 March by "I quit the half."*
> *1 contributed to `thursday_standup_avoidance`, live since 26 Feb.*
> *That pattern was cited in episode 12, segment 4.*

A dead end with a reason is a better answer than a dead end.

---

## Where this lands in the plan

No new agent. Three additions:

| Where | Addition |
|---|---|
| **A11** (Cook C) | Emit cited segments instead of flat prose. Uncited segments allowed and counted. The pack constraint becomes enforceable at write time rather than tested afterwards. |
| **A8** (pulls catalog) | `lineage(id, direction)` — given any ID in the chain, walk up or down. Pure SQL traversal over existing foreign keys. |
| **A4.2b** (search window) | Render it. Click a fact, see its journal and everything it became. Click an episode sentence, see what's behind it. |

## Why this is worth the small cost

Every claim in this architecture is traceable in principle — facts to spans, patterns to facts, episodes to packs. Lineage is what makes that traceability *usable* rather than theoretical.

It is also the answer to the question that will eventually arrive from a real user: **"how do you know that about me?"** A system that can show three dated journal entries and the sentences it read is a fundamentally different product from one that says a model inferred it.
