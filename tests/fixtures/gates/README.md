# Gate test sets — the weekly-podcast path

Step 3 of the decision loop (the validation gate) for each step of the build
path in `docs/second-brain/target-architecture.md`. Each file holds fictional
cases with the expected right answer, written **before** the code that will be
judged against them, so the bar can't drift to fit the result.

All people, emails and writing here are invented.

| File | Step | What it judges | Pass bar (declared 19 Oct 2026) |
|---|---|---|---|
| `w1-trust-classes.json` | W1 trust classes | Which class each item gets, and whether it may yield a claim about the person's inner life | 100% of classes correct; **0** inner-life claims from automated or third-party items |
| `w2-people.json` | W2 people | Link / hold / separate for pairs of mentions | **0** wrong links (two people merged); ≥ 80% of true same-person pairs linked; every ambiguous case held, never guessed |
| `w3-trajectory.json` | W3 pattern trajectory | Weakening / holding / strengthening / not enough evidence, from counts in two windows | ≥ 80% correct; **0** "weakening" or "strengthening" claimed where the case says not enough evidence |
| `w5-selection.json` | W5 planner | Which candidates are chosen for an episode, and where it stops | Chosen set matches ≥ 80%; **never** pads past the stopping point; redundant items never both chosen |
| `w6-grounding.json` | W6 guard | Is each sentence supported by its cited evidence? | ≥ 90% agreement; **0** unsupported sentences passed as supported in the "must catch" cases |

The zeros are the ones that matter: they are the failures that cost trust
(merging two people, asserting a change that isn't there, padding, letting an
unsupported sentence through).
