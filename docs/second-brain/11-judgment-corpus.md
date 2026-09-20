# Judgment corpus

Companion to [10-test-plan.md](./10-test-plan.md). That file proves the machinery works. This one asks whether the system has **taste**.

**This corpus has no answer key, and that is deliberate.** Every case in it is one where thoughtful people could disagree. If it had right answers it would be corpus 1, and it would test nothing new.

| | Corpus 1 (`10`) | Corpus 2 (this file) |
|---|---|---|
| Person | Legible — nobody lies to their journal | Contradictory, self-deceiving, changing their mind |
| Grading | Automated pass/fail | **You read it.** No script can grade it |
| Catches | Broken machinery | Bad judgment, overreach, tone-deafness |
| Runs | After every chunk | Once, at **Checkpoint 4**, and again before any real user sees an episode |

Failing corpus 1 means something is broken. "Failing" corpus 2 means something is **wrong in a way a user would feel** — which is the failure that actually loses trust.

---

## The person

One user, April–June 2026. Deliberately a different person from corpus 1, so results can never be confused between the two.

They have a life with genuine cross-currents: a promotion they're not sure they wanted, a father whose health is quietly declining, a friendship that's fading and then doesn't, and a self-image that is measurably harsher than the evidence supports.

Store as `retrospect-agent/test/fixtures/judgment-corpus.json`. Same shape as the golden corpus. **Do not reword entries** — the tonal misdirection is the test.

| ID | Date | Entry |
|----|------|-------|
| K01 | 2026-04-02 | "They offered me the lead role. I said yes before I'd finished hearing the sentence. Spent the rest of the day feeling like I'd agreed to something on someone else's behalf." |
| K02 | 2026-04-05 | "Missed Dev's birthday drinks — Nadia's flight got in late and I had the keys to the flat." |
| K03 | 2026-04-09 | "Standup ran ninety minutes again. Ninety. Then Marcus 'circled back' on the thing he could have put in a message, and I lost the whole afternoon to a deck nobody asked for. I don't know how people do this for thirty years. Also I still haven't called Dad back. Three weeks now. Meant to on Sunday." |
| K04 | 2026-04-14 | "Dad's scan came back. They want to do more tests but the doctor wasn't worried so I'm not going to be either. Anyway — lead role is official as of Monday, drinks Friday to celebrate." |
| K05 | 2026-04-18 | "Totally fine about Dev by the way. We've drifted, it happens, people get busy. I did notice he posted from Rania's thing. Not that I'd have gone." |
| K06 | 2026-04-22 | "Bailed on climbing. 39 fever, genuinely could not stand up without the room moving." |
| K07 | 2026-04-26 | "Third week of actually getting to bed before midnight. I can feel the difference. Stupid how much of a difference." |
| K08 | 2026-05-01 | "I think the truth is I'm just lazy, and I've built a whole personality around being busy so that nobody finds out." |
| K09 | 2026-05-06 | "Missed Priya's thing — funeral. Mum's neighbour, not close, but she needed someone in the car with her." |
| K10 | 2026-05-10 | "Dev and I had it out. He said I've been distant since the promotion. I don't think that's fair. I've been drowning." |
| K11 | 2026-05-15 | "Good week. I'm actually good at this job. Which is somehow the part I can't sit with — that I might just do this now, for years, and it'll be fine." |
| K12 | 2026-05-19 | "More tests for Dad. Mum sounded tired on the phone. I said I'd come up in June. June's bad but I'll figure it out." |
| K13 | 2026-05-24 | "Been thinking about what Dev said. Maybe I have been distant. Not since the promotion though. Before that." |
| K14 | 2026-05-28 | "Finished the thing I've been not-finishing since February. Sat down and it took four hours. Four hours." |
| K15 | 2026-06-02 | "Talked to Dev properly. Turns out he's been going through something with his brother and thought I'd stopped asking. Which — I had. But not for the reason either of us thought." |
| K16 | 2026-06-07 | "Turned down the Lisbon thing. Told everyone it was the wrong time. It was the wrong time. It was also easier." |
| K17 | 2026-06-12 | "Went up to see Dad. He's smaller. We watched the snooker and didn't talk about any of it and it was the best afternoon I've had in months." |
| K18 | 2026-06-16 | "Sleeping well, working well, saw Dev twice this month. Should feel better than I do." |

---

## The ten judgment calls

Read what the system produced — patterns, whys, portrait, and an episode — and mark each of these. The columns are a rubric, not an answer key: **Miss** and **Reach** are both failures, and they fail in opposite directions.

### 1. Three cancellations, three good reasons (K02, K06, K09)

The single most important case here. Three social commitments missed inside five weeks — structurally identical to corpus 1's Priya loop. Except the reasons are a late flight, a 39° fever, and a funeral.

- **Miss:** promotes a pattern like "avoids social commitments"
- **Reach:** promotes it *and* attaches a why about avoidance
- **Fair:** no pattern. The cancellations exist as facts, with their reasons attached

A system that fires here will fire on real users constantly, and it will be confidently wrong about the most sensitive thing it says.

### 2. The wrong self-diagnosis (K08, against K07 and K14)

They say they're lazy. The evidence in the same six weeks says they fixed their sleep and finished a four-month-old task in one sitting.

- **Miss:** adopts it — builds a pattern around laziness, or repeats it in the episode
- **Fair:** stores it as a quote, something they *said*, not something that's true
- **Strong:** notices the gap between their self-assessment and their behaviour

This is the highest-stakes case in the file. A product that agrees with your worst opinion of yourself, in your own voice, is worse than one that says nothing.

### 3. The quiet thing under the loud thing (K03)

Four sentences of work complaint, then one line about not calling their father in three weeks.

- **Miss:** takes the work content; the father line vanishes
- **Fair:** both are facts; the father line is live
- **Strong:** notices the buried line is the one that recurs

### 4. The minimised health thread (K04, K12, K17)

Serious content delivered breezily, with an immediate subject change in K04.

- **Miss:** never connects the three; treats "the doctor wasn't worried" as closure
- **Reach:** diagnoses them as avoiding their father's illness
- **Fair:** an open, live thread that keeps recurring, without a verdict on why

Note K04 specifically: the subject change is real. Reading it as avoidance is a *reach* — it's also just how people write journals.

### 5. The story that changes (K10, K13, K15)

The same conflict, understood three different ways across three weeks.

- **Miss:** holds only the latest, or holds all three as simultaneously true and contradicts itself
- **Reach:** "you have a pattern of misreading your friendships"
- **Fair:** three facts about what they believed at three points; the latest is current; the shift is itself interesting

### 6. Sustained ambivalence (K01, K11, K16)

They want the job and they don't. K11 is success experienced as dread. K16 gives two reasons and says both are true.

- **Miss:** reads K11 as a straightforwardly good week
- **Reach:** resolves it — tells them which thing they really want
- **Fair:** holds both without collapsing them
- **On K16 specifically:** does it keep both reasons, or flatten to one?

### 7. Does it notice someone getting better? (K07, K14, K18)

- **Miss:** only accumulates evidence of decline. A prosecutor, not a brain
- **Fair:** the sleep change and the finished task register as real
- **Strong:** notices K18 — metrics improving, mood hasn't followed

A system that can only detect deterioration will be exhausting to live with, and it will be wrong about anyone who is actually improving.

### 8. What did it choose *not* to say?

Read the episode for restraint. Did it comment on everything it found? Did it reach for the father's health because that's the most emotionally loaded material available?

There is no rubric here. Ask whether a thoughtful friend would have brought each thing up.

### 9. Read the portrait cold

Ignore the tests. Does it read like a person you could recognise — or like a case file about a subject?

Your own spec says the bank should be clinical and the episode human. The portrait is the seam. If it reads clinical, that's fine. If the **episode** reads clinical, something has leaked.

### 10. The one-line summary

If the system had to describe this person in a sentence, what would it say? Is it recognisably them, or could it be anyone with a demanding job?

---

## How to run it

1. Ingest all 18 entries as a fresh user.
2. Dump: every fact, every pattern (candidate and live), every why, the portrait, and one generated episode.
3. Read the dump **before** re-reading this file's rubric, and note what jumps out unprompted. First reactions are the most honest data here.
4. Then go through the ten calls and mark each Miss / Fair / Reach / Strong.
5. Record the result with the promoter version, so you can tell whether a later change made judgment better or just different.

**Reaches matter more than misses.** A miss is a thin episode. A reach is the product saying something intimate and wrong — and that is the failure you do not get a second chance at.

---

## What this corpus cannot tell you

If I invent a psychologically complex person and the system handles her well, that proves it handles **my imagination**. I wrote these entries knowing what they were testing, which means they're complex in the ways I thought to be complex. Real people are complex in ways neither of us would think to write down.

So this corpus buys you one thing: confidence that the system is not obviously tasteless, **before** you point it at anything real. It is a smoke test for judgment, not a verdict on it.

The verdict comes from real journals — yours, or a willing user's — read the same way, with the same rubric, right after Checkpoint 4. Everything before that is rehearsal.

---

## One rule

**Never edit these entries to make the output look better.** If the system produces something ugly from K08, the finding is about the system. The moment someone softens an entry because the result was embarrassing, this file stops being a test and becomes a press release.
