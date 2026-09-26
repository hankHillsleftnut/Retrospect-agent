# 18 — Said, wanted, did, achieved, satisfied

Doc 17 covered the gap between a stated goal and a want. This one follows the
whole chain through to the end, because the interesting failures are downstream
of wanting.

The five links asked about:

```
what they SAID they want
      ↓
what they ACTUALLY wanted
      ↓
what they ended up DOING
      ↓
what they ended up ACHIEVING
      ↓
did it bring SATISFACTION?
```

There is a model that measures exactly this chain, longitudinally, and its
central result is that **the last arrow is not guaranteed** — and sometimes runs
backwards.

---

## 1. The chain has a name and has been measured

Sheldon & Elliot's **self-concordance model** (JPSP, 1999) is this exact
sequence, tested over semesters and years:

```
self-concordance → sustained effort → attainment → need satisfaction → well-being
```

Each arrow is an empirical claim, and the model's contribution is that
concordance does **double duty**. Self-concordant goals get more sustained
effort, so they are more likely to be attained *and* they yield more well-being
per unit of attainment. Two different mechanisms, same input.

The follow-up (Sheldon & Houser-Marko, 2001) found the loop can compound:
freshmen with concordant motivation attained more first-semester goals →
adjustment rose → next semester's goals were *more* concordant → attainment
rose again → ego development was higher by year end. An upward spiral, when the
goals are the person's own.

**Why this matters here:** the chain is not a metaphor. Each link is separately
measurable, and the places it breaks are known.

---

## 2. The finding that reframes the whole product

Niemiec, Ryan & Deci, *The Path Taken* (JRP, 2009). One-year longitudinal,
post-college adults. They separated **intrinsic** aspirations (growth,
relationships, community) from **extrinsic** ones (wealth, fame, image), and
measured both the importance placed on them and the **attainment** of them.

Placing importance on either predicted attaining it. People who chased money
got money. But:

> Attainment of intrinsic aspirations related positively to psychological
> health. **Attainment of extrinsic aspirations did not** — indeed it related
> positively to indicators of **ill-being**.

Getting what you said you wanted made people *worse*. Not neutral. Worse.

So "did they achieve it?" is not the question. **Not all goal attainment is
beneficial**, and which kind you attained determines the sign. A system that
congratulates someone for hitting a goal without knowing which kind it was has
a coin-flip chance of celebrating the thing that is hurting them.

This is the strongest available argument for why the stated-goal layer alone is
not just incomplete but potentially harmful.

---

## 3. "What they actually wanted" is measurable through *reasons*

The chain's first link looks unmeasurable — doc 17 established you cannot read
a want off behaviour. But self-concordance sidesteps this. It does not ask
*what* the goal is. It asks **why they are pursuing it**, on the
perceived-locus-of-causality continuum from Ryan & Connell (1989):

| reason | the person's own phrasing | type |
|---|---|---|
| **external** | "because someone else wants me to", rewards, punishments | controlled |
| **introjected** | "because I'd feel guilty if I didn't", shame, ought-to | controlled |
| **identified** | "because I genuinely believe it matters" | autonomous |
| **intrinsic** | "because I enjoy the thing itself" | autonomous |

**Self-concordance = (identified + intrinsic) − (external + introjected)**

That index predicts effort, attainment, and life-satisfaction change a year or
two out.

### The convergence worth noticing

Doc 17 arrived at the same signal from an unrelated direction. Higgins'
self-discrepancy theory predicts **guilt and anxiety** from *ought*-self gaps
and **disappointment** from *ideal*-self gaps. Sheldon's **introjected**
regulation is defined by guilt and shame.

Two literatures — one about emotion on failure, one about reasons for pursuit —
independently converge on guilt as the marker of a goal that is not the
person's own. That convergence is the most load-bearing thing across both docs,
because it means one detectable signal is supported twice.

---

## 4. "Satisfied" is ambiguous, and the ambiguity is the point

Kahneman's distinction between **experienced utility** (moment-to-moment
affect, as lived) and **remembered utility** (the retrospective verdict) is not
a technicality. The two diverge systematically:

- **Peak-end rule** — the remembered value of an episode is predicted by
  averaging its most intense moment and its final moment.
- **Duration neglect** — how long it lasted barely registers.

So a person can have a bad six months with a good ending and remember it fondly,
or a good year with a sour finish and write it off. **Asking "was it worth it?"
measures the remembering self.** Reading how they actually felt week by week
measures the experiencing self. These give different answers and neither is
wrong; they are different quantities.

And then **hedonic adaptation** applies to the answer: Brickman's lottery
winners were not durably happier. Diener, Lucas & Scollon's *Beyond the Hedonic
Treadmill* refined this usefully — set points are **multiple and movable**, not
one fixed number, and people vary in how much and how fast they adapt. So
attainment effects decay, but not uniformly and not to nothing.

**Practical upshot:** any judgement about whether a goal paid off must say
*which* satisfaction it means and *when* it was measured. "Did it make you
happy" is underspecified enough to be unanswerable.

---

## 5. What Retrospect can actually do with this

The honest assessment, link by link.

### The structural advantage

Almost all the research above required expensive multi-wave panel studies —
recruit people, measure goals at T1, chase them at T2 and T3. The Experience
Sampling Method exists precisely because retrospective reports are unreliable,
and it works by repeatedly sampling affect in context over time.

**A journal that runs for months already is that instrument.** Timestamped
affect, in context, self-reported, longitudinal. Retrospect has the data
structure these studies had to construct at great cost. That is the real claim,
and it is not a small one.

### Link by link

**"What they said"** — solved. `stated_goal` facts with verbatim spans, plus the
goals table.

**"What they actually wanted"** — reachable via reasons, not content. Detect the
four PLOC types in the person's own words about a goal. This is a vocabulary
problem: guilt/should/have-to language versus enjoy/believe-in language. It is
the same detector doc 17 called for, which is convenient — one signal, two
justifications.

**"What they did"** — solved. Live patterns are exactly sustained effort.

**"What they achieved"** — *missing, and it is the biggest gap.* Nothing in the
system records goal attainment. There is no `attained` predicate, no
completion state on goals, nothing that closes a loop. Without it, links four
and five are unreachable and the chain stops at "did."

**"Did it satisfy them"** — reachable once attainment exists, and this is the
most valuable thing in either document:

> Compare `felt` facts in the weeks **before** an attainment against the weeks
> **after**. If affect does not improve — or worsens — that is the signature
> Niemiec et al. found for extrinsic attainment.

That comparison is a genuinely novel capability. A therapist seeing someone
monthly reconstructs it from memory, badly, because the client's report is a
remembered-utility judgement subject to peak-end distortion. A system holding
timestamped affect can measure the experiencing self directly.

### What to build, in order

1. **Attainment.** An `attained` predicate or a resolution state on goals. Every
   downstream question depends on this and nothing else does.
2. **The reasons detector.** Four PLOC categories from the person's own words,
   yielding a concordance index per goal.
3. **Before/after affect around attainment.** The payoff. Only meaningful once
   1 and 2 exist, because the question is not "did affect improve" but "did
   affect improve *given what kind of goal it was*."

### The bar

Per doc 17 §2 the system may compute a discrepancy, never assert a want. The
same restraint applies harder here, because a claim about satisfaction is a
claim about someone's inner life after a real event in it.

The defensible output is the observation, not the verdict:

> *"You named this in March, worked at it through May, and got there in June.
> The way you wrote in the weeks after doesn't read differently from the weeks
> before."*

Every clause there is evidenced. The conclusion — whether that means the goal
was not really theirs — is the person's to draw, and it is precisely the sort
of thing Motivational Interviewing insists the client must reach themselves.

---

## Sources

**The chain**
- Sheldon & Elliot (1999), *Goal striving, need satisfaction, and longitudinal well-being: the self-concordance model*, JPSP — [PubMed](https://pubmed.ncbi.nlm.nih.gov/10101878/)
- Sheldon & Houser-Marko (2001), *Self-concordance, goal attainment, and the pursuit of happiness: can there be an upward spiral?* — [PubMed](https://pubmed.ncbi.nlm.nih.gov/11195887/)
- Sheldon et al. (2004), *Self-concordance and subjective well-being in four cultures* — [PDF, SDT](https://selfdeterminationtheory.org/SDT/documents/2004_SheldonElliotRyanChirkovetal.pdf)
- *Goal Self-Concordance Model: What Have We Learned and Where Are We Going* (2021) — [ScienceDirect](https://www.sciencedirect.com/org/science/article/pii/S1462373021000158)

**Attainment that harms**
- Niemiec, Ryan & Deci (2009), *The Path Taken: Consequences of Attaining Intrinsic and Extrinsic Aspirations in Post-College Life*, JRP 43:291-306 — [PDF, SDT](https://selfdeterminationtheory.org/SDT/documents/2009_Niemiec%20RyanDeci_JRP.pdf) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/20161160/)

**Measuring the reasons**
- Ryan & Connell (1989), *Perceived locus of causality and internalization: examining reasons for acting in two domains* — [PDF, SDT](https://selfdeterminationtheory.org/SDT/documents/1989_RyanConnell.pdf) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/2810024/)

**What "satisfied" means**
- Kahneman et al., *Back to Bentham? Explorations of Experienced Utility*, QJE — [PDF](https://personal.eur.nl/wakker/pdfspubld/97.1kwsqje.pdf)
- Kahneman, *Experienced Utility and Objective Happiness: A Moment-Based Approach* — [PDF, UCLA](https://www.anderson.ucla.edu/faculty/keith.chen/negot.%20papers/Kahneman_ExperiencedUtility00.pdf)
- Oliver, *Distinguishing between experienced utility and remembered utility* — [PDF, LSE](https://eprints.lse.ac.uk/66166/1/Oliver_Distinguishing_Between_Experienced_Utility_v1_Final.pdf)
- [Duration neglect](https://en.wikipedia.org/wiki/Duration_neglect)

**Adaptation**
- Diener, Lucas & Scollon (2006), *Beyond the Hedonic Treadmill: Revising the Adaptation Theory of Well-Being* — [PDF, APA](https://www.apa.org/pubs/journals/releases/psp-843527.pdf)
- Brickman, Coates & Janoff-Bulman (1978), lottery winners and accident victims — [overview](https://en.wikipedia.org/wiki/Hedonic_treadmill)

**Longitudinal measurement**
- Csikszentmihalyi & Larson, Experience Sampling Method — [overview](https://en.wikipedia.org/wiki/Experience_sampling_method)
- *Leveraging Experience Sampling / Ecological Momentary Assessment for Investigations of Everyday Life*, Annual Reviews — [link](https://www.annualreviews.org/content/journals/10.1146/annurev-soc-091523-013249)
