# 24 — Teardown: supermemory's Company Brain

[github.com/supermemoryai/company-brain](https://github.com/supermemoryai/company-brain) — open-sourced 2026-09-25. A
discontinued paid product ("thousands of users"), released whole. TypeScript,
Cloudflare Workers, Apache 2.0.

A Slack teammate that remembers what a team says, answers from it, acts in their
tools — **and speaks up unprompted when a conversation needs something it knows.**

That last capability is why it is worth reading closely. It is the problem
Retrospect has not solved and will have to: **when is it appropriate to say
something nobody asked for?** They shipped an answer, charged for it, and have
now published the whole thing.

---

## 1. The architecture that matters: two-stage triage

Every message in every channel it is in gets classified by a **cheap triage
model** before the expensive agent is ever invoked. Four routes:

| route | meaning |
|---|---|
| **ANSWER** | reply now |
| **ACK** | one emoji, no message, nothing needs doing |
| **INVESTIGATE** | check something first, then respond if confirmed |
| **PASS** | complete silence |

Only non-PASS escalates. And silence is a **first-class token**, not an absence —
there is a literal `PASSIVE_NO_REPLY = "NO_REPLY"` constant, and the full agent
can still emit it after investigating.

> **Why this matters for Retrospect.** The expensive judgement is separated from
> the cheap one. Retrospect currently has no equivalent: the podcast pipeline is
> scheduled, not responsive, so nothing decides *whether* to speak. The moment
> nudges or actions appear (which the founder notes say is the direction), this
> shape is the reference.

---

## 2. The two-question gate

The single most portable idea in the repo. Before any route is chosen:

> - **Who is it for?** A message that continues an exchange between people, or
>   addresses another person or bot, belongs to them — stay out even when
>   Company Brain knows the topic.
> - **What would Company Brain add that the people talking do not already have?**
>   A fact, a check, or offered legwork adds something; an opinion, a vote, or
>   agreement in a human discussion adds nothing.
>
> When either answer is not Company Brain, or nothing, route to PASS.

Two questions, and *either* failing means silence. Note that "I have a relevant
opinion" is explicitly not sufficient — only facts, checks, and offered work
count as addition.

**For Retrospect:** the single-user analogue is *"is this theirs to work out, and
would saying it add anything they don't have?"* Doc 20 §7.5 reached the same
place from the research side — compute the discrepancy, don't assert the want.
This is that rule as a runtime gate.

---

## 3. "Investigation requires a checkable claim"

The line that should be lifted verbatim:

> Investigation requires a **checkable claim**: a named failure, metric, person,
> or event the checks could confirm or refute. **Vague frustration with nothing
> checkable routes to a short ANSWER that empathizes and offers to dig** — the
> offer names what Company Brain would check, and the person's yes starts the
> real work.

This is **span verification applied to action.** Retrospect refuses to store a
fact without a quote. They refuse to *investigate* without a checkable claim.
Same discipline, different layer: the gate is on what the system is permitted to
do, not only on what it is permitted to believe.

Their worked example:

> "ugh, snowcone is being a nightmare again" → ANSWER, short: empathize and
> offer — *"that sounds rough. want me to dig into what snowcone's doing?"* No
> checkable claim was named, so nothing is investigated until they say yes.

---

## 4. The attribution rule — the same insight as our authorship work

From the passive invocation prompt:

> A person's subjective statement is **evidence about that person's experience
> only**: attribute it to them, and never restate it as a product, team, or
> company-wide condition unless the record independently corroborates it.

This is exactly the problem migration 115 solved for Retrospect from the other
direction. Ours was *whose words are these* (the Farza document, doc 21 §4).
Theirs is *whose experience is this* — one person saying the product is broken is
not the product being broken.

Two teams hitting the same wall independently is a strong signal it is
structural to this kind of system. **Worth generalising into one rule:**

> A statement is evidence about its speaker. Promoting it to a general truth
> requires independent corroboration — a second source, or a repetition across
> time.

Retrospect already has the machinery for the second half: that *is* the promotion
bar. The rule is currently enforced for behaviour patterns and not for anything
else.

---

## 5. Consent as a product mechanic

> **Never deliver the data uninvited, and never decide who should see it — their
> yes is the permission**, and it arrives as a normal follow-up message.

And in triage, for when someone else was asked a question they cannot answer:

> The move is never to answer over them; it is to **offer**: address the person
> who was asked, name exactly what Company Brain can pull, and wait for their
> yes.

This is doc 20's *"produce the question, not the verdict"* implemented as a
protocol rather than a tone. Three properties worth copying:

1. **The offer names the specific thing** — not "want me to help" but "want me to
   check what snowcone's doing."
2. **Acceptance is an ordinary message.** No buttons, no consent dialog. The
   permission arrives in the same channel as everything else.
3. **Refusal costs nothing** — no reply is a valid outcome and the system moves
   on.

For Retrospect this is the shape of any future nudge. Not *"you've skipped the
gym nine times"* but *"I noticed something about the last few weeks — want me to
lay it out?"*

---

## 6. The journey ladder — earned capability

`src/brain/journey/` implements a progressive permission ladder. Five rungs, in
fixed order:

```
domain → channels → second_asker → tool_workspace → digest
```

> The journey always offers the **lowest rung not yet granted.**

The restraint machinery around it is the valuable part:

| mechanism | value |
|---|---|
| `MIN_BEAT_GAP_MS` | 24 hours minimum between proactive messages |
| `MAX_IGNORED_BEATS` | 2 — after two ignored, stop asking |
| `REFUSAL_PAUSE_MS` | 7 days after a permission is revoked |
| revoked rungs | **never asked for again** |
| `JOURNEY_DEFAULT_ENABLED` | **false** — off until explicitly turned on |

And a detail that shows real operational maturity:

> A false from a failed read is an **outage, not a user taking access away.**

They distinguish "permission revoked" from "we couldn't check" — the same
distinction Retrospect's health board makes between `never` and `unknown`
(doc on the canvas). Getting this wrong means treating an outage as a rejection
and permanently disabling a feature the user never refused.

**This is directly the automation-timing answer from the founder notes.** That
entry concluded *automate at integrated regulation, not before*, and Lally's
automaticity curve gave a measurable proxy. The rungs ladder is the same idea as
a shipped mechanic: capability is **earned progressively and revocably**, and
refusal is remembered.

---

## 7. Emergent taxonomy — the opposite of our ontology

`src/brain/memory/split.ts`: memory is a tree. When a node exceeds
**`SPLIT_THRESHOLD = 125`** memories, an LLM partitions it into children, each
with a `snake_case` path segment and a one-line description of what belongs
there.

Categories are **discovered, not predefined.** The taxonomy grows out of the
material.

**The contrast with Retrospect is total:**

| | Company Brain | Retrospect |
|---|---|---|
| taxonomy | emergent, LLM-generated on overflow | fixed predicate vocabulary |
| when it changes | automatically, at 125 items | only when a human edits the prompt |
| advantage | adapts to any domain, no upfront design | stable, groupable, countable |
| cost | categories drift; two runs may partition differently | needs the right ontology up front |

Neither is wrong — they serve different requirements. Their memory has to hold
arbitrary company knowledge, so a fixed schema would be a straitjacket. Ours has
to **count instances to promote a pattern**, and counting requires stable
categories. An emergent taxonomy that repartitions would make `instance_count`
meaningless.

Worth noting explicitly because it is a real fork, and doc 23 put Obsidian at the
"no taxonomy at all" end of the same axis:

```
Obsidian              Company Brain            Retrospect
no taxonomy    →    emergent taxonomy    →    fixed ontology
(user supplies)      (system discovers)       (system imposes)
```

---

## 8. Prompt craft worth stealing

**Teach reasoning, refuse pattern-matching.** Stated twice, explicitly:

> The routes below are **illustrations of that judgment, not its boundaries** —
> generalize the reasoning, never the surface features.
>
> Most real messages match none of these examples. They demonstrate the
> reasoning, not the categories.

**And a worked pair that makes it concrete:**

> "so tired lol" after a normal day → **PASS**
> "so tired, was up all night fighting the pager" → **INVESTIGATE**
>
> When a message resembles an example on the surface but its consequences
> differ, **the consequences win.**

Two near-identical surfaces, opposite routes. That single pair does more
teaching than the whole taxonomy above it.

**Asymmetric defaults.** Silence requires positive evidence:

> Return PASS **only with positive evidence** that the final message is non-bot
> chatter, a pure acknowledgement, or otherwise does not seek engagement. The
> absence of a new question, request verb, or actionable implication is **not
> enough by itself.**

Compare Retrospect's failure classifier, where *unknown* defaults to transient
for the same structural reason: the costs of the two errors are unequal, so the
default goes to the cheaper mistake.

**Prompt-injection hygiene at the seam.** The triage `reason` is model output
that gets embedded into the *next* model's prompt. Before it does:

```ts
.normalize("NFKC")
.replace(/[\u0000-\u001f\u007f]/g, " ")   // control characters
.replace(/\s+/g, " ")
.slice(0, 900)                             // length cap
.replace(/&/g, "&amp;")                    // then HTML-escape
.replace(/</g, "&lt;").replace(/>/g, "&gt;")
```

Normalise, strip control characters, cap length, escape markup — at every point
where one model's output becomes another's input. Retrospect has the same seam
(extraction output feeds the promoter, the promoter feeds the portrait) and does
none of this.

---

## 9. Operational details worth noting

**Post-turn reflection.** `POST_TURN_REFLECT_DELAY_SECONDS = 3 * 60` — the system
reflects on a conversation three minutes *after* it ends, with its own retry
ladder (5 attempts, 60s to 15min backoff, plus repair delays at 1s/5s/15s). The
learning pass is deliberately separated from the response.

**Skills as files.** `SKILL.md` with YAML frontmatter — scalar `name` and
`description`, then Markdown body, with only those two fields editable. Same
shape as Claude Code skills. Processes, formats and voice are taught as
documents rather than code.

**Split serialisation.** `splitInFlight` guards against concurrent partitions of
the same node, because bursty writes each fire a split check and *"concurrent
runs waste LLM calls and produce inconsistent children."* The same class of bug
as our lease races.

---

## 10. What to take, in priority order

**1. The two-question gate (§2).** Portable as-is. The cheapest, highest-value
thing here.

**2. "Checkable claim or don't act" (§3).** Retrospect has this for *belief*
(span verification) and lacks it for *action*. When nudges arrive, this is the
gate — and the fallback is already specified: empathise and offer.

**3. The offer protocol (§5).** Named, specific, acceptance-as-ordinary-message,
refusal free. This is how doc 20's "question not verdict" becomes a mechanic
instead of a tone note.

**4. The generalised attribution rule (§4).** Two teams reached it
independently. Retrospect enforces it for patterns and nowhere else.

**5. The rungs ladder (§6).** The shipped version of the automation-timing
answer — earned, revocable, refusal remembered, default off.

**6. Prompt-injection hygiene at model seams (§8).** Small, cheap, currently
absent in our pipeline.

**7. The worked-pair teaching device (§8).** Two near-identical inputs with
opposite correct answers teaches judgement better than any taxonomy.

**Explicitly not to take: the emergent taxonomy (§7).** It suits their problem
and breaks ours — counting instances requires categories that do not move.

---

## 11. The honest difference in stakes

Their failure mode is **being annoying in a Slack channel.** It is recoverable;
someone turns the bot down and life continues. That permits a fairly aggressive
proactive posture, and the guardrails are tuned for irritation rather than harm.

Retrospect's failure mode is **saying something wrong about someone's inner
life**, unprompted, possibly when they are already low. Doc 20 §5 establishes
that a true statement delivered badly is an intervention with the wrong sign,
and doc 22 that a plausible-but-wrong interpretation asserted confidently is the
specific harm to avoid.

So the mechanics transfer and the thresholds do not. Every gate here should be
*stricter* in Retrospect, not merely copied — and their own restraint settings
(default off, two strikes, seven-day pause after refusal, never re-ask) are
already conservative for a workplace tool. That is the floor, not the ceiling.
