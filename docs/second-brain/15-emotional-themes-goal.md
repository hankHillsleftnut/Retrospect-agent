# Goal prompt — emotional themes

Paste this as the goal. It defines the behaviour; the first deliverable is a
plan of atomic tasks, in the shape of [09](./09-agent-execution-plan.md).

---

```
Build emotional themes into the Retrospect second brain, and produce a plan
of atomic tasks to do it.

THE PROBLEM
Feelings are currently being fed through the behaviour-pattern promoter, which
is built for "you keep doing X". On real data this produced grouping keys like
affect:not (from "not tired") and affect:everyones (from "everyone's going to
hate it when I ship"). Junk labels are the visible symptom. The real defect is
that the machinery is on course to eventually assert "you often feel
inadequate" -- a statement that is unfalsifiable, unactionable, and unkind.

THE GOAL
Notice emotional themes and hand them back as QUESTIONS, never verdicts.

The noticing is valuable and must be kept. What is forbidden is the asserting.
The system groups feelings, shows the person their own words with dates, and
asks what they make of it. It does not tell them what they are.

THE ADMISSION TEST FOR EVERY EMOTIONAL OUTPUT
Write the exact sentence the episode would say. Then ask: COULD THE PERSON
DISAGREE WITH IT?

  "Three times this month you wrote something like 'everyone's going to hate
   it when I ship.' Then two days later: 'maybe I'm actually fine at finishing
   things.' I don't know what to make of that. Do you?"
      -> they can say "no, that was about the deadline". It is arguable.
      -> ALLOWED.

  "Your feelings cluster around inadequacy."
      -> there is nothing to push back on. It is a verdict wearing
         observational clothes.
      -> FORBIDDEN.

An observation nobody can argue with is a verdict. If the sentence cannot be
disagreed with, the design is wrong -- not the wording.

WHAT TO BUILD

1. Emotional themes are a DIFFERENT KIND of object from behaviour patterns.
   They may reuse the grouping, evidence-linking, decay and bar machinery --
   the mechanics are the same. What differs is what they are allowed to
   produce. Decide whether that is a kind flag or a separate table, and say
   why; prefer the smaller change that still makes the two constraints below
   impossible to bypass.

2. TWO HARD RULES, enforced in code, not requested in a prompt:
   a. An emotional theme can NEVER carry an inferred why. Explaining why
      someone feels inadequate is therapy, and this is not that product.
   b. An emotional theme can ONLY be voiced interrogatively, and only
      alongside the verbatim quotes and dates it rests on. A declarative
      sentence about someone's emotional state must not be able to leave the
      system. Check it the way pack citations are checked.

3. GROUPING. Use a small CLOSED vocabulary of themes the extractor tags --
   self-worth, capacity, belonging, control, anticipated judgment, or a
   similar short list you justify.
   - Not word-matching: "I'm terrible at this", "everyone will hate it" and
     "she's setting me up to fail" share no vocabulary and are the same theme.
   - Not embeddings: "I feel capable" and "I don't feel capable" sit almost on
     top of each other in that space. That is the contradiction blindness
     supersession exists to route around; do not reintroduce it here.
   The tag is a FILING LABEL, not a claim. Its job is to find the three quotes
   worth showing. The label itself should never need to appear in an episode.

4. SELF-TALK IS A BEHAVIOUR, feelings are a state. Narrating yourself a
   certain way is something you DO, repeatedly and observably, so
   said_about_self may still form a pattern. felt is a state and must not.
   Hold that line explicitly wherever the two could blur.

5. FEELINGS AS CONTEXT ON REAL PATTERNS is the highest-value use and should
   not be lost: "the three Fridays you skipped, you had each time written
   about feeling behind." The feeling explains the behaviour instead of
   pretending to be one.

6. FIX THE ANCHOR BUG that surfaced this. A stopword like "not" must never
   become a grouping anchor, and a single-fact candidate needs no anchor at
   all -- there is nothing to cluster with yet, so use the whole normalized
   object.

WHAT DOES NOT MOVE
- Extreme severity is stored and never raised unasked. Unchanged.
- No why on an emotional theme, under any configuration, ever.
- No prediction.
- Nothing is voiced that cannot show its evidence.

DELIVERABLE
First, a plan of ATOMIC TASKS in the shape of docs/second-brain/09: one
commit each, one gate each that can fail, no product decisions inside a task,
reviewable in one sitting. Mark which need /code-review. State which tasks
need a database and which are fixture-verifiable.

Then execute them one by one, reporting what each achieved.

CONTEXT
Read docs/second-brain/01 (Q5 on why, the self-talk and state capabilities,
and the founder heuristic: give the pieces, don't always name the realisation),
04 §4-5, 05 D5 + D10, and 09 A6/A7/A11 for the promoter, why gate and
transcript guard as they stand.

The live evidence that prompted this: 15 facts extracted from 10 real voice
notes, 12 patterns created, grouping keys including affect:not and
affect:everyones. The extraction and span-verification were clean -- 15/15
quotes verified at exact offsets. The defect is downstream of extraction.
```
