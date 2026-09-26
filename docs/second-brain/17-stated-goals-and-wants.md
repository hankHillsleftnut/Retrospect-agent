# 17 — Stated goals and what someone actually wants

Research pass on the gap between what a person says they want and what they
want. What the literature establishes, what it forbids, and which of it can be
computed from the data this system already holds.

---

## 1. The gap is real, large, and measured

The instinct that stated goals are unreliable is not a hunch. It is one of the
better-replicated findings in motivation psychology.

McClelland's distinction between **implicit motives** (affect-based, formed
preverbally, predict spontaneous behaviour over time) and **self-attributed
motives** (language-based beliefs about one's own motivation) has been tested
repeatedly. The correlation between the two:

| domain | r |
|---|---|
| overall | 0.130 |
| affiliation | 0.116 |
| achievement | 0.139 |
| **power** | **0.038** |

Near zero. And the asymmetry matters: self-attributed motives correlate
strongly with stated personal goals, while implicit motives correlate with
neither. So a person's goal list is a faithful record of their *self-concept*
and close to silent about what actually moves them.

Economics found the same thing independently and calls it the **say/do gap**.
Samuelson's revealed preference (1938) argues we should infer value from choices
made, not claims offered. Stated-preference surveys carry **hypothetical bias**
because intentions are cheap and behaviour is expensive: saying you would pay
$20 costs nothing.

Two mechanisms drive it, and they need separating because they call for
different responses:

- **Social desirability** — the person knows and is presenting. Their answer
  tells you what they want to be seen wanting.
- **Confabulation** — the person does not know. Nisbett & Wilson (1977) showed
  people routinely lack introspective access to their own processes and
  generate plausible explanations instead, drawn from implicit causal theories
  rather than observation. Choice-blindness work later showed people defending
  choices they did not make.

The second is not dishonesty and must never be treated as such. Someone
sincerely reporting a goal they do not hold is the normal case, not a lie.

---

## 2. What the literature forbids

A hard result, and the most important thing in this document.

Armstrong & Mindermann, *Occam's Razor Is Insufficient to Infer the Preferences
of Irrational Agents* (NeurIPS 2018), proves that **a policy cannot be uniquely
decomposed into a planning algorithm and a reward function.** Observed behaviour
is consistent with many (planner, reward) pairs, and a simplicity prior does not
pick out the true one — the wrong decompositions include ones that lead to high
regret.

Put plainly: **you cannot derive what someone wants from what they do.** Not
with more data, not with a better model. The inference is underdetermined in
principle, because every observation is jointly explained by wanting and by
failing — and nothing in the behaviour separates them.

The formal requirement is that normative assumptions about human planning be
supplied from outside and stated explicitly. Applied here, that means:

> This system may compute a **discrepancy**. It may not compute a **want**.

Every design below respects that line. Where it looks like the system is
inferring a want, it is presenting a discrepancy and naming the assumption under
which a want would follow.

This also happens to be the stance clinical practice arrived at independently.
Motivational Interviewing is built on *evocation* rather than persuasion: the
clinician develops discrepancy and the client resolves it. Not politeness —
the clinician has no privileged access either.

---

## 3. Six discriminators that can actually be computed

Filtered for what Retrospect's existing predicates can support.

### 3.1 Emotion on failure separates *ideal* from *ought* ★

The most operationalizable finding in this pass, and the one I would build
first.

Higgins' **self-discrepancy theory** (1987) predicts *different emotions* from
different self-gaps:

| gap | emotional signature |
|---|---|
| actual vs **ideal** (own hopes) | dejection — disappointment, dissatisfaction, feeling downcast |
| actual vs **ought** (duties, others' standards) | agitation — guilt, self-contempt, anxiety, feeling threatened |

So the emotion attached to *failing* a goal discriminates whose goal it is.
Disappointment points at something the person genuinely wants. Guilt points at
something they believe they should want — usually absorbed from someone else.

Retrospect already has both halves: `stated_goal` and `felt`, each carrying
verbatim spans. Co-occurrence of a goal with dejection-language versus
guilt-language is a computable signal, and it maps onto a distinction that
matters enormously in practice. A person failing an *ought* does not need help
pursuing it. They may need permission to drop it.

### 3.2 Importance × consistency

The Valued Living Questionnaire scores each life domain twice: how much it
matters, and how consistently the person has acted on it. Two numbers, and the
gap between them is the finding.

That is a 2×2 the existing data supports directly — stated goals supply
importance, behaviour patterns supply consistency:

|  | acts on it | doesn't |
|---|---|---|
| **says it matters** | lived value — say nothing, it is working | **the discrepancy** — the whole product |
| **doesn't say** | revealed want — matters, unspoken | not present |

The bottom-left cell is underrated. A behaviour someone repeats without ever
naming is a want they have not noticed. That is often more interesting than the
top-right, and it is only visible to something that watches over months.

### 3.3 Consistent counter-goal behaviour implies a competing commitment

Kegan & Lahey's **Immunity to Change**: when someone genuinely wants a change
and reliably fails at it, the failure is usually not weakness. It is a second,
hidden commitment being honoured — "one foot on the gas, one on the brakes."

The diagnostic move is that **consistency is the evidence**. Random failure is
noise. *Reliable* failure is a system working correctly at something else.

Operationally: when a live pattern directly opposes a stated goal, and the
pattern is strong, the right output is not "you are failing at X." It is "this
is costing you something to maintain — what is it protecting?" The competing
commitment must be elicited, never asserted: Kegan's own method is a structured
interview, and the fourth column (the Big Assumption) is arrived at *by the
person*.

### 3.4 Ladder from acts upward, don't guess downward

Brian Little's **Personal Projects Analysis** places projects as middle-level
units between subordinate *acts* and superordinate *values*, connected by
**act-laddering** and **value-laddering** — moving up the hierarchy by asking
what an act is in service of.

This is structurally identical to what Retrospect already has:

```
assertions (acts)  →  patterns (projects)  →  wants (values)
```

The direction is the discipline. Laddering *up* from observed acts is grounded
at every rung. Starting from a stated value and looking for confirming acts is
motivated reasoning with extra steps, and the model will always find something.

### 3.5 Multifinality and counterfinality

Kruglanski's **Goal Systems Theory** describes structures worth detecting:

- **Equifinality** — many means, one goal. Confers resilience.
- **Multifinality** — one means serving several goals. These acts are
  load-bearing and disproportionately hard to give up, which explains behaviour
  that looks irrationally sticky.
- **Counterfinality** — one goal served by a means that undermines another goal.
  This is the structural signature of a person stuck, and it is visible in the
  data as a pattern that advances one stated goal while opposing another.

The theory's claim is that the *shape* of the means-end network predicts
behaviour better than any single goal property. Retrospect stores facts linked
to goals; the network is latent in there and nothing currently looks at it.

### 3.6 Weight evidence by what it cost

From revealed preference: expensive signals dominate cheap ones. A cost-bearing
act — money spent, time given up, something declined, a plan changed — is worth
more than any number of statements, and far more than a statement made where
being seen mattered.

Retrospect already weights by source (journal 1.0, healthkit 0.15). The same
idea extends to a *cost* dimension the promoter does not currently model.

---

## 4. The method

Five steps, in order, each refusing to run ahead of its evidence.

1. **Collect stated goals** from `stated_goal` facts and the goals table. These
   are claims about the self-concept. Treat them as data about what the person
   believes, not about what drives them.
2. **Collect behaviour** from live patterns. These are what happened,
   repeatedly, over time.
3. **Compute discrepancy only.** For each stated goal, is there behaviour
   advancing it, opposing it, or nothing at all? No interpretation yet.
4. **Classify the gap**, using the discriminators above — the emotional
   signature on failure (3.1), whether the counter-behaviour is consistent
   (3.3), and what the act cost (3.6).
5. **Present, do not conclude.** Show the discrepancy with its evidence and let
   the person resolve it. Per §2 this is not a stylistic choice; the inference
   is formally underdetermined and any assertion of the want is unsupported.

---

## 5. What follows for this system

**`goalsVsBehavior` is the right primitive and is already written.** It is
unwired. Step 3 above is exactly its job.

**The `felt` predicate is more valuable than it looks.** Under 3.1 it becomes
the discriminator between a goal someone holds and a goal someone inherited.
That requires distinguishing dejection-language from guilt-language, which is a
small, testable vocabulary problem, not a model problem.

**A "wants" layer would sit above patterns**, taking the same shape as the
existing ladder: only from live patterns, only with a computed discrepancy,
never asserted as a want. Given §2 it should probably be called something other
than *wants* — `tension` or `discrepancy` is honest, and the name matters
because it is the difference between a claim the system can support and one it
cannot.

**The promotion bar has a counterpart here.** Patterns need 3 instances across
time or sources. A discrepancy should need at least: a stated goal with a span,
a live pattern, and a computed relation between them. Anything less is the
system editorialising about someone's life on thin evidence — the exact failure
the span gate exists to prevent, one layer up.

**The bottom-left cell of 3.2 is the strongest product claim available.** A
behaviour repeated for months and never once named is something only a system
with long memory can see. A therapist meeting someone weekly gets there
eventually. A journal app that just stores entries never does.

---

## Sources

**Implicit vs explicit motivation**
- McClelland, Koestner & Weinberger (1989), *How do self-attributed and implicit motives differ?* — [overview](https://www.researchgate.net/publication/232512454_How_Do_Self-Attributed_and_Implicit_Motives_Differ)
- Köllner & Schultheiss (2014), *Meta-analytic evidence of low convergence between implicit and explicit measures* — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3856393/) · [Frontiers](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00923/full)

**Limits of introspection**
- Nisbett & Wilson (1977), *Telling More Than We Can Know* — [PhilPapers](https://philpapers.org/rec/NISTMT)
- Johansson et al. (2006), *How something can be said about telling more than we can know: choice blindness and introspection* — [PDF](https://www.lucs.lu.se/fileadmin/user_upload/lucs/2011/01/Johansson-et-al.-2006-How-Something-Can-Be-Said-About-Telling-More-Than-We-Can-Know.pdf)

**The impossibility result**
- Armstrong & Mindermann (2018), *Occam's Razor Is Insufficient to Infer the Preferences of Irrational Agents* — [arXiv](https://arxiv.org/pdf/1712.05812) · [NeurIPS reviews](https://proceedings.neurips.cc/paper/2018/file/d89a66c7c80a29b1bdbab0f2a1a94af8-Reviews.html)
- Skalse & Abate (2023), *Misspecification in inverse reinforcement learning* — [AAAI](https://dl.acm.org/doi/10.1609/aaai.v37i12.26766)

**Self-discrepancy**
- Higgins (1987), *Self-Discrepancy: A Theory Relating Self and Affect* — [PDF, Columbia](https://www.columbia.edu/cu/psychology/higgins/papers/HIGGINS=PSYCH%20REVIEW%201987.pdf)

**Clinical method**
- Miller & Rollnick, Motivational Interviewing — [MINT](https://motivationalinterviewing.org/understanding-motivational-interviewing) · [glossary](https://motivationalinterviewing.org/sites/default/files/glossary_of_mi_terms-1.pdf)
- Kegan & Lahey, *Immunity to Change* — [method overview](https://www.humanizingwork.com/immunity-to-change/)
- ACT values vs goals; Valued Living Questionnaire — [values measures review](https://www.sciencedirect.com/science/article/abs/pii/S2212144718302813) · [Psychology Tools](https://www.psychologytools.com/resource/values)
- Cognitive case formulation — [Psychology Tools](https://www.psychologytools.com/resource/cognitive-case-formulation)

**Goal structure**
- Little, *Personal Projects Analysis* — [Springer](https://link.springer.com/chapter/10.1007/978-1-4684-0634-4_2) · [author page](https://www.brianrlittle.com/Topics/research/personal-projects-analysis/)
- Kruglanski et al., *The Architecture of Goal Systems: Multifinality, Equifinality, and Counterfinality* — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S2215091915000024)

**Revealed vs stated preference**
- de Corte et al. (2021), *Stated versus revealed preferences: an approach to reduce bias* — [Health Economics](https://onlinelibrary.wiley.com/doi/full/10.1002/hec.4246)
- *Combining stated and revealed preferences* (2025) — [arXiv](https://arxiv.org/pdf/2507.13552)

**Affective forecasting**
- Wilson & Gilbert (2005), *Affective Forecasting* — [PDF](https://bear.warrington.ufl.edu/brenner/mar7588/Papers/wilson-gilbert-cdips2005.pdf)
- Wilson et al., *Focalism: A Source of Durability Bias in Affective Forecasting* — [PDF, Harvard](https://scholar.harvard.edu/files/danielgilbert/files/wilson_et_al_focalism.pdf)
