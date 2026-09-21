# The persona layer

A feature design, not a locked spec. It answers: *what is their online persona, is it honest to them or built for someone else, and how does it compare to their actual life?*

This supersedes the existing `social-research.ts` approach, which is currently dormant (built, wired into ingest, called by nothing in the API or the app).

---

## The reframe that makes this work

The existing pipeline asks a search engine what someone's posts reveal about their identity, and files the answer as evidence of **who they are**. That fails on epistemics: you end up with an inference drawn from a summary drawn from a search, and for anyone without a large public presence the search returns demographic stereotype rather than personal fact.

This design asks a different question: **how do they present themselves?**

That flips the reliability entirely. Public content is not weak evidence about someone's inner life — it is *primary, authoritative* evidence about their presentation. You are no longer guessing what a post reveals. You are describing what was posted. Inference only enters at the comparison step, where it belongs.

| | Old framing | This framing |
|---|---|---|
| Claim | "They value authenticity" | "They post about authenticity" |
| Source strength | Speculative | Directly observed |
| Fails when | The person is low-profile | Rarely — you have the posts |
| Interesting because | It isn't | The **gap** is the insight |

---

## Three selves

The bank already holds two. This adds the third, and the product lives in the distances between them.

```
STATED     what they say about themselves      onboarding, self-talk
BEHAVED    what they actually do               journals, calendar, health
PRESENTED  what they show the world            public posts          ← new
```

Your locked spec already asks for one of these gaps — *"what they say they want vs what they're actually pursuing"* — which is STATED vs BEHAVED. This is the same machinery applied to a second pair, and it needs no new conceptual apparatus.

---

## Fix the data source first: a connector, not a search

**Do not keep asking Perplexity about a handle.** Two problems that no amount of prompt work solves: handles are not unique across the web, so you can silently ingest facts about a different person; and for most users the search returns generalisations about a category rather than facts about an individual.

Instead, treat public content as **an integration like any other** — which the agent already has a framework for (`source_items`, the connector fleet, `materializeGraphV2`).

| Route | How | Gives you |
|---|---|---|
| OAuth connector | LinkedIn, YouTube, Substack where APIs allow | Real post text, timestamps, first-party |
| User-supplied export | Instagram/TikTok data export upload | Complete, consented, no API fight |
| Paste-in | "Add a post" in the app | Zero infrastructure, useful for a prototype |

All three produce the same thing: **actual post text stored as a source**, so an excerpt can be verified against it exactly as a journal quote is. The span rule then means something real again.

Keep web research only as an **optional enrichment** on a connected account — never as the identification step, and never as the sole evidence for anything.

---

## New objects

### 1. Presentation facts — existing table, new marker

Public content produces ordinary assertions through the same `writeFact`. They carry an evidence marker of `public` so nothing ever confuses them with private material.

Starter predicates:

```
posted_about           topic or theme of a post
presented_as           self-description in public voice
public_tone            register: aspirational, wry, professional, raw
audience_signal        who the content appears aimed at
public_omission        a topic conspicuously absent from public content
```

`public_omission` is the subtle one and probably the most valuable. What someone never posts about is often more informative than what they do.

**Supersession works here for free, and it's a genuine feature.** Personas drift. "Six months ago the public voice was X, now it's Y" falls straight out of `changed_since` with no new machinery.

### 2. Divergence — a new derived object

The heart of the feature. A comparison between PRESENTED and BEHAVED on one dimension.

| Field | Purpose |
|---|---|
| `dimension` | Boring label: `work_satisfaction`, `social_life`, `health`, `confidence` |
| `direction` | `amplified` / `suppressed` / `consistent` / `inverted` |
| `public_assertion_ids` | Evidence from posts |
| `private_assertion_ids` | Evidence from journals and integrations |
| `status` | `candidate` / `live` / `retired` / `user_rejected` |
| `first_seen_at`, `last_seen_at`, `instance_count` | The bar |
| `promoter_version` | Re-runnable without mystery |

It behaves like a pattern: promoted, not invented; evidenced on both sides; rejectable by the user.

### 3. Mechanism — why the gap exists

Only on a **live** divergence, same discipline as a why on a pattern, and the vocabulary matters enormously:

```
privacy_boundary        they keep hard things private — a choice, not a lie
professional_register   different voice for a professional audience
aspirational            posting the person they're working toward
processing_lag          they post about things only once resolved
audience_performance    shaped by expected reaction
```

**The default reading is charitable.** Four of those five are healthy. A gap between public and private is the normal condition of being a person — nobody posts their worst days, and having a professional register on LinkedIn is not a character flaw. Only `audience_performance` is uncomfortable, and it should be the hardest to reach, never the default.

---

## The bar is higher than a pattern's

"You're not being honest online" is the single most damaging thing this product could say and be wrong about. So the promotion rules are stricter than the pattern promoter, not looser:

| Requirement | Why |
|---|---|
| **≥3 instances on each side** | One cheerful post against one bad day is not a divergence, it's Tuesday |
| **Spanning >3 weeks** | Slower than the pattern bar — personas are measured over time |
| **Both sides independently evidenced** | Never infer the private side from the absence of public content |
| **No inversion on one dimension alone** | The strongest claim needs the most evidence |
| **Never promoted from `public_omission` alone** | Not posting about something is not evidence of hiding it |

A single contradictory post retires nothing and promotes nothing.

---

## Consistency is a finding

If someone's public self matches their private life, **say so.** It's a real, positive result and it may be the more common one.

A feature that only ever fires on discrepancy is a hypocrisy detector, and nobody wants that in their ear on a Sunday. `direction: consistent` must be a first-class output that the portrait and the episode can use — *"the way you talk about your work publicly is the way you talk about it privately"* is a genuinely good thing to hear, and it's earned rather than flattering.

---

## Typed pulls

Added to the catalog in [04](./04-target-architecture.md#typed-pulls):

| Pull | Returns |
|---|---|
| `persona()` | Current public presentation: tone, themes, audience signals |
| `persona_changed_since(ts)` | How the public voice has drifted |
| `divergences(status?)` | Live divergences with both evidence sides |
| `divergence(id)` | One divergence, its mechanism, and every supporting ID |

New portrait slot: **`public_self`** — short, traceable, and empty when there's nothing solid, exactly like every other block.

---

## What would make this complete

The answer to "what completes the feature," as a checklist:

1. **Real post text as the source**, connected or uploaded — not a search over a handle.
2. **Both sides evidenced independently**, never one inferred from the other's absence.
3. **A bar stricter than the pattern bar**, so it fires on repetition and nothing else.
4. **Consistency reported as a result**, not only divergence.
5. **A charitable mechanism vocabulary** with `privacy_boundary` as the leading explanation.
6. **Full traceability** — the system can always show the post and the journal side by side.
7. **User rejection** — `user_rejected` from day one, same as patterns.
8. **Explicit opt-in.** "Connect Instagram" and "analyse whether your public self is honest" are different propositions, and the second needs to be asked for in words the user would recognise.

Items 3, 4 and 8 are the ones that decide whether this feels insightful or invasive. They are not polish.

---

## Where it sits

It cannot start before both sides exist. Sequencing:

```
Stage 1-2    journal facts exist               ← prerequisite
[any time]   public content connector           ← independent, can run in parallel
Stage 3      pattern promoter exists            ← the promoter pattern to copy
Stage 3.5    divergence promoter + mechanisms   ← this feature
Stage 4      pulls, portrait slot, episode use
```

The connector work is genuinely independent and could be built alongside Stage 1 by a second person without touching the brain at all. The divergence promoter should not start until the pattern promoter has passed Checkpoint 4 — it's the same problem in a more sensitive domain, and it should inherit a promoter design that has already been reviewed against real data.

---

## How this fails

| Failure | Looks like | Prevented by |
|---|---|---|
| Hypocrisy detector | Every episode implies they're fake | Consistency as a finding; charitable defaults |
| Wrong person | Facts about someone else's handle | Connector, not handle search |
| Stereotype as insight | "People who post like this tend to…" | Real post text, span-verified |
| Cruelty at scale | Correct, unkind, unasked-for | The bar, plus opt-in |
| Thin-slicing | One post vs one journal | ≥3 each side, >3 weeks |

The last row in the table is the one to hold: **a correct insight, delivered unasked, can still be the wrong thing to say.** That's a Cook C narrative rule, not a bank rule — the bank should absolutely store a live divergence. Whether the episode names it out loud is a separate decision, and the founder's existing heuristic applies: give the pieces, don't always name the realisation.
