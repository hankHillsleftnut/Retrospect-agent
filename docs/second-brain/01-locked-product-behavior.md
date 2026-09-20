# Locked product behavior

This file is the **spec of what the second brain must do**, in the founder’s words as recorded in product discovery (September 2026). If a ticket conflicts with this file, this file wins until the founder changes it.

A junior developer should be able to implement without re-asking “but what do we mean by pattern?”

---

## The product in one sentence

Build a **very robust system for ingestion, reading, and inferring patterns**, then **use all of that data to make a good story about the person** — plus everything specified below.

The brain is **not** the story. The brain is the **bank**. A separate narrative system (today: Cooks A/B/C → audio) pulls from the bank.

---

## Why this is not “better RAG”

Most AI memory products embed documents and retrieve similar chunks when you ask a question. That is what Cook B does today.

The founder’s brain is different:

| Better RAG | This product |
|------------|----------------|
| “Find journals about work” | “What is still true about this person?” |
| Similarity ≈ relevance | Similarity **cannot** see contradiction (a quit and a start look alike) |
| Patterns invented in the answer | Patterns are **stored objects** that persist across weeks |
| One search, then write | Many typed questions, then an evidence pack, then a story |
| Personality from one prompt | No psychological read from a single event |

If you ship “we added a reranker to Cook B,” you have not shipped this spec.

---

## Discovery questions and locked answers

These were asked explicitly. The answers are product law.

### 1. What must the brain know / be able to answer?

**Selected (all of these are in scope):**

| Capability | Plain language | Example the bank must support |
|------------|----------------|-------------------------------|
| **Facts** | What happened, who, when, what is still true | “Skipped Thursday standup on 2026-03-12. Source: journal #abc.” |
| **Patterns** | Recurring loops | “Disappears on Thursdays when the week gets sharp.” (only after repeats) |
| **Why** | Mechanism behind a pattern | Inferred: avoidance / ambivalence — **labeled inferred**, only on the pattern |
| **State** | Current inner state: readiness, what they can hear this week | Portrait block: current state |
| **Goals** | What they say they want vs what they are actually pursuing | Stated: marathon. Behavior: quit in March. Both stored; portrait shows the live one. |
| **Impediments** | The specific thing in the way, kept over time | Not a one-episode mention. A live object. |
| **People** | How they are with specific people, as those people affect the user | Alex is a manager; user goes quiet after 1:1s. Not Alex’s full biography. |
| **Self-talk** | How they narrate themselves | “I’m terrible at this” after one question — stored as a fact; may feed a pattern later |
| **Change** | How they differ from 3 months ago | Query: `changed_since(2026-06-01)` |

**Not selected:**

| Capability | Status |
|------------|--------|
| **Predict** next week’s behavior | **Out of scope.** Do not build forecasting. |

### 2. How automatic is the nuance?

**Locked:** both.

- A **living portrait** updates on ingest. Anything (episode, future search UI) can query it.
- The user (and the narrative agent) can **search the bank directly**.

It is not “only when the episode asks.” It is not “episode-only, then forget.”

### 3. What happens when an intimate inference is wrong?

Founder refinement: **patterns are their own section. They come up after someone exhibits a behavior a few times.**

That implies:

- One journal is **never** enough to mint a Pattern.
- Wrong inferences should be **provisional** and correctable (the API already has confirm / contradict / retire on assertions — same idea for Pattern why).
- Do not store a psychological “why” until a Pattern exists (see question 5).

### 4. How should the brain *talk*?

**Locked:** this brain is consumed by **another system that creates narrative**. Therefore the brain must be:

- Heavily **fact-based**
- The **easiest bank to retrieve from**
- Structured and typed, not literary

The podcast may sound like a smart friend. The **brain must not**. If you write pattern names as poetry, retrieval gets worse. Use concrete, boring labels. The narrative layer can humanize.

Internal types (distortion names, COM-B, stage of change) are allowed **inside** the bank if they help retrieval. They must not be required in user-facing audio. The founder’s split: **clinical/structured internally, human in the episode.**

### 5. What is allowed to live as a “why”?

**Locked:** infer why **only after a Pattern exists**. Never from a single event.

- User-stated why (“I skipped because I was ashamed”) can be stored as a **Fact** (they said it).
- System-inferred why (“this is shame-avoidance”) is a **Why** object on a Pattern, `kind = inferred`.

Never mix them in one column.

### 6. When does a behavior become a Pattern?

**Locked:** there is a **standard bar**, but **severe** things need a **shorter** bar.

Recommended default (implement this unless the founder changes numbers):

| Severity | Bar |
|----------|-----|
| Standard | Same behavior **≥ 3** times, and either **> 1 week** of span **or** **> 1 source** |
| High | **2** instances, or **1 instance + a matching journal** that names the same loop |
| Extreme / safety | Store as Fact. **Do not** auto-promote into an episode. Different product path. Safety content is not episode fuel. |

“Same behavior” means same loop, not the same sentence. “Skipped Thursday” in week 1 and “couldn’t face standup” in week 3 can be the same pattern if the promoter groups them. That grouping is the hard part of phase 3.

### 7. Whose life is this?

**Locked:** evaluate the **user and their life**. That includes people close to them **because they are part of the user’s life**.

Not: a gbrain of 24,000 people and companies as first-class world objects.

**People depth (locked):** as they appear in the user’s life, with a mechanism to be **more or less significant**. Closer + more interactions → more important.

```
significance ≈ recency-weighted interactions × intensity × explicit closeness
```

Partner mentioned weekly → thin profile grows (role, open threads, how the user is around them). Barista once → a fact, almost no profile.

### 8. How does the narrative system pull?

**Locked direction:** this will be **search from the user**, and **an agent that asks a lot of questions and retrieves a lot of information**, then turns it into proper audio.

Engineering default we chose (founder asked us to suggest the shape):

- **Typed pulls as the primary API** (`get(live_patterns)`, `get(facts_for: pattern)`, …)
- Natural language as a **compiler** into those pulls, and as fallback when no typed pull fits
- Output = **evidence pack** (facts + pattern IDs + separate inferred whys + gaps)
- Then audio. Not: one embedding query, then write.

Full list of pulls: [04-target-architecture.md](./04-target-architecture.md#typed-pulls).

---

## Objects you must not collapse

Junior developers often merge these because they “feel similar.” Don’t.

```
raw_content     immutable source. Never rewrite.
     │
     ▼
Fact            one checkable claim. Born on ingest.
     │
     │  (after the bar)
     ▼
Pattern         named loop. Own table. Own search.
     │
     ▼
Why             inferred mechanism. Only on Pattern.
     │
     ▼
Portrait        small current view generated from live facts + live patterns
     │
     ▼
Evidence pack   what the story agent is allowed to see this run
     │
     ▼
Story / audio   consumer. Must not mint new Patterns.
```

**Observations** and **insights** (current tables) are legacy derived rows. New facts should not depend on `goal_id`. New patterns must not be stored only as `insights` rows. Insights can remain as episode-oriented synthesis, but they are not the pattern store.

**Identity inferences** (current table) are high-level prose claims about “who this person is.” They are closer to a sloppy Pattern/Why hybrid. Do not keep inventing new identity inferences as the source of truth. The graph + pattern table replaces that role. Existing rows can be migrated later; do not block phase 1 on migration.

---

## Behavioral examples (use these in tests)

### Example A — facts vs pattern vs why

Week 1 journal: “I skipped Thursday standup. Told myself I was too tired.”  
→ **Facts:** skipped standup, date, source span. Self-talk quote. No Pattern. No Why.

Week 2 calendar: declined the same standup.  
→ **Facts.** Still no Pattern (only 2 events, standard severity — unless you score this high).

Week 3 journal: “Couldn’t walk in. Same thing as always.”  
→ **Facts.** Promoter groups with weeks 1–2 → **Pattern** `thursday_standup_avoidance`.  
→ Only now may a **Why** be inferred (`avoidance` / `ambivalence`), `inferred = true`.

Episode may walk up to the pattern with the three facts. It must not say “you have an avoidance disorder” unless that Why was stored and the narrative rules allow it. Founder heuristic for story: give pieces, don’t always name the realization. That is a **Cook C** rule, not a bank rule. The bank still stores the Pattern so next week can retrieve it.

### Example B — supersession (time)

January: “Training for a marathon.”  
March: “I quit.”  

Both are Facts. The March fact **retires** the January fact (`valid_to`, relation `supersedes`).  
Portrait “current goals” must not still say marathon.  
`changed_since(February)` must return this pair.  
Cosine search will retrieve **both** as similar. That is why cosine is not the brain.

### Example C — people significance

“Coffee with Sam the barista” once → entity Sam, low significance, no profile growth.

Weekly mentions of “Alex after 1:1 I can’t speak” → entity Alex, role manager, significance high, thin profile: how the user is around Alex, open thread.

Do not create a gbrain page “Alex’s career and investments.”

### Example D — severe bar

A single journal that describes a serious rupture (relationship ending, acute crisis) may promote a Pattern faster **or** stay a Fact and skip episode promotion. When in doubt, **store the Fact, do not auto-write it into audio.** Ask before expanding the severe classifier. Do not build a clinical diagnostic system.

### Example E — what the story agent asks

Bad (today): embed `"user procrastinating on creative projects"` → 8 similar insights → invent `hidden_strength`.

Good (target):

1. Read portrait.
2. Ask `live_patterns`.
3. Ask `facts_for` each live pattern.
4. Ask `changed_since(last_episode)`.
5. Ask `goals_vs_behavior`.
6. Ask `significant_people(this_week)`.
7. Ask `self_talk(range)`.
8. Note gaps (“no HealthKit this week”).
9. Build evidence pack.
10. Write audio from the pack only.

---

## Acceptance tests (product-level)

A phase is not done because “the model sounds smarter.” Use these.

1. **Ingest retry** does not create duplicate Facts for the same source row.
2. A dead ingest is **`failed` or `leased`**, never `running` forever.
3. A Fact without a verifiable span is **not stored**.
4. Two names for one person become **one entity** (or a resolution candidate), not two competing pages.
5. Contradicting facts: old one is **retired**, not deleted; queries for “current” omit it.
6. Three standard-severity repeats across two weeks create **exactly one Pattern**, not three, not zero.
7. A single standard journal creates **zero** Patterns and **zero** Whys.
8. `get(live_patterns)` returns the Pattern without scanning raw journals.
9. Cook C / transcript contains **no Pattern** that is not in the pack.
10. Portrait “current goals” matches **live** assertions, not January’s.
11. A person mentioned once does not get a rich profile; a person mentioned often has higher significance.
12. User (or agent) search and episode research use the **same** typed pull layer.

---

## What “good story” means (consumer rules)

The founder wants a good story **from** the bank, not instead of the bank.

- The storyteller may be warm, specific, and concrete.
- It must be able to point at **Fact IDs** and **Pattern IDs**.
- It should prefer **quantified** history (“three Thursdays”) because the Pattern stores counts.
- Historical “you haven’t named this yet” content comes from **Pattern** rows, not from Cook B improvisation.
- Gap notes are required: “we have no data from email this week.”
- Do not predict next week.

Existing Cook B prompt says: *don’t give them the realization; give every piece right before it.* That remains a **narrative** preference. It does **not** mean “don’t store the Pattern.” Store it. The writer can still stop short of naming it in audio.

---

## Voice of tickets

When you write a PR description, name the object:

- “Add Fact write on journal ingest” — phase 1
- “Promote Pattern after N facts” — phase 3
- “Cook B calls `live_patterns`” — phase 4

If your PR is “improve the Cook B prompt so it notices more patterns,” it is **wrong** after the pattern table exists, and it is **insufficient** even before.

Next: [02-current-system.md](./02-current-system.md) — what the code does today, so you can see the gap.
