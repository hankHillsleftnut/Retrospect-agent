# 20 — Wanting, doing, reflecting

A consolidated review of what is established about reading what a person wants,
following it through to what they do and what they get, and whether reflecting
on any of it helps.

Supersedes nothing; docs 17, 18 and 19 remain the working notes. This is the
single document to read.

---

## How to read this

Every finding below carries two additions.

**→ In plain English** — the same claim without the terminology. If the
technical paragraph is heavy, skip to this; nothing is lost.

**Holds up:** — how much weight the finding actually bears, on four levels:

| rating | means |
|---|---|
| **Solid** | large meta-analyses, replicated across labs, survives publication-bias correction |
| **Reasonable** | replicated, but effects are small or the literature is thinner |
| **Contested** | mixed replication, or specific predictions have failed |
| **Framework** | a useful way of organising thinking, not an empirically tested claim |

This matters because psychology had a replication crisis and a lot of the famous
results from this era did not survive it. Some of what follows did. Some did
not. Section 6 is built only from claims that more than one literature supports,
which is the safest thing in the document.

---

## Contents

1. [The problem](#1-the-problem-people-are-unreliable-narrators-of-their-own-motives)
2. [The limit](#2-the-limit-what-cannot-be-inferred-at-all)
3. [Reading the gap](#3-reading-the-gap-six-discriminators)
4. [The chain](#4-the-chain-striving-attaining-and-whether-it-helped)
5. [Reflection as intervention](#5-reflection-is-an-intervention-not-an-observation)
6. [Convergences](#6-six-convergences)
7. [Implications for a system](#7-what-this-means-for-a-system-that-does-this)
8. [What has changed since this research was done](#8-what-has-changed-since-most-of-this-was-done)
9. [Open questions](#9-open-questions)
10. [Bibliography](#bibliography)

---

## 1. The problem: people are unreliable narrators of their own motives

### 1.1 Stated motives and actual motives barely relate

McClelland and colleagues distinguished **implicit motives** — affect-based,
formed preverbally, predicting spontaneous behaviour over long stretches — from
**self-attributed motives**, which are language-based beliefs a person holds
about their own motivation. Meta-analysis puts the correlation between measures
of the same motive across the two systems at:

| domain | r |
|---|---|
| overall | 0.130 |
| affiliation | 0.116 |
| achievement | 0.139 |
| power | 0.038 |

The asymmetry matters as much as the magnitude. Self-attributed motives
correlate substantially with a person's stated goals; implicit motives correlate
with neither.

> **→ In plain English.** There are two systems: what you *believe* drives you,
> and what *actually* drives you. Measure both and they barely relate — about
> 0.13, where 0 is unrelated and 1 is identical. For power motivation it's
> 0.04, which is nothing.
>
> And the one that tracks your stated goals is the *belief* system. So your goal
> list is an accurate description of how you see yourself, and close to silent
> about what actually moves you.

**Holds up: Reasonable.** The meta-analysis is solid and the low correlation is
consistently found. The caveat is measurement: implicit motives are usually
measured by asking people to write stories about ambiguous pictures (the TAT),
which has been criticised for low reliability. The *direction* is not in doubt —
self-report and behaviour-prediction diverge — but the precise number depends on
an instrument with known weaknesses.

### 1.2 Economics found the same thing

Samuelson's revealed preference (1938) holds that value should be inferred from
choices made rather than claims offered. The stated-preference literature
documents **hypothetical bias** directly: willingness-to-pay estimated from
surveys diverges from willingness-to-pay estimated from behaviour.

> **→ In plain English.** Economists call this the say/do gap. Asking someone
> "would you pay $20 for this" costs them nothing. Actually paying $20 is a real
> decision with real trade-offs. The two answers differ, reliably, and the
> second one is the true one.

**Holds up: Solid.** Decades of work, across many domains, with a large applied
literature in health economics and environmental valuation. This is not a
fragile finding.

### 1.3 Two mechanisms, needing different responses

**Social desirability.** The person knows and is presenting.

**Confabulation.** The person does not know. Nisbett & Wilson (1977) reviewed
evidence that people lack introspective access to their higher-order cognitive
processes and generate explanations from implicit causal theories — plausible
accounts of why a stimulus *would* produce a response — rather than from
observation. Later choice-blindness work sharpened this: participants defended,
with reasons, choices they had not made.

> **→ In plain English.** Two different things look identical from outside.
> Sometimes people shade the truth to look good. More often they genuinely don't
> know why they did something and make up a reasonable-sounding explanation on
> the spot — without realising that's what they're doing.
>
> The choice-blindness studies are the vivid version: researchers secretly
> swapped which photo a participant had picked, then asked why they picked it.
> People confidently explained a choice they had never made.
>
> This is the ordinary case, not lying. Any system built on this must not treat
> people as though they were being dishonest.

**Holds up: Solid.** Nisbett & Wilson is among the most-cited papers in the
field, and choice blindness has replicated across modalities — faces, taste,
moral and political opinions. The strong reading ("introspection is never
reliable") is contested; the working reading ("self-reports of *why* are often
reconstructions") is well supported.

---

## 2. The limit: what cannot be inferred at all

The obvious response to §1 is to stop asking and start watching. That response
is formally blocked.

Armstrong & Mindermann, *Occam's Razor Is Insufficient to Infer the Preferences
of Irrational Agents* (NeurIPS 2018), prove that **a policy cannot be uniquely
decomposed into a planning algorithm and a reward function.** Observed behaviour
is consistent with many (planner, reward) pairs, and a simplicity prior does not
select the true one — among the alternatives it admits are decompositions
leading to high regret.

> **→ In plain English.** If you can't trust what someone says, just watch what
> they do — right? That doesn't work either, and this one is a mathematical
> proof rather than an experiment.
>
> Here's the intuition. Someone doesn't go to the gym. Two explanations fit
> perfectly: they didn't want to, or they wanted to and failed. Nothing in the
> behaviour tells you which. And that's true of *every* observation, so
> collecting more of them doesn't help — you just get more of the same
> ambiguity.
>
> To get from behaviour to wanting you have to *assume* something about how
> people plan and fail. That assumption comes from outside the data. It can't be
> derived from it.

**Holds up: Not applicable — this is a proof.** It doesn't need replicating; it
needs checking, and it has been. Follow-on work (Skalse & Abate 2023 on
misspecification in inverse reinforcement learning) extends rather than disputes
it. This is the most durable claim in the document, precisely because it isn't
an empirical finding.

**The consequence for anything built on this:**

> It may compute a **discrepancy**. It may not compute a **want**.

Clinical practice arrived at the same stance without the proof. Motivational
Interviewing is built on *evocation* rather than persuasion — the clinician
develops discrepancy and the client resolves it. Usually explained as respect
for autonomy. It is also epistemics: the clinician has no privileged access
either.

---

## 3. Reading the gap: six discriminators

What remains available is not the want itself but structure around it.

### 3.1 Emotion on failure separates *ideal* from *ought*

Higgins' **self-discrepancy theory** (1987) predicts distinct emotional
signatures from distinct self-gaps:

| gap | emotional signature |
|---|---|
| actual vs **ideal** (own hopes) | dejection — disappointment, dissatisfaction |
| actual vs **ought** (duties, others' standards) | agitation — guilt, self-contempt, anxiety |

> **→ In plain English.** How you feel about *failing* at something tells you
> whose goal it was.
>
> Feel **disappointed**? It was yours — you wanted it and didn't get there.
> Feel **guilty**? It probably wasn't. Guilt is the feeling of failing an
> obligation, and obligations are usually absorbed from other people.
>
> That distinction changes what help looks like. Someone failing their own goal
> may want support pursuing it. Someone failing an inherited one may need
> permission to drop it.

**Holds up: Contested.** The broad idea — that different kinds of self-gap feel
different — has support. The *specific* mapping (ideal→dejection,
ought→agitation) has had mixed replication, and several studies find the two
discrepancy types correlate too highly to separate cleanly in practice. Treat
this as a promising signal rather than an established law.

**Important:** this is also the finding that §6 shows is reached independently
by two other literatures. The convergence is what makes it usable, not this
study alone.

### 3.2 Importance × consistency

The Valued Living Questionnaire scores each life domain on two axes — how much
it matters, and how consistently the person has acted on it.

|  | acts on it | does not |
|---|---|---|
| **says it matters** | a lived value — nothing to say, it is working | **the discrepancy** |
| **does not say** | **a revealed want** — matters, unnamed | not present |

> **→ In plain English.** Score two things separately: how much someone says
> something matters, and how much they actually do it. The gap between those two
> numbers is the interesting part.
>
> The bottom-left box is the one nobody looks at — something a person does over
> and over but has never mentioned. That's a want they haven't noticed about
> themselves, and you can only see it with long memory.

**Holds up: Reasonable.** The VLQ is a widely used clinical instrument with
acceptable psychometrics, though a systematic review found the Valuing
Questionnaire and Engaged Living Scale have stronger methodological support. The
two-axis structure is sound; the specific scale is one of several.

### 3.3 Consistent counter-goal behaviour implies a competing commitment

Kegan & Lahey's **Immunity to Change**: when someone genuinely wants a change and
reliably fails at it, the failure is usually a second, hidden commitment being
honoured — one foot on the gas, one on the brake, with only the gas in view.

> **→ In plain English.** If you want something, try repeatedly, and reliably
> fail, the usual explanation is weak willpower. Kegan's claim is that you're
> probably succeeding at something else you haven't admitted to.
>
> The tell is **consistency**. Failing randomly is noise. Failing *reliably* is
> a system working perfectly at a goal you haven't named.
>
> Which changes the right thing to say. Not "you keep failing at this" but
> "this is costing you effort to maintain — what is it protecting?"

**Holds up: Framework.** This is a practitioner methodology, not a tested
theory. It's used widely in coaching and organisational development, with
case studies rather than randomised trials. Useful for structuring a question;
not something to cite as established.

### 3.4 Ladder upward from acts, never downward from values

Brian Little's **Personal Projects Analysis** places projects as middle-level
units between subordinate *acts* and superordinate *values*, linked by
act-laddering and value-laddering.

```
acts  →  projects  →  values
```

> **→ In plain English.** Work upward. Start with what someone actually did,
> ask what that served, ask what *that* serves. Every step stays attached to
> something real.
>
> Going the other way — start with a value and look for actions that confirm
> it — always succeeds, which is exactly the problem. Given enough material
> you'll find evidence for anything.

**Holds up: Reasonable.** PPA is an established methodology with a long
research history and decent psychometric work. It's a measurement framework
rather than a single finding, so "replication" applies differently — it's been
used productively across many studies.

### 3.5 Goal-system shape predicts more than goal content

Kruglanski's **Goal Systems Theory**:

- **Equifinality** — many means, one goal. Confers resilience.
- **Multifinality** — one means serving several goals. Load-bearing and hard to
  give up.
- **Counterfinality** — a goal served by a means that undermines another goal.
  The signature of being stuck.

> **→ In plain English.** How someone's goals are *wired together* predicts
> their behaviour better than any single goal does.
>
> If one activity serves three different goals at once, they'll cling to it far
> past the point where it makes sense — because dropping it costs three things,
> not one. And if the only way they can pursue one goal actively damages
> another, they're stuck, and no amount of motivation fixes it.

**Holds up: Reasonable.** Well-developed theory with substantial experimental
support, mostly from lab studies of goal priming and accessibility. Some of the
underlying priming paradigms come from an area hit hard by the replication
crisis, so the structural claims are safer than the specific priming effects.

### 3.6 Weight evidence by what it cost

From revealed preference: expensive signals dominate cheap ones.

> **→ In plain English.** Actions that cost something — money, time, a
> declined invitation, a changed plan — tell you far more than statements. And
> a statement made where being seen mattered tells you least of all.

**Holds up: Solid.** This is §1.2 restated as a rule, and inherits its support.

---

## 4. The chain: striving, attaining, and whether it helped

### 4.1 The chain has been measured end to end

Sheldon & Elliot's **self-concordance model** (JPSP, 1999):

```
self-concordance → sustained effort → attainment → need satisfaction → well-being
```

Concordance does **double duty**: concordant goals attract more sustained effort
and are therefore more often attained, *and* their attainment yields more
well-being per unit attained.

Sheldon & Houser-Marko (2001) found the loop can compound — freshmen with
concordant motivation attained more, adjusted better, set *more* concordant
goals next semester, and showed higher ego development by year's end.

> **→ In plain English.** Goals that are genuinely yours get more effort, so
> you're more likely to reach them — *and* reaching them does more for you than
> reaching someone else's goal would.
>
> Two separate benefits from the same cause. And it can compound: a good year
> makes next year's goals more genuinely yours, which makes them more likely to
> land.

**Holds up: Solid.** Sits inside Self-Determination Theory, which is one of the
better-supported frameworks in psychology — recent meta-analyses cover 344
samples and 223,000+ participants, and the core claims hold. SDT largely avoided
the replication crisis, partly because it was built on large multi-study
programmes rather than single clever experiments.

### 4.2 Concordance is measured through reasons, not content

This is how §2's prohibition is survived. The measure doesn't ask *what* the
goal is. It asks **why it's being pursued**, along Ryan & Connell's (1989)
continuum:

| reason | characteristic phrasing | class |
|---|---|---|
| **external** | rewards, punishments, "because they want me to" | controlled |
| **introjected** | "because I'd feel guilty otherwise", shame | controlled |
| **identified** | "because I genuinely believe it matters" | autonomous |
| **intrinsic** | "because I enjoy the thing itself" | autonomous |

**Self-concordance = (identified + intrinsic) − (external + introjected)**

> **→ In plain English.** You can't ask someone what they really want — §2 rules
> that out. But you *can* ask why they're chasing what they're chasing, and the
> answers sort into four kinds.
>
> Two of them are someone else's: doing it for a reward, or doing it to avoid
> guilt. Two are yours: doing it because you believe in it, or because you enjoy
> it. Add the yours, subtract the theirs, and that number predicts whether
> you'll stick with it, reach it, and feel better afterwards — a year or two
> out.
>
> Note the second one. **Guilt appears here too**, independently of §3.1.

**Holds up: Solid.** Same SDT evidence base. The four-category structure is
among the most replicated things in motivation research.

### 4.3 Attainment is not the good

Niemiec, Ryan & Deci, *The Path Taken* (JRP, 2009). One-year longitudinal,
post-college adults, separating **intrinsic** aspirations (growth,
relationships, community) from **extrinsic** ones (wealth, fame, image).

Importance predicted attainment in both cases. But:

> Attainment of intrinsic aspirations related positively to psychological
> health. **Attainment of extrinsic aspirations did not** — indeed it related
> positively to indicators of **ill-being**.

> **→ In plain English.** They followed people for a year. Those who wanted
> money got money; those who wanted growth got growth. Both groups hit their
> targets.
>
> But the people who achieved the money-and-status goals ended up *worse off* —
> not merely no better. Getting exactly what they said they wanted made them
> less well.
>
> So "did you achieve it?" is the wrong question. Which *kind* of goal you
> achieved decides whether achieving it helped or hurt.

**Holds up: Reasonable.** One study, correlational, self-reported outcomes, one
year. But it sits inside SDT's much larger aspirations literature, which has
found the intrinsic/extrinsic distinction repeatedly across cultures. The
*direction* is well-supported; the strength of "attainment causes ill-being"
specifically rests more lightly, since correlation with ill-being could run
either way.

### 4.4 "Satisfied" is two different quantities

Kahneman's distinction between **experienced utility** (moment-to-moment affect
as lived) and **remembered utility** (the retrospective verdict):

- **Peak-end rule**: remembered value ≈ average of the most intense moment and
  the final moment.
- **Duration neglect**: how long it lasted barely registers.

Then **hedonic adaptation**: Brickman's lottery winners were not durably
happier. Diener, Lucas & Scollon's *Beyond the Hedonic Treadmill* refined this —
set points are **multiple and movable**, and people differ in how much and how
fast they adapt.

> **→ In plain English.** "Was it worth it?" and "how did it actually feel?" are
> different questions with different answers.
>
> Your memory of an experience is roughly: the most intense moment, plus how it
> ended. How *long* it went on barely registers. So a bad six months with a good
> ending gets remembered fondly, and a good year with a sour finish gets written
> off.
>
> On top of that, good things fade. Lottery winners weren't durably happier. But
> the modern refinement matters: that fading isn't total or uniform, and your
> baseline can genuinely move.
>
> So any claim that a goal "paid off" has to say *which* satisfaction it means,
> and *when* it was measured.

**Holds up: Solid.** Peak-end and duration neglect replicate robustly, including
in field settings (colonoscopies, holidays, vacations). Hedonic adaptation is
solid; the strong set-point version has been *corrected* rather than overturned —
Diener's revision is the current consensus.

---

## 5. Reflection is an intervention, not an observation

Everything above assumes that surfacing something true about a person is useful.
That assumption is false as stated.

### 5.1 The self-absorption paradox

Self-awareness predicts psychological **distress**. Self-awareness predicts
psychological **well-being**. Both replicate.

Trapnell & Campbell (1999) separated private self-consciousness into two
components:

| | motive | outcome |
|---|---|---|
| **Rumination** | neurotic self-attentiveness — threat, loss, injustice | distress |
| **Reflection** | intellectual self-attentiveness — curiosity | well-being |

> **→ In plain English.** Looking inward makes people miserable. Looking inward
> makes people flourish. Both are true, and for years that made the research
> look broken.
>
> The fix was noticing there are two kinds. **Rumination** is chewing on
> something because it threatens you. **Reflection** is examining yourself
> because you're curious. From outside they look identical. Their effects are
> opposite.
>
> So "helping someone understand themselves" is not automatically good. It's
> good in one form and harmful in the other.

**Holds up: Reasonable.** The two-factor distinction replicates well and the
scales are widely used. The cleanliness of the split is debated — the two
correlate, and some argue the difference is content rather than kind.

### 5.2 What separates them

Kross & Ayduk, *Facilitating Adaptive Emotional Analysis* (PSPB, 2008).

**Design.** Participants recalled an experience of overwhelming sadness, then
were assigned to immersed-analysis (n = 48), distanced-analysis (n = 48), or
distraction (n = 45).

**The manipulation was two sentences.**

> Immersed: *"Go back to the time and place of the experience and relive the
> situation as if it were happening to you all over again…"*
>
> Distanced: *"Go back to the time and place of the experience… take a few steps
> back and move away from your experience… watch the experience unfold as if it
> were happening all over again to the distant you…"*

**The coded outcome.** Two blind judges rated essays (inter-rater r > .79) on:

- **Recounting** — episodic *what* statements. *"I went to the top of the
  stairwell and cried for a long time."* (M = 1.10)
- **Reconstruing** — (a) a realization about, or change in, understanding the
  causes: *"I thought about how foolish it seems in retrospect"* (M = 0.27);
  (b) assessing from a broad perspective, integrating past and present: *"I
  thought about how glad I am that that part of my past is over"* (M = 0.34).

**Result.** Distancing → less recounting, more reconstruing → lower depressed
affect. Reconstruing is the mediator.

**The finding that matters most.** Distanced-analysis was *no better than
distraction* immediately. But at **1 day and 7 days**, the distanced group
remained buffered and reported fewer recurring thoughts than both the immersed
*and* the distraction groups.

**The necessary refinement.** Distance *without* meaning-making can induce
further rumination and lead to avoidance. Both components are required.

> **→ In plain English.** The whole difference was two sentences of instruction.
> Either "relive it as if it's happening to you" or "step back and watch it
> happen to the distant you."
>
> Then they coded what people wrote into two buckets. **Recounting** is
> replaying events — *what happened*. **Reconstruing** is reaching a new
> understanding — *what it meant*. Distancing produced less of the first and
> more of the second, and the second is what made people feel better.
>
> The best bit: immediately after, distancing was no better than simple
> distraction. A week later, distancing had clearly won — fewer intrusive
> thoughts about it. **Distraction works now and fails later. Distance works
> later.**
>
> And you need both halves. Standing back without making sense of anything is
> just avoidance.

**Holds up: Solid.** A 2023 systematic review and meta-analysis (48 studies, 102
effect sizes) found an overall significant effect, Hedges' g = −0.26 — small but
consistent. Moran & Eyal's 2022 meta-analysis found a medium effect on emotional
reactivity. There is a published *neural* replication using event-related
potentials. This is one of the better-supported findings in the document, and
one of the few where a recent meta-analysis exists.

Worth noting the effect is **small-to-medium, not transformative.** It's a real
lever, not a miracle.

### 5.3 Reflection that works is visible in language

Pennebaker's expressive-writing programme. Those who benefited were **not those
who expressed the most emotion**. What predicted improvement was linguistic
change: a shift away from first-person singular, and rising use of **causal**
words (*because, reason, why*) and **insight** words (*understand, realize,
meaning*).

> **→ In plain English.** Writing about hard things helps — but not for the
> reason people assume. It isn't getting it off your chest.
>
> The people who improved weren't the ones who expressed the most feeling. They
> were the ones whose writing *changed shape* over several sessions: less "I, I,
> I", more "because" and "I realise". Venting that stayed venting did nothing.
>
> Which is the same finding as §5.2 seen through a different lens. Reconstruing
> and causal-insight language are the same thing, measured two ways.

**Holds up: Reasonable, with a real caveat on size.** This is the one to be
careful about. The earliest meta-analysis (Smyth 1998) found d = 0.47 — a solid
effect. But Frattaroli's later meta-analysis, which *included unpublished
studies*, found **d = 0.15**. Across 100+ studies the average is around 0.16.
That drop from 0.47 to 0.15 is the classic signature of publication bias.

So: expressive writing works, the mechanism story is well-supported, and the
effect is **small**. Recent meta-analyses in adolescents find g ≈ 0.13. Pennebaker
himself has written about failed replications and methodological criticism.

Treat the *mechanism* (causal/insight language marks the useful kind) as more
reliable than the *effect size* (writing produces large improvements). The first
is a measurement insight; the second is oversold.

### 5.4 Visualising the outcome makes it less likely

Oettingen & Mayer (2002): vivid positive fantasy predicted **worse** outcomes
across four samples. Proposed mechanism: positive visualisation delivers part of
the reward, and effort falls.

What works is **mental contrasting** — wish, outcome, then the internal
**obstacle** — combined with Gollwitzer's **implementation intentions**
(if-then plans). Together: **WOOP**.

> **→ In plain English.** Picturing your goal vividly makes you *less* likely to
> reach it. The proposed reason is that imagining the win gives your brain some
> of the payoff, so you try less hard.
>
> What works instead: picture what you want, then immediately confront what's
> actually stopping you — not external circumstances, the thing inside you. Then
> make a specific if-then plan.
>
> So "visualise your best self" is, at best, half an intervention, and possibly
> a harmful one on its own.

**Holds up: Contested on the harm claim, Reasonable on the intervention.**
James Coyne has criticised the positive-fantasy studies for small samples and
questionable analyses. The claim that *fantasy actively harms* is shakier than
it's usually presented.

The intervention side is better supported — MCII has randomised trials,
including a four-month exercise trial that roughly doubled activity versus
control, and ongoing clinical trials. So: be confident that contrasting-plus-
planning beats planning alone; be cautious about asserting that visualisation
hurts.

### 5.5 "Self-actualised", made measurable

Ryff's **six dimensions of psychological well-being**, with validated scales
(54, 42, 39, 18 items):

1. **Self-acceptance** — knowing and accepting one's limitations
2. **Positive relations with others**
3. **Autonomy** — living by one's own convictions
4. **Environmental mastery** — a sense of control
5. **Purpose in life** — meaning and direction
6. **Personal growth** — seeing life as an opportunity to develop

> **→ In plain English.** "Self-actualisation" can't be measured, so it can't be
> checked. Ryff broke the same idea into six things that *can* be, each with a
> questionnaire.
>
> That turns an unfalsifiable ambition into a testable one. "Help someone grow"
> is unanswerable. "Do their purpose-in-life and autonomy scores move over six
> months" is answerable.
>
> Two of the six connect straight back: **autonomy** is nearly what §4.2 is
> measuring, and **purpose in life** is nearly what stated goals plus sustained
> behaviour express together.

**Holds up: Solid as a measure.** The scales are extensively validated and
widely used. The six-factor *structure* has been debated — some analyses find
fewer distinct factors — but as an instrument it is sound and there is
meta-analytic work on interventions that move it.

---

## 6. Six convergences

Independent literatures, different methods, same conclusion. **These are the
load-bearing claims.** Each is supported more than once, which makes them more
trustworthy than any single study — including any single study rated Solid
above.

**1. Guilt marks a goal that is not the person's own.**
Higgins reaches it through emotion on failure (§3.1). Sheldon reaches it through
reasons for pursuit — introjected regulation is *defined* by guilt and shame
(§4.2). Motivational Interviewing reaches it clinically. Three routes, one
signal. Note that §3.1 alone is rated Contested; the convergence is what makes
this usable.

**2. You cannot read a want directly, by any means.**
Formally, from behaviour (§2). Empirically, from self-report (§1). Clinically,
which is why MI evokes rather than asserts. The person can't read it off
themselves either — that's Nisbett & Wilson.

**3. Distance plus meaning is the adaptive form of self-focus.**
Kross & Ayduk isolate it experimentally (§5.2). Pennebaker finds it in language,
longitudinally (§5.3). Trapnell & Campbell predict it from the motive behind
self-focus (§5.1).

**4. Consistency is what makes behaviour informative.**
Kegan: reliable failure is a hidden commitment (§3.3). The implicit-motive
literature: implicit motives predict *spontaneous trends over time*, not single
acts (§1). One instance is noise in both.

**5. Attainment is not the good.**
Niemiec et al. directly (§4.3). Hedonic adaptation indirectly (§4.4). Affective
forecasting upstream — people mispredict what will satisfy them and don't know
they mispredict.

**6. Expensive evidence beats cheap evidence.**
Revealed preference (§3.6). Implicit motives predicting spontaneous behaviour
where self-report does not (§1). Hypothetical bias in stated preference (§1.2).

---

## 7. What this means for a system that does this

### 7.1 A journal is an experience-sampling instrument

Nearly all the longitudinal work above required expensive multi-wave panels. The
Experience Sampling Method exists *because* retrospective report is unreliable,
and works by sampling affect in context, repeatedly, over time.

A journal running for months **is that instrument**: timestamped affect, in
context, self-reported, longitudinal.

> **→ In plain English.** Every study in this document had to recruit people,
> measure them, chase them months later, and pay for all of it — to get a few
> hundred data points.
>
> A journal app that people actually use produces that data continuously, as a
> by-product. The expensive part of this entire field is the cheap part here.

This is a claim about **data**, not about intelligence, which is why it's the
strongest one available.

### 7.2 Link by link

| link | status |
|---|---|
| **what they said** | available — stated goals with verbatim quotes |
| **what they actually wanted** | reachable *via reasons*, not content (§4.2) |
| **what they did** | available — sustained behaviour over time |
| **what they achieved** | **missing** — attainment is usually not recorded |
| **did it satisfy them** | reachable once attainment exists |

The fourth link is load-bearing: without recorded attainment, §4.3 and §4.4 are
unreachable and the chain stops at "did."

### 7.3 The measurement that is genuinely novel

> Compare affect in the weeks **before** an attainment against the weeks
> **after**. If it doesn't improve — or worsens — that's the signature Niemiec
> et al. found for extrinsic attainment.

> **→ In plain English.** Did hitting that goal actually make them feel better?
>
> A therapist has to ask, and the answer they get is a *memory* — which §4.4
> says is distorted in known ways. A system holding timestamped writing can
> compare how someone actually wrote before and after, and skip the memory
> entirely.

### 7.4 Form is not cosmetic

§5 makes delivery part of the intervention, not packaging.

- **Third-person framing preserves distance**; second person collapses it.
  *"You skipped the gym again"* puts the person back inside the moment.
- **Recounting without reconstruing is the avoidance failure mode.** Output must
  explain, not narrate.
- **Recounting vs reconstruing is a coding scheme** with published definitions
  and reported inter-rater reliability — so it can be *tested* on generated
  output, not just hoped for.
- **Causal and insight word density is a progress measure** computable from
  someone's own entries over time, and doubles as a rumination detector.
- **Any feature inviting someone to picture their ideal self risks the wrong
  sign** unless it also names the obstacle.

### 7.5 The standard of evidence

**Epistemic** (§2): compute the discrepancy, never assert the want.

> *"You named this in March, worked at it through May, and got there in June.
> The way you wrote in the weeks after doesn't read differently from the weeks
> before."*

Every clause is evidenced. The conclusion belongs to the person.

**Consequential** (§5): a true statement delivered in the wrong form is an
intervention with the wrong sign. Verification makes claims true; it says
nothing about whether saying them, that way, at that moment, helps.

---

## 8. What has changed since most of this was done

A fair question, since much of this is 1977–2010 social psychology and that
field had a bad decade afterwards.

### What survived

**Self-Determination Theory came through well.** Recent meta-analyses cover 344
samples and 223,000+ participants and support the core claims. SDT was built on
large, multi-study, cross-cultural programmes rather than single clever
experiments, which is exactly the design that survived scrutiny. §4.1 and §4.2
are the safest empirical claims here.

**Self-distancing has been meta-analysed recently and favourably** — 48 studies,
102 effect sizes, 2023, plus a neural replication. Small effect, consistent
direction.

**Peak-end, duration neglect, and adaptation hold**, with Diener's refinement
replacing the crude set-point story.

**Revealed vs stated preference** is economics, not social psychology, and never
had this problem.

**The impossibility result is a proof** and is untouched by any of it.

### What weakened

**Effect sizes shrank almost everywhere.** Expressive writing is the clearest
case: d = 0.47 in the first meta-analysis, **d = 0.15** once unpublished studies
were included. The mechanism survived; the magnitude did not.

**Self-discrepancy theory's specific emotion predictions** have had mixed
replication, which is why §3.1 is rated Contested and leans on convergence.

**Positive-fantasy harm** has been directly criticised on sample size and
analysis.

**Anything built on priming paradigms** should be treated cautiously — that's
the area that fared worst, and some of Goal Systems Theory's experimental base
sits there.

### What's genuinely new since

**Better meta-analytic hygiene.** The numbers quoted above that *include
unpublished studies* are more trustworthy than the older published-only ones,
and where both exist this document quotes the lower figure.

**Experience sampling went from expensive to ambient.** When these studies were
run, ESM meant pagers and paper diaries. Phones changed the economics
completely, which is the entire basis of §7.1 — a possibility that did not
practically exist when most of this work was done.

**Language-based measurement matured.** Pennebaker's word-counting was
labour-intensive and coarse. Doing the same analysis continuously over months of
someone's writing is now trivial, which makes §5.3's *mechanism* far more
useful than its original effect size suggests.

### The honest summary

> The **mechanisms** in this document are in better shape than the **effect
> sizes**. Distance plus meaning-making really does separate helpful reflection
> from harmful reflection. Guilt really does mark a borrowed goal. People really
> can't report their own motives. What has not survived is the implication that
> any of these produce large changes from brief interventions.
>
> Which argues for exactly the approach §7.1 describes: small, real effects,
> applied continuously over months, measured directly — rather than one
> impressive intervention.

---

## 9. Open questions

**Narrative identity.** McAdams' work on life stories and redemptive sequences
would speak to *what shape* a reconstrual should take, not merely that it should
reconstrue. Not covered here.

**Dose.** Kross & Ayduk manipulated vantage for 30 seconds on one recalled
memory. Extrapolating to sustained, personalised narration is an inference. The
direction is supported; the dose is not.

**Whether these findings compose.** Each is established in isolation. Whether
self-distanced reconstrual *plus* concordance feedback *plus* mental contrasting
interact benignly is untested — and interventions that work alone do not
reliably combine.

**Whether small effects accumulate.** §8 concludes that these are small levers
applied continuously. That's a hypothesis, not a finding. Nobody has run the
study, because until phones it could not be run.

---

## Bibliography

### Implicit vs explicit motivation
- McClelland, Koestner & Weinberger (1989). *How do self-attributed and implicit motives differ?* — [summary](https://www.researchgate.net/publication/232512454_How_Do_Self-Attributed_and_Implicit_Motives_Differ)
- Köllner & Schultheiss (2014). *Meta-analytic evidence of low convergence between implicit and explicit measures of implicit motives* — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3856393/) · [Frontiers](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00923/full)

### Limits of introspection
- Nisbett & Wilson (1977). *Telling More Than We Can Know* — [PhilPapers](https://philpapers.org/rec/NISTMT)
- Johansson, Hall, Sikström, Tärning & Lind (2006). *Choice blindness and introspection* — [PDF](https://www.lucs.lu.se/fileadmin/user_upload/lucs/2011/01/Johansson-et-al.-2006-How-Something-Can-Be-Said-About-Telling-More-Than-We-Can-Know.pdf)

### The impossibility result
- Armstrong & Mindermann (2018). *Occam's Razor Is Insufficient to Infer the Preferences of Irrational Agents*, NeurIPS — [arXiv](https://arxiv.org/pdf/1712.05812) · [reviews](https://proceedings.neurips.cc/paper/2018/file/d89a66c7c80a29b1bdbab0f2a1a94af8-Reviews.html)
- Skalse & Abate (2023). *Misspecification in inverse reinforcement learning*, AAAI — [ACM](https://dl.acm.org/doi/10.1609/aaai.v37i12.26766)

### Self-discrepancy
- Higgins (1987). *Self-Discrepancy: A Theory Relating Self and Affect* — [PDF, Columbia](https://www.columbia.edu/cu/psychology/higgins/papers/HIGGINS=PSYCH%20REVIEW%201987.pdf)

### Self-concordance and the goal chain
- Sheldon & Elliot (1999). *Goal striving, need satisfaction, and longitudinal well-being*, JPSP — [PubMed](https://pubmed.ncbi.nlm.nih.gov/10101878/)
- Sheldon & Houser-Marko (2001). *Can there be an upward spiral?* — [PubMed](https://pubmed.ncbi.nlm.nih.gov/11195887/)
- Sheldon et al. (2004). *Self-concordance and subjective well-being in four cultures* — [PDF, SDT](https://selfdeterminationtheory.org/SDT/documents/2004_SheldonElliotRyanChirkovetal.pdf)
- *Goal Self-Concordance Model: What Have We Learned* (2021) — [ScienceDirect](https://www.sciencedirect.com/org/science/article/pii/S1462373021000158)
- Ryan & Connell (1989). *Perceived locus of causality and internalization* — [PDF, SDT](https://selfdeterminationtheory.org/SDT/documents/1989_RyanConnell.pdf)

### SDT replication status
- Van den Broeck, Howard et al. (2021). *Beyond intrinsic and extrinsic motivation: a meta-analysis* — [PDF, SDT](https://selfdeterminationtheory.org/wp-content/uploads/2023/10/2021_VandenBroeckEtAl_Beyond.pdf)
- Howard, Bureau, Guay, Chong & Ryan (2021). *Student Motivation and Associated Outcomes: A Meta-Analysis* — [SAGE](https://journals.sagepub.com/doi/abs/10.1177/1745691620966789)
- Ryan, Duineveld, Di Domenico et al. (2023). *Meta-analytic findings within self-determination theory* — [PDF, SDT](https://selfdeterminationtheory.org/wp-content/uploads/2023/01/2023_RyanDuineveldDiDomenicoEtAl_Meta-1.pdf)

### Attainment that harms
- Niemiec, Ryan & Deci (2009). *The Path Taken*, JRP 43:291–306 — [PDF, SDT](https://selfdeterminationtheory.org/SDT/documents/2009_Niemiec%20RyanDeci_JRP.pdf) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/20161160/)

### Experienced vs remembered satisfaction
- Kahneman, Wakker & Sarin. *Back to Bentham? Explorations of Experienced Utility*, QJE — [PDF](https://personal.eur.nl/wakker/pdfspubld/97.1kwsqje.pdf)
- Kahneman. *Experienced Utility and Objective Happiness* — [PDF, UCLA](https://www.anderson.ucla.edu/faculty/keith.chen/negot.%20papers/Kahneman_ExperiencedUtility00.pdf)
- Oliver. *Distinguishing between experienced utility and remembered utility* — [PDF, LSE](https://eprints.lse.ac.uk/66166/1/Oliver_Distinguishing_Between_Experienced_Utility_v1_Final.pdf)
- Diener, Lucas & Scollon (2006). *Beyond the Hedonic Treadmill* — [PDF, APA](https://www.apa.org/pubs/journals/releases/psp-843527.pdf)
- Wilson & Gilbert (2005). *Affective Forecasting* — [PDF](https://bear.warrington.ufl.edu/brenner/mar7588/Papers/wilson-gilbert-cdips2005.pdf)
- Wilson et al. *Focalism: A Source of Durability Bias in Affective Forecasting* — [PDF, Harvard](https://scholar.harvard.edu/files/danielgilbert/files/wilson_et_al_focalism.pdf)

### Rumination vs reflection
- Trapnell & Campbell (1999). *Distinguishing rumination from reflection*, JPSP — [PubMed](https://pubmed.ncbi.nlm.nih.gov/10074710/)
- Morin. *Do you "self-reflect" or "self-ruminate"?* — [PDF](https://journalpsyche.org/articles/0xc102.pdf)
- [Self-absorption paradox](https://en.wikipedia.org/wiki/Self-absorption_paradox)

### Self-distancing
- Kross & Ayduk (2008). *Facilitating Adaptive Emotional Analysis*, PSPB 34(7):924–938 — [DOI](https://doi.org/10.1177/0146167208315938) · [PDF, UMich](https://websites.umich.edu/~ekross/papers/Kross%20-%20Facilitating%20Adaptive%20Emotional%20Analysis%20(2008).pdf)
- Ayduk & Kross (2010). *Analyzing Negative Experiences Without Ruminating* — [PDF, Berkeley](https://rascl.studentorg.berkeley.edu/assets/files/ayduk_kross_compass_2010.pdf)
- **Murdoch et al. (2023).** *The effectiveness of self-distanced versus self-immersed reflections among adults: systematic review and meta-analysis*, Stress and Health 39(2):255–271 — [Wiley](https://onlinelibrary.wiley.com/doi/full/10.1002/smi.3199)
- **Moran & Eyal (2022).** *Reflect on emotional events from an observer's perspective: a meta-analysis* — [PubMed](https://pubmed.ncbi.nlm.nih.gov/36256910/)
- *An event-related potential investigation of distanced self-talk: replication* — [PDF, UMich](https://sites.lsa.umich.edu/emotion-selfcontrol-psych/wp-content/uploads/sites/1322/2023/01/An-Event-Related-Potential-Investigation-of-Distanced-Self-Talk-Replication-and-Comparison-to-Detached-Reappraisal.pdf)
- Kross & Ayduk. *Distancing: What It Is, How It Works, and Where to Go Next* (Handbook of Emotion Regulation) — [PDF, UMich](https://sites.lsa.umich.edu/emotion-selfcontrol-psych/wp-content/uploads/sites/1322/2024/01/Handbook_of_Emotion_Regulation_-_63._Distancing_What_It_Is_How_It_Works_and_Where_to_Go_Next.pdf)

### Expressive writing
- Pennebaker (2018). *Expressive Writing in Psychological Science*, Perspectives on Psychological Science — [SAGE](https://journals.sagepub.com/doi/full/10.1177/1745691617707315) · [PDF](https://cssh.northeastern.edu/pandemic-teaching-initiative/wp-content/uploads/sites/43/2020/10/Pennebaker-Expressive-Writing-in-Psychological-Science.pdf)
- Pennebaker & Chung. *Expressive Writing: Connections to Physical and Mental Health* — [PDF, MIT](https://c3po.media.mit.edu/wp-content/uploads/sites/45/2016/01/PennebakerChung_FriedmanChapter.pdf)
- Travagin, Margola & Revenson. *How effective are expressive writing interventions for adolescents? A meta-analytic review* — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0272735815000161)
- Pavlacic et al. (2019). *A Meta-Analysis of Expressive Writing on Posttraumatic Stress, Growth, and Quality of Life* — [SAGE](https://journals.sagepub.com/doi/abs/10.1177/1089268019831645)
- *Efficacy of expressive writing versus positive writing: systematic review and meta-analysis* — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10415981/)
- Zheng, Lu & Gan (2019). *Cognitive words, meaning making and post-traumatic growth* — [SAGE](https://journals.sagepub.com/doi/full/10.1017/prp.2018.31)

### Clinical method
- Miller & Rollnick. Motivational Interviewing — [MINT](https://motivationalinterviewing.org/understanding-motivational-interviewing) · [glossary](https://motivationalinterviewing.org/sites/default/files/glossary_of_mi_terms-1.pdf)
- Kegan & Lahey. *Immunity to Change* — [method overview](https://www.humanizingwork.com/immunity-to-change/)
- ACT values vs goals; Valued Living Questionnaire — [values measures review](https://www.sciencedirect.com/science/article/abs/pii/S2212144718302813) · [Psychology Tools](https://www.psychologytools.com/resource/values)
- Cognitive case formulation — [Psychology Tools](https://www.psychologytools.com/resource/cognitive-case-formulation)

### Goal structure
- Little. *Personal Projects Analysis* — [Springer](https://link.springer.com/chapter/10.1007/978-1-4684-0634-4_2) · [author page](https://www.brianrlittle.com/Topics/research/personal-projects-analysis/)
- Kruglanski, Chernikova et al. *The Architecture of Goal Systems* — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S2215091915000024)

### Goal-setting interventions
- Oettingen & Mayer (2002); mental contrasting — [overview](https://en.wikipedia.org/wiki/Gabriele_Oettingen)
- *Mental contrasting with implementation intentions in health communication* — [Taylor & Francis](https://www.tandfonline.com/doi/full/10.1080/17437199.2021.1988866)
- MCII randomised trial protocol (VA MOVE!) — [PubMed](https://pubmed.ncbi.nlm.nih.gov/38608752/)

### Revealed vs stated preference
- de Corte et al. (2021). *Stated versus revealed preferences: an approach to reduce bias* — [Wiley](https://onlinelibrary.wiley.com/doi/full/10.1002/hec.4246)
- *Combining stated and revealed preferences* (2025) — [arXiv](https://arxiv.org/pdf/2507.13552)

### Eudaimonic well-being
- Ryff. Scales of Psychological Well-Being — [Penn PPC](https://ppc.sas.upenn.edu/resources/questionnaires-researchers/psychological-well-being-scales) · [measure detail](https://sparqtools.org/mobility-measure/psychological-wellbeing-scale/)
- *Interventions to enhance eudaemonic psychological well-being: meta-analytic review with Ryff's Scales* — [Wiley](https://iaap-journals.onlinelibrary.wiley.com/doi/10.1111/aphw.12398)

### Longitudinal measurement
- Csikszentmihalyi & Larson. Experience Sampling Method — [overview](https://en.wikipedia.org/wiki/Experience_sampling_method)
- *Leveraging Experience Sampling / EMA for Investigations of Everyday Life*, Annual Reviews — [link](https://www.annualreviews.org/content/journals/10.1146/annurev-soc-091523-013249)
