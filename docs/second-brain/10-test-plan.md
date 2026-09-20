# Test plan

How we know each chunk worked. Companion to [09-agent-execution-plan.md](./09-agent-execution-plan.md).

Two things live here:

1. **The golden corpus** — 20 hand-written journal entries with known answers. Built once, replayed after every agent. This is the only progress signal that exists during Stages 1–3, when nothing is audible.
2. **Per-chunk tests** — for the chunks big enough to warrant one, and an honest list of the ones that aren't.

**Forbidden as a gate:** "the podcast sounded smarter." A more confident writer over an empty bank sounds better and is *more* wrong. That is the failure mode this project exists to fix (06, "Do not use 'the podcast sounded smarter' as a gate").

---

## What warrants its own test

A chunk needs a dedicated test when **it can fail silently**. If it fails loudly — typecheck error, crash, empty response — the compiler is already the test and a second one is ceremony.

| Can fail silently | Needs a test |
|---|---|
| A refactor that quietly changes what integrations write | Yes |
| A rule that drops bad data — you only notice by its absence | Yes |
| A threshold (3 repeats, not 2) | Yes, both sides |
| Anything that decides two things are "the same" | Yes, especially the negative case |
| A typed query returning the wrong set | Yes |
| A migration that won't apply | No — it fails loudly |
| A read-only report | No — the report *is* the deliverable |

---

# Part 1 — The golden corpus

One fictional user, ten weeks, January–March 2026. Every entry plants something. Nothing is filler.

Store as `retrospect-agent/test/fixtures/golden-corpus.json` — each entry `{ id, contentType: 'journal_entry', contentDate, content }`.

| ID | Date | Entry (verbatim — do not reword) | Plants |
|----|------|--------------------------------|--------|
| J01 | 2026-01-08 | "Signed up for the Bay Bridge half in May. Training plan starts Monday. Feels good to have something on the calendar." | Stated goal → later superseded |
| J02 | 2026-01-11 | "Three miles before work. Slower than I wanted but I did it." | Compatible detail — refines J01, must **not** supersede it |
| J03 | 2026-01-15 | "Grabbed coffee at the place on Fillmore, the barista Sam remembered my order. Small thing but it made the morning." | Person mentioned **once, ever** |
| J04 | 2026-01-22 | "1:1 with Alex. I had three things I wanted to raise and I raised none of them. Just nodded." | Alex (manager) thread begins |
| J05 | 2026-01-29 | "Ran five miles. Legs held up." | Goal still live at this point |
| J06 | 2026-02-05 | "Everything is falling apart. I'm a complete fraud and everyone's going to figure it out eventually. Couldn't get out of bed until noon." | **The trap.** Dramatic, high-intensity, never repeats |
| J07 | 2026-02-08 | "Better week. Ran twice." | Recovery — J06 was not a trend |
| J08 | 2026-02-12 | "Skipped standup. Told myself I was too tired." | Loop A, instance 1 (Thursday) |
| J09 | 2026-02-14 | "Cancelled dinner with Priya. Said I had a deadline. I didn't." | Loop B, instance 1 |
| J10 | 2026-02-19 | "Didn't go to standup again. Watched the invite sit there until it went red." | Loop A, instance 2 — **different words** |
| J11 | 2026-02-21 | "Priya asked about next week. I said I'd check and I won't." | Loop B, instance 2 |
| J12 | 2026-02-24 | "1:1 with Alex. Same thing. I go quiet and then I'm angry at myself on the walk back." | Alex significance climbing + self-talk |
| J13 | 2026-02-26 | "Couldn't walk into standup. Same thing as always." | Loop A, instance 3 → **promotes** |
| J14 | 2026-03-01 | "Bailed on Priya's thing. Third time. She's stopped suggesting." | Loop B, instance 3 → **promotes separately** |
| J15 | 2026-03-05 | "I quit the half. Haven't run in three weeks and I'm not going to start now." | **Supersession** — retires J01 |
| J16 | 2026-03-08 | "Alex asked if everything was okay. I said yes. It isn't." | Alex significance high |
| J17 | 2026-03-12 | "My sister Alex is visiting in April." | **Second Alex** — must not merge |
| J18 | 2026-03-15 | "I keep doing the thing where I say yes and then I disappear." | **Paraphrase trap** — distinctive phrasing |
| J19 | 2026-03-19 | "Mara and I are done. Eight years. I'm not okay." | **Severe one-off** |
| J20 | 2026-03-22 | "Went to standup. Didn't say much but I was there." | Counter-instance to a live pattern |

**Deliberately absent:** any health, calendar, or email data. The corpus must make `gaps()` report missing sources.

## The nine planted answers

After ingesting all 20, these must be true. Each one maps to a product lock, not an engineering preference.

| # | Must be true | Guards against | Lock |
|---|---|---|---|
| **G1** | Loop A (standup) is **exactly one** live pattern — not three, not zero | Counting instances as separate patterns | 01 test 6 |
| **G2** | Loop B (Priya) is a **separate** live pattern from Loop A | The over-merge failure: one giant "avoidance" | 04 §4 "under-merge" |
| **G3** | J06 produces facts and a self-talk quote, but **zero patterns and zero whys** | "It called me avoidant after one bad day" | 01 test 7 |
| **G4** | Current truth says the half is **quit**; J01 is retired, not deleted | Congratulating a goal they abandoned | 01 test 5, Example B |
| **G5** | J02 **refines** J01 — it does not retire it | Over-eager supersession | 04 §3 step 7 |
| **G6** | Sam has near-zero significance; Alex (manager) is high | Giving a stranger a profile | 01 test 11 |
| **G7** | Two Alexes = two entities **or** a resolution candidate — never one merged person | Silently fusing two people | 01 test 4 |
| **G8** | J18 is stored **verbatim**, not as "user reports a pattern of avoidance" | Paraphrase creeping in as a fact | 04 principle 2 |
| **G9** | J19 is a stored fact, marked severe, **not** promoted into an episode, **no** why inferred | Narrating someone's crisis back at them | 01 Example D, D10 |
| **G10** | `gaps()` reports no health/calendar data | Silent blind spots | 04 §7 |
| **G11** | Ingesting the corpus twice produces the **same** fact IDs | Duplicate memory on retry | 01 test 1 |

G3, G7 and G9 are the trust-critical ones. This product fails by being creepy, not by being unimpressive — a wrong pattern is embarrassing, a wrong psychological verdict after one bad day is unforgivable.

---

# Part 2 — Per-chunk tests

## Stage 0

**A0.1, A0.2 — no test.** The report is the deliverable. Quality bar: every item is KNOWN or NEEDS-HUMAN, and every claim cites `file:line`. No answer is "probably."

## Stage 1

### A1.1 — Extract `writeFact` · **warrants a test**
A pure refactor that could silently change what integrations write.

- **Golden-diff test:** run the existing integration path against a fixture set *before* the change, snapshot every row written. Re-run after. **Byte-identical** rows, same origin keys, same evidence.
- New capability: one assertion written with only `raw_content_id` evidence and a caller-supplied origin key.
- **Fails if:** integration origin keys change shape, or any evidence row that previously had a `source_item_id` now has null.

### A1.2 — Span verifier · **warrants the most careful test in Stage 1**
A pure function. Every normalization rule is a hole someone can push a fabricated quote through.

| Case | Expected |
|---|---|
| Exact substring | accept, correct offsets |
| Invented quote | **reject** |
| Curly quotes vs straight | accept, correct offsets |
| Double space collapsed to single | accept |
| Leading/trailing whitespace | accept, offsets exclude it |
| Unicode NFC vs NFD | accept |
| Real quote, **wrong source row** | **reject** |
| Paraphrase, 90% word overlap | **reject** |
| Empty string | **reject** |

Last two matter most: near-misses are exactly what an LLM produces. Each accepted normalization must be independently toggleable, so a reviewer can see what was allowed.

### A1.3 — Fact candidates · **warrants a test**
- J08 → ≥2 candidates: one `skipped_or_avoided`, one `said_about_self` carrying "Told myself I was too tired."
- Every `excerpt` is a real substring of that entry.
- Existing observations/insights outputs unchanged in shape (the Cook A shim must not break).
- **Fails if:** the model returns a tidied paraphrase as an excerpt. Watch J18 specifically.

### A1.4 — Wire to `writeFact` · **warrants a test — the Stage 1 centrepiece**
- Full corpus in → assertions out, every one with evidence pointing at a real `raw_content_id`.
- Tampered excerpt → **zero** assertions from that candidate, drop counted in the run summary.
- **G11:** ingest twice → identical assertion IDs.
- **G3 partial:** J06 yields facts. Zero patterns (table may not exist yet — that is a pass).
- **Drop rate is a reported number, not a footnote.** If >30% of candidates fail the span check, the prompt is wrong, not the verifier.

### A1.5 — Idempotency + lease · **warrants a test**
Silent failure is the entire point of this ticket.

- Simulated expired lease → row returns to retryable, never stuck `running`.
- **Crash test (Tier B):** kill the agent mid-ingest. After lease TTL the row is `pending` or `failed`. Re-run → no duplicate facts.
- **Fails if:** a killed run leaves a row `running` with nothing watching it. That is today's bug; it must be gone.

### A1.6 — Embeddings · **light test**
- New journal has non-null embedding.
- Backfill prints a **coverage percentage**, not "done."
- **Fails if:** anyone creates an IVFFlat index on a 3072-d column. It cannot exist; it will fail quietly and look like a search bug for a week.

## Stage 2

### A2.1 — Supersession · **warrants a test**
- **G4:** J01 + J15 → one active assertion (quit), one superseded, one `supersedes` relation. J01 still exists.
- **G5:** J02 refines J01 — does not retire it.
- Same claim twice → evidence attached to the existing row, no clone.
- **Fails if:** J02 supersedes J01. Over-eager supersession deletes history as surely as under-eager keeps lies.

### A2.2 — `current_truth` / `changed_since` · **warrants a test**
- `current_truth()` omits the half-marathon.
- `changed_since('2026-02-01')` returns the training/quit pair.
- **Filtering happens in SQL.** Assert on the generated query, not just the result — the existing Cook B bug is that it filters in JavaScript after the fact, which silently returns the right answer for the wrong reason.

### A2.3 — Alias hygiene · **warrants a test**
- **G7:** J04/J12/J16 (manager) and J17 (sister) → two entities, or one plus a resolution candidate. Never one merged Alex.
- **Fails if:** first-name matching merges them. This is the single most damaging silent failure in Stage 2 — every Alex pattern downstream inherits it.

### A2.4 — Significance · **light test**
- **G6:** Sam (J03, once) scores far below Alex (J04/J12/J16).
- Sam gains no profile fields.

## Stage 3

### A3.1 — Migration · **no dedicated test.** Applies and reverses, or it fails loudly. One check: `user_rejected` and `promoter_version` exist from day one.

### A3.2 — Promoter · **warrants the most demanding test in the project**
Every row below is a way this fails silently and poisons everything downstream.

| Input | Expected | Guards |
|---|---|---|
| J08 + J10 + J13 | **one** live pattern | G1 |
| J09 + J11 + J14 | **one** live pattern, **distinct** from the above | G2 |
| Both loops together | **two** patterns, never one "avoidance" | G2 |
| J06 alone | **zero** patterns | G3 |
| J08 alone | **zero** patterns | 01 test 7 |
| J08 + J10 only | candidate, **not** live (bar not met) | bar |
| J19 | fact, severe, **not** episode-promotable | G9 |
| J20 after promotion | evidence recorded; pattern **not** retired by one counter-instance | stability |
| Re-run promoter | same pattern IDs, no second copy | idempotency |

Row 3 is the one to watch. Both loops are avoidance-flavored and superficially similar — that is deliberate. A promoter that merges them looks clever and is wrong, and you will not notice from the output alone, only from this test.

### A3.3 — Why · **warrants a test**
- **G3:** J06 → zero whys, under every configuration.
- Loop A after promotion → at most one **provisional** why carrying evidence assertion IDs.
- Candidate (not live) pattern → zero whys.
- **G9:** J19 → zero whys.
- **Fails if:** a why is generated for an unpromoted pattern. That is the founder's exact stated fear, in code.

### A3.4 — `live_patterns()` · **light test**
Returns both loops without reading `raw_content`. **Assert on the query** — a version that scans journals returns the right answer and defeats the purpose.

## Stage 4

### A4.1 — Portrait blocks · **warrants a test**
- **G4:** `current_goals` does not mention the half-marathon.
- Every populated block traces to live IDs; untraceable → **empty**.
- Running Cook 0 twice is a no-op (no drift, no second personality).
- **Fails if:** a block holds prose with no ID behind it. Empty beats January's marathon.

### A4.2 — `pulls.ts` · **warrants a test**
Every pull has a fixture test returning IDs. **G10:** `gaps()` reports the missing health/calendar sources.

### A4.3 — Cook A · **light test.** Outline cites pattern IDs that exist.

### A4.4 — Cook B · **warrants a test**
- Prompt's tool list **matches** the registered tools (today: 5 described, 7 registered).
- Fixture run produces a pack of real IDs and invents **zero** patterns.
- **Fails if:** `notRealizedYet` contains anything without a pattern ID behind it.

### A4.5 — Evidence pack · **light test.** Round-trips; every ID resolves to a real row.

### A4.6 — Cook C · **warrants a test — the final gate**
- Fixture pack → transcript mentions **no** pattern absent from the pack.
- Transcript contains no forward-looking prediction (D8).
- **G9:** J19 content does not appear in the episode.
- Gap line present: the episode says what it doesn't know.

---

# Part 3 — The one running number

**Groundedness rate:** of all claims an episode makes about the person, the share that point to a real fact ID and a source quote.

Today: effectively **zero** — patterns are invented mid-episode and discarded. After Stage 4 it should approach total, because the script can only cite what's in the pack.

Measure it the same way every time: generate an episode from the golden corpus, list every claim about the person, mark each traceable or not. It is the honest proxy for "does it know me," it moves in one direction, and it is the number worth showing someone outside the project.

---

# Part 4 — The blind comparison (once, at the end)

The only subjective test worth running, and only if designed to be falsifiable.

1. Generate two episodes from the **same** golden corpus — current path and new path.
2. Strip labels. Have someone else shuffle them.
3. **Pre-commit** to what you're rating: *claims that made me wince* and *claims specific enough to be wrong*.
4. Rate, then unblind.

Unlabeled and pre-committed, it's evidence. Labeled and after the fact, it's vibes. Note that "specific enough to be wrong" should go **up** — vagueness is how the current system hides.

---

# Part 5 — Running this

```
npm run test:golden              # full corpus, all assertions available at this stage
npm run test:golden -- --stage 1 # only assertions Stage 1 can satisfy
```

Assertions activate by stage. G1/G2 cannot pass before A3.2 exists — the harness should report them **PENDING**, never FAIL, so a red result always means a real regression.

**Re-run the whole corpus after every agent, not just the one that added a test.** The point of a golden corpus is catching the agent that fixed its own thing and broke something three stages back.

Corpus maintenance: if an entry needs rewording, the expected answers change too — treat it as a spec change and say so in the PR. Do not quietly adjust a fixture to make a test pass. That is the one way this whole file stops being worth anything.
