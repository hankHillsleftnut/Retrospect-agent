# 20 — Wanting, doing, reflecting

A consolidated review of what is established about reading what a person wants,
following it through to what they do and what they get, and whether reflecting
on any of it helps.

Supersedes nothing; docs 17, 18 and 19 remain the working notes. This is the
single document to read.

---

## Contents

1. [The problem](#1-the-problem-people-are-unreliable-narrators-of-their-own-motives)
2. [The limit](#2-the-limit-what-cannot-be-inferred-at-all)
3. [Reading the gap](#3-reading-the-gap-six-discriminators)
4. [The chain](#4-the-chain-striving-attaining-and-whether-it-helped)
5. [Reflection as intervention](#5-reflection-is-an-intervention-not-an-observation)
6. [Convergences](#6-six-convergences)
7. [Implications for a system](#7-what-this-means-for-a-system-that-does-this)
8. [Open questions](#8-open-questions)
9. [Bibliography](#bibliography)

---

## 1. The problem: people are unreliable narrators of their own motives

The gap between what someone says they want and what actually moves them is one
of the better-replicated findings in motivation psychology.

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

The asymmetry is as important as the magnitude. Self-attributed motives
correlate substantially with a person's stated personal goals; implicit motives
correlate with neither. A goal list is therefore an accurate record of
**self-concept** and close to silent about **drive**.

Economics reached the same place independently. Samuelson's revealed preference
(1938) holds that value should be inferred from choices made rather than claims
offered, and the stated-preference literature documents **hypothetical bias**
directly: willingness-to-pay estimated from surveys diverges from
willingness-to-pay estimated from behaviour.

### Two mechanisms, needing different responses

**Social desirability.** The person knows and is presenting. Their answer is
accurate about what they want to be seen wanting, which is itself information.

**Confabulation.** The person does not know. Nisbett & Wilson (1977) reviewed
evidence that people lack introspective access to their higher-order cognitive
processes and generate explanations from implicit causal theories — plausible
accounts of why a stimulus *would* produce a response — rather than from
observation. Later choice-blindness work sharpened this: participants defended,
with reasons, choices they had not made.

The second is the ordinary case. Someone sincerely reporting a goal they do not
hold is not lying, and any system built on this must not treat them as though
they were.

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

The intuition is simple once stated. Every observation of someone not doing a
thing is explained equally well by *not wanting it* and by *wanting it and
failing*. Nothing in the behaviour separates those. More data does not help,
because more data is more observations of the same ambiguity.

The formal requirement is that normative assumptions about human planning be
supplied from outside the data and stated explicitly. Applied to a system that
watches someone:

> It may compute a **discrepancy**. It may not compute a **want**.

Clinical practice arrived at the same stance without the proof. Motivational
Interviewing is built on *evocation* rather than persuasion — the clinician
develops discrepancy and the client resolves it. This is usually explained as
respect for autonomy. It is also epistemics: the clinician has no privileged
access either.

---

## 3. Reading the gap: six discriminators

What remains available is not the want itself but structure around it. Six
signals, ordered by how readily they can be computed from a corpus of someone's
own writing.

### 3.1 Emotion on failure separates *ideal* from *ought*

Higgins' **self-discrepancy theory** (1987) predicts distinct emotional
signatures from distinct self-gaps:

| gap | emotional signature |
|---|---|
| actual vs **ideal** (own hopes, aspirations) | dejection — disappointment, dissatisfaction, feeling downcast |
| actual vs **ought** (duties, others' standards) | agitation — guilt, self-contempt, anxiety, feeling threatened |

So the emotion attached to *failing* a goal discriminates whose goal it is.
Disappointment indicates something genuinely wanted. Guilt indicates something
believed obligatory — typically absorbed from someone else.

The practical consequence is large: a person failing an *ought* does not need
help pursuing it. They may need permission to abandon it.

### 3.2 Importance × consistency

The Valued Living Questionnaire scores each life domain on two axes — how much
it matters, and how consistently the person has acted on it. The gap between
them is the finding, not either number alone.

|  | acts on it | does not |
|---|---|---|
| **says it matters** | a lived value — nothing to say, it is working | **the discrepancy** |
| **does not say** | **a revealed want** — matters, unnamed | not present |

The bottom-left cell is underrated. A behaviour someone repeats without ever
naming is a want they have not noticed, and it is visible only to something with
long memory.

### 3.3 Consistent counter-goal behaviour implies a competing commitment

Kegan & Lahey's **Immunity to Change**: when someone genuinely wants a change and
reliably fails at it, the failure is usually not weakness but a second, hidden
commitment being honoured. Their image is one foot on the gas and one on the
brake, with only the gas in view.

The diagnostic move is that **consistency is the evidence**. Random failure is
noise; *reliable* failure is a system working correctly at something else.

The implication for tone is strict. The right response is not "you are failing at
X" but "this is costing you something to maintain — what is it protecting?" The
competing commitment must be elicited rather than asserted; Kegan's own method is
a structured interview whose final column, the Big Assumption, is reached by the
person.

### 3.4 Ladder upward from acts, never downward from values

Brian Little's **Personal Projects Analysis** places personal projects as
middle-level units between subordinate *acts* and superordinate *values*, linked
by act-laddering and value-laddering — moving up by asking what an act serves.

```
acts  →  projects  →  values
```

The direction is the discipline. Laddering upward from observed acts is grounded
at every rung. Starting from a stated value and searching for confirming acts is
motivated reasoning, and a sufficiently large corpus will always supply
confirmation.

### 3.5 Goal-system shape predicts more than goal content

Kruglanski's **Goal Systems Theory** describes configurations of means and ends:

- **Equifinality** — many means, one goal. Confers resilience; the goal survives
  any one means being blocked.
- **Multifinality** — one means serving several goals. Such acts are
  load-bearing and disproportionately hard to relinquish, which explains
  behaviour that looks stubbornly irrational from outside.
- **Counterfinality** — a goal served by a means that simultaneously undermines
  another goal. The structural signature of being stuck.

The theory's claim is that the *shape* of the means-end network predicts
behaviour better than any single property of any single goal.

### 3.6 Weight evidence by what it cost

From revealed preference: expensive signals dominate cheap ones. Money spent,
time surrendered, an invitation declined, a plan changed — each outweighs any
volume of statement, and outweighs it further when the statement was made
somewhere being seen mattered.

---

## 4. The chain: striving, attaining, and whether it helped

### 4.1 The chain has been measured end to end

Sheldon & Elliot's **self-concordance model** (JPSP, 1999) traces:

```
self-concordance → sustained effort → attainment → need satisfaction → well-being
```

Each arrow is a separate empirical claim. The model's contribution is that
concordance does **double duty**: concordant goals attract more sustained effort
and are therefore more often attained, *and* their attainment yields more
well-being per unit attained.

Sheldon & Houser-Marko (2001) found the loop can compound. Entering freshmen
with concordant motivation attained more first-semester goals → adjustment rose
→ the next semester's goals were *more* concordant → attainment rose again →
ego development was higher by year's end. An upward spiral, conditional on the
goals being the person's own.

### 4.2 Concordance is measured through reasons, not content

This is how §2's prohibition is survived. Self-concordance does not ask *what*
the goal is. It asks **why it is being pursued**, along Ryan & Connell's (1989)
perceived-locus-of-causality continuum:

| reason | characteristic phrasing | class |
|---|---|---|
| **external** | rewards, punishments, "because they want me to" | controlled |
| **introjected** | "because I'd feel guilty otherwise", shame, ought-to | controlled |
| **identified** | "because I genuinely believe it matters" | autonomous |
| **intrinsic** | "because I enjoy the thing itself" | autonomous |

**Self-concordance = (identified + intrinsic) − (external + introjected)**

The index predicts effort, attainment, and life-satisfaction change one to two
years out.

### 4.3 Attainment is not the good

Niemiec, Ryan & Deci, *The Path Taken* (JRP, 2009). One-year longitudinal,
post-college adults, separating **intrinsic** aspirations (growth,
relationships, community) from **extrinsic** ones (wealth, fame, image), and
measuring both the importance placed on each and the **attainment** of each.

Importance predicted attainment in both cases: people who chased money got
money. But:

> Attainment of intrinsic aspirations related positively to psychological
> health. **Attainment of extrinsic aspirations did not** — indeed it related
> positively to indicators of **ill-being**.

Getting what one said one wanted made people measurably worse.

So "did they achieve it" is not the question. **Not all goal attainment is
beneficial**, and which kind was attained determines the sign. A system that
congratulates attainment without knowing its kind has roughly even odds of
celebrating the thing doing harm.

### 4.4 "Satisfied" is two different quantities

Kahneman's distinction between **experienced utility** — moment-to-moment
affect as lived — and **remembered utility** — the retrospective verdict — is
not a technicality, because the two diverge systematically:

- **Peak-end rule**: remembered value is predicted by averaging the most intense
  moment and the final moment.
- **Duration neglect**: how long it lasted barely registers.

A bad six months ending well is remembered fondly. A good year ending sourly is
written off. Asking "was it worth it?" measures the remembering self; reading
how someone actually wrote week by week measures the experiencing self. Both are
legitimate; they are different quantities and they disagree.

**Hedonic adaptation** then applies to the answer. Brickman's lottery winners
were not durably happier. Diener, Lucas & Scollon's *Beyond the Hedonic
Treadmill* refined this usefully: set points are **multiple and movable**, not a
single fixed number, and people differ in the rate and extent of adaptation. So
attainment effects decay — but not uniformly, and not to nothing.

Any claim that a goal paid off must therefore specify *which* satisfaction and
*measured when*. "Did it make you happy" is underspecified to the point of being
unanswerable.

---

## 5. Reflection is an intervention, not an observation

Everything above assumes that surfacing something true about a person is useful.
That assumption is false as stated.

### 5.1 The self-absorption paradox

Self-awareness predicts psychological **distress**. Self-awareness predicts
psychological **well-being**. Both replicate, and for decades the literature
looked incoherent.

Trapnell & Campbell (1999) resolved it by separating private self-consciousness
into two components with different motives and opposite outcomes:

| | motive | outcome |
|---|---|---|
| **Rumination** | neurotic self-attentiveness — threat, loss, perceived injustice | distress |
| **Reflection** | intellectual self-attentiveness — curiosity about oneself | well-being |

Indistinguishable from outside. Opposite in effect.

Mor & Winquist's meta-analysis found rumination more strongly related to
negative affect than any other form of self-focus.

### 5.2 What separates them

Kross & Ayduk, *Facilitating Adaptive Emotional Analysis* (PSPB, 2008), supplies
the mechanism at a level of detail that can be built against.

**Design.** Participants recalled an experience of overwhelming sadness, then
were randomly assigned to immersed-analysis (n = 48), distanced-analysis
(n = 48), or distraction (n = 45).

**The manipulation was two sentences.**

> Immersed: *"Go back to the time and place of the experience and relive the
> situation as if it were happening to you all over again…"*
>
> Distanced: *"Go back to the time and place of the experience… take a few steps
> back and move away from your experience… watch the experience unfold as if it
> were happening all over again to the distant you…"*

Both groups then analysed their feelings for 30 seconds from the assigned
vantage.

**The coded outcome is the useful part.** Two judges blind to condition rated
essays on two dimensions (inter-rater r > .79):

- **Recounting** — episodic *what* statements describing the chain of events,
  behaviours and emotions. *"I went to the top of the stairwell and cried for a
  long time."* (M = 1.10)
- **Reconstruing** — (a) statements describing a realization about, or change
  in, how the person understood the causes: *"I thought about how foolish it
  seems in retrospect"* (M = 0.27); and (b) statements assessing the experience
  from a broad perspective, integrating past and present: *"I thought about how
  glad I am that that part of my past is over"* (M = 0.34).

**Result.** Distancing produced less recounting and more reconstruing, which in
turn produced lower depressed affect. Reconstruing is the mediator.

**The finding that matters most.** Distanced-analysis was *no better than
distraction* at reducing depressed affect immediately. But at **1 day and 7
days**, the distanced group remained buffered and reported fewer recurring
thoughts than both the immersed *and* the distraction groups.

Distraction works now and fails later. Distancing works later.

**The necessary refinement.** Distance without meaning-making can induce further
rumination and lead to avoidance. Both components are required: distance alone
becomes detachment, meaning-making from inside becomes rumination.

### 5.3 Reflection that works is visible in language

Pennebaker's expressive-writing programme is the main evidence that writing
about difficulty does anything, and its mechanism is not the assumed one.

Those who benefited were **not those who expressed the most emotion**. Catharsis
was not the mechanism. What predicted improvement was linguistic change across
sessions: a shift away from first-person singular, and rising use of **causal**
words (*because, reason, cause, why*) and **insight** words (*understand,
realize, know, meaning*). Writing that moved from fragmented venting toward
coherent explanatory narrative is what helped.

This converges with §5.2: reconstruing and causal-insight language are the same
phenomenon observed by two different methods.

### 5.4 Visualising the outcome makes it less likely

Oettingen & Mayer (2002) found vivid positive fantasy about a desired future
predicted **worse** outcomes across four samples — less weight lost, slower
recovery, lower starting salaries. The proposed mechanism is that positive
visualisation deceives the motivational system: imagining the outcome delivers
part of its reward, and effort falls.

What works is **mental contrasting** — holding the wish and outcome, then
confronting the internal **obstacle**. The contrast forces an expectancy check:
feasible wishes convert into commitment, infeasible ones are released cleanly.
Combined with Gollwitzer's **implementation intentions** (if-then plans naming
when, where and how) this is **WOOP**, and MCII outperforms either component
alone.

Recorded honestly: James Coyne has criticised some positive-fantasy studies for
small samples and questionable analyses. The intervention work is better
supported than the fantasy-harm claim.

### 5.5 "Self-actualised", made measurable

Maslow's term is not operational. Ryff's **six dimensions of psychological
well-being** are the modern eudaimonic formulation, with validated scales at 54,
42, 39 and 18 items:

1. **Self-acceptance** — knowing and accepting one's limitations
2. **Positive relations with others**
3. **Autonomy** — living by one's own convictions
4. **Environmental mastery** — a sense of control over one's situation
5. **Purpose in life** — meaning and direction
6. **Personal growth** — seeing life as an opportunity to develop

This makes the ambition falsifiable. "Become more self-actualised" cannot be
checked; "do purpose-in-life and autonomy items move over six months" can.

Two of the six are close to things already discussed: **autonomy** is close to
the self-concordance index of §4.2, and **purpose in life** is close to what
stated goals and sustained behaviour jointly express.

---

## 6. Six convergences

Independent literatures, different methods, same conclusion. These are the
load-bearing claims — each is supported more than once.

**1. Guilt marks a goal that is not the person's own.**
Higgins reaches it through emotion on failure (§3.1). Sheldon reaches it through
reasons for pursuit — introjected regulation is *defined* by guilt and shame
(§4.2). Motivational Interviewing reaches it through sustain talk. Three routes,
one signal.

**2. You cannot read a want directly, by any means.**
Formally, from behaviour (§2). Empirically, from self-report (§1). Clinically,
which is why MI evokes rather than asserts. The person cannot read it off
themselves either — that is Nisbett & Wilson.

**3. Distance plus meaning is the adaptive form of self-focus.**
Kross & Ayduk isolate it experimentally (§5.2). Pennebaker finds the same thing
in language, longitudinally (§5.3). Trapnell & Campbell predict it from the
motive underlying self-focus (§5.1).

**4. Consistency is what makes behaviour informative.**
Kegan: reliable failure is a hidden commitment, not weakness (§3.3). The
implicit-motive literature: implicit motives predict *spontaneous behavioural
trends over time*, not single acts (§1). One instance is noise in both.

**5. Attainment is not the good.**
Niemiec et al. directly — extrinsic attainment predicts ill-being (§4.3).
Hedonic adaptation indirectly — effects decay (§4.4). Affective forecasting
upstream — people mispredict what will satisfy them, and do not know that they
mispredict.

**6. Expensive evidence beats cheap evidence.**
Revealed preference (§3.6). Implicit motives predicting spontaneous behaviour
where self-report does not (§1). Hypothetical bias in stated preference
(§1). The same asymmetry three times.

---

## 7. What this means for a system that does this

### 7.1 A journal is an experience-sampling instrument

Nearly all the longitudinal work above required expensive multi-wave panels —
recruit, measure at T1, chase at T2 and T3. The Experience Sampling Method
exists because retrospective report is unreliable, and works by sampling affect
in context, repeatedly, over time.

A journal running for months **is that instrument**, already: timestamped
affect, in context, self-reported, longitudinal. The data structure those
studies had to construct at cost is a by-product here.

This is the strongest claim such a system has, and it is a claim about data
rather than about intelligence.

### 7.2 Link by link

| link | status |
|---|---|
| **what they said** | available — stated goals with verbatim spans |
| **what they actually wanted** | reachable *via reasons*, not content (§4.2) |
| **what they did** | available — sustained behaviour over time |
| **what they achieved** | **missing** — attainment is typically not recorded anywhere |
| **did it satisfy them** | reachable once attainment exists |

The fourth link is usually the gap, and it is load-bearing: without recorded
attainment, §4.3 and §4.4 are unreachable and the chain stops at "did."

### 7.3 The measurement that is genuinely novel

Once attainment is recorded:

> Compare affect in the weeks **before** an attainment against the weeks
> **after**. If it does not improve — or worsens — that is the signature
> Niemiec et al. found for extrinsic attainment.

A clinician seeing someone monthly reconstructs this from the client's report,
which is a remembered-utility judgement subject to peak-end distortion (§4.4). A
system holding timestamped affect measures the experiencing self directly.

### 7.4 Form is not cosmetic

§5 makes the delivery mechanism part of the intervention, not packaging around
it.

- **Third-person, observer framing preserves distance**; second person collapses
  it. *"You skipped the gym again"* puts the person back inside the moment.
- **Recounting without reconstruing is the avoidance failure mode.** Reciting
  events at a distance is what Kross & Ayduk warn induces further rumination.
  The output must explain, not narrate.
- **Recounting vs reconstruing is a coding scheme** (§5.2) with published
  definitions and reported inter-rater reliability. It can therefore be tested
  on generated output — not "did this read well" but "did this reconstrue."
- **Causal and insight word density is a validated progress measure** (§5.3),
  computable from a person's own entries over time, and doubles as a rumination
  detector: high first-person density, high negative affect, low causal content,
  repeated on one subject.
- **Any feature inviting someone to picture their ideal self risks the wrong
  sign** (§5.4) unless it also names the obstacle — and the obstacle should come
  from what has actually stopped this person before.

### 7.5 The standard of evidence

Two restraints, from different directions.

**Epistemic** (§2): compute the discrepancy, never assert the want. The
defensible output is the observation, not the verdict:

> *"You named this in March, worked at it through May, and got there in June.
> The way you wrote in the weeks after does not read differently from the weeks
> before."*

Every clause is evidenced. The conclusion — whether the goal was not really
theirs — belongs to the person, which is also what MI requires.

**Consequential** (§5): a true statement delivered in the wrong form is an
intervention with the wrong sign. Verification makes claims true; it says
nothing about whether saying them, that way, at that moment, helps. Those are
separate problems and only the first is typically solved.

---

## 8. Open questions

Honest gaps in this review.

**Narrative identity.** McAdams' work on life stories and redemptive sequences
would speak directly to *what shape* a reconstrual should take, not merely that
it should reconstrue. Not covered here.

**Dose.** Kross & Ayduk manipulated vantage for 30 seconds on one recalled
memory with ~140 participants. Extrapolating to sustained, repeated,
personalised narration is an inference. The direction is well supported; the
dose is not.

**Whether these findings compose.** Each is established in isolation. Whether
self-distanced reconstrual *plus* concordance feedback *plus* mental contrasting
interact benignly is untested — and interventions that each work alone do not
reliably combine.

**Replication.** Several of these are pre-2015 social psychology. Self-concordance
and expressive writing have held up reasonably; self-discrepancy theory's
specific emotion predictions have had mixed replication; the positive-fantasy
harm result has been directly criticised. The convergences in §6 are more
trustworthy than any single study, which is the reason to lean on them.

---

## Bibliography

### Implicit vs explicit motivation
- McClelland, Koestner & Weinberger (1989). *How do self-attributed and implicit motives differ?* — [summary](https://www.researchgate.net/publication/232512454_How_Do_Self-Attributed_and_Implicit_Motives_Differ)
- Köllner & Schultheiss (2014). *Meta-analytic evidence of low convergence between implicit and explicit measures of implicit motives* — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3856393/) · [Frontiers](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00923/full)

### Limits of introspection
- Nisbett & Wilson (1977). *Telling More Than We Can Know: Verbal Reports on Mental Processes* — [PhilPapers](https://philpapers.org/rec/NISTMT)
- Johansson, Hall, Sikström, Tärning & Lind (2006). *How something can be said about telling more than we can know: choice blindness and introspection* — [PDF](https://www.lucs.lu.se/fileadmin/user_upload/lucs/2011/01/Johansson-et-al.-2006-How-Something-Can-Be-Said-About-Telling-More-Than-We-Can-Know.pdf)

### The impossibility result
- Armstrong & Mindermann (2018). *Occam's Razor Is Insufficient to Infer the Preferences of Irrational Agents*, NeurIPS — [arXiv](https://arxiv.org/pdf/1712.05812) · [reviews](https://proceedings.neurips.cc/paper/2018/file/d89a66c7c80a29b1bdbab0f2a1a94af8-Reviews.html)
- Skalse & Abate (2023). *Misspecification in inverse reinforcement learning*, AAAI — [ACM](https://dl.acm.org/doi/10.1609/aaai.v37i12.26766)

### Self-discrepancy
- Higgins (1987). *Self-Discrepancy: A Theory Relating Self and Affect*, Psychological Review — [PDF, Columbia](https://www.columbia.edu/cu/psychology/higgins/papers/HIGGINS=PSYCH%20REVIEW%201987.pdf)

### Self-concordance and the goal chain
- Sheldon & Elliot (1999). *Goal striving, need satisfaction, and longitudinal well-being: the self-concordance model*, JPSP — [PubMed](https://pubmed.ncbi.nlm.nih.gov/10101878/)
- Sheldon & Houser-Marko (2001). *Self-concordance, goal attainment, and the pursuit of happiness: can there be an upward spiral?* — [PubMed](https://pubmed.ncbi.nlm.nih.gov/11195887/)
- Sheldon, Elliot, Ryan, Chirkov et al. (2004). *Self-concordance and subjective well-being in four cultures* — [PDF, SDT](https://selfdeterminationtheory.org/SDT/documents/2004_SheldonElliotRyanChirkovetal.pdf)
- *Goal Self-Concordance Model: What Have We Learned and Where Are We Going* (2021) — [ScienceDirect](https://www.sciencedirect.com/org/science/article/pii/S1462373021000158)
- Ryan & Connell (1989). *Perceived locus of causality and internalization* — [PDF, SDT](https://selfdeterminationtheory.org/SDT/documents/1989_RyanConnell.pdf)

### Attainment that harms
- Niemiec, Ryan & Deci (2009). *The Path Taken: Consequences of Attaining Intrinsic and Extrinsic Aspirations in Post-College Life*, JRP 43:291–306 — [PDF, SDT](https://selfdeterminationtheory.org/SDT/documents/2009_Niemiec%20RyanDeci_JRP.pdf) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/20161160/)

### Experienced vs remembered satisfaction
- Kahneman, Wakker & Sarin. *Back to Bentham? Explorations of Experienced Utility*, QJE — [PDF](https://personal.eur.nl/wakker/pdfspubld/97.1kwsqje.pdf)
- Kahneman. *Experienced Utility and Objective Happiness: A Moment-Based Approach* — [PDF, UCLA](https://www.anderson.ucla.edu/faculty/keith.chen/negot.%20papers/Kahneman_ExperiencedUtility00.pdf)
- Oliver. *Distinguishing between experienced utility and remembered utility* — [PDF, LSE](https://eprints.lse.ac.uk/66166/1/Oliver_Distinguishing_Between_Experienced_Utility_v1_Final.pdf)
- Diener, Lucas & Scollon (2006). *Beyond the Hedonic Treadmill: Revising the Adaptation Theory of Well-Being* — [PDF, APA](https://www.apa.org/pubs/journals/releases/psp-843527.pdf)
- Wilson & Gilbert (2005). *Affective Forecasting* — [PDF](https://bear.warrington.ufl.edu/brenner/mar7588/Papers/wilson-gilbert-cdips2005.pdf)
- Wilson, Wheatley, Meyers, Gilbert & Axsom. *Focalism: A Source of Durability Bias in Affective Forecasting* — [PDF, Harvard](https://scholar.harvard.edu/files/danielgilbert/files/wilson_et_al_focalism.pdf)

### Rumination vs reflection
- Trapnell & Campbell (1999). *Private self-consciousness and the five-factor model of personality: distinguishing rumination from reflection*, JPSP — [PubMed](https://pubmed.ncbi.nlm.nih.gov/10074710/)
- Morin. *Do you "self-reflect" or "self-ruminate"?* — [PDF](https://journalpsyche.org/articles/0xc102.pdf)
- [Self-absorption paradox](https://en.wikipedia.org/wiki/Self-absorption_paradox)

### Self-distancing
- Kross & Ayduk (2008). *Facilitating Adaptive Emotional Analysis: Distinguishing Distanced-Analysis of Depressive Experiences From Immersed-Analysis and Distraction*, PSPB 34(7):924–938 — [DOI](https://doi.org/10.1177/0146167208315938) · [PDF, UMich](https://websites.umich.edu/~ekross/papers/Kross%20-%20Facilitating%20Adaptive%20Emotional%20Analysis%20(2008).pdf)
- Ayduk & Kross (2010). *Analyzing Negative Experiences Without Ruminating: The Role of Self-Distancing in Enabling Adaptive Self-Reflection* — [PDF, Berkeley](https://rascl.studentorg.berkeley.edu/assets/files/ayduk_kross_compass_2010.pdf)
- Kross & Ayduk (2011). *Making Meaning out of Negative Experiences by Self-Distancing* — [PDF, Berkeley](https://rascl.studentorg.berkeley.edu/assets/files/kross_ayduk_2011_cd.pdf)
- Kross & Ayduk. *Self-Distancing: Theory, Research, and Current Directions* — [PDF, UMich](https://sites.lsa.umich.edu/emotion-selfcontrol-psych/wp-content/uploads/sites/1322/2017/09/Self-distancing-theory-research-future.pdf)

### Expressive writing
- Pennebaker & Chung. *Expressive Writing: Connections to Physical and Mental Health* — [PDF, MIT](https://c3po.media.mit.edu/wp-content/uploads/sites/45/2016/01/PennebakerChung_FriedmanChapter.pdf)
- Zheng, Lu & Gan (2019). *Effects of expressive writing and use of cognitive words on meaning making and post-traumatic growth* — [SAGE](https://journals.sagepub.com/doi/full/10.1017/prp.2018.31)
- *Efficacy of expressive writing versus positive writing: systematic review and meta-analysis* — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10415981/)

### Clinical method
- Miller & Rollnick. Motivational Interviewing — [MINT](https://motivationalinterviewing.org/understanding-motivational-interviewing) · [glossary](https://motivationalinterviewing.org/sites/default/files/glossary_of_mi_terms-1.pdf)
- Kegan & Lahey. *Immunity to Change* — [method overview](https://www.humanizingwork.com/immunity-to-change/)
- ACT values vs goals; Valued Living Questionnaire — [values measures review](https://www.sciencedirect.com/science/article/abs/pii/S2212144718302813) · [Psychology Tools](https://www.psychologytools.com/resource/values)
- Cognitive case formulation — [Psychology Tools](https://www.psychologytools.com/resource/cognitive-case-formulation)

### Goal structure
- Little. *Personal Projects Analysis: Trivial Pursuits, Magnificent Obsessions, and the Search for Coherence* — [Springer](https://link.springer.com/chapter/10.1007/978-1-4684-0634-4_2) · [author page](https://www.brianrlittle.com/Topics/research/personal-projects-analysis/)
- Kruglanski, Chernikova et al. *The Architecture of Goal Systems: Multifinality, Equifinality, and Counterfinality in Means–End Relations* — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S2215091915000024)

### Goal-setting interventions
- Oettingen & Mayer (2002); mental contrasting — [overview](https://en.wikipedia.org/wiki/Gabriele_Oettingen)
- *Mental contrasting with implementation intentions as a technique for media-mediated persuasive health communication* — [Taylor & Francis](https://www.tandfonline.com/doi/full/10.1080/17437199.2021.1988866)
- MCII randomised trial protocol (VA MOVE!) — [PubMed](https://pubmed.ncbi.nlm.nih.gov/38608752/)

### Revealed vs stated preference
- de Corte et al. (2021). *Stated versus revealed preferences: an approach to reduce bias*, Health Economics — [Wiley](https://onlinelibrary.wiley.com/doi/full/10.1002/hec.4246)
- *Combining stated and revealed preferences* (2025) — [arXiv](https://arxiv.org/pdf/2507.13552)

### Eudaimonic well-being
- Ryff. Scales of Psychological Well-Being — [Penn PPC](https://ppc.sas.upenn.edu/resources/questionnaires-researchers/psychological-well-being-scales) · [measure detail](https://sparqtools.org/mobility-measure/psychological-wellbeing-scale/)
- *Interventions to enhance eudaemonic psychological well-being: a meta-analytic review with Ryff's Scales* — [Wiley](https://iaap-journals.onlinelibrary.wiley.com/doi/10.1111/aphw.12398)

### Longitudinal measurement
- Csikszentmihalyi & Larson. Experience Sampling Method — [overview](https://en.wikipedia.org/wiki/Experience_sampling_method)
- *Leveraging Experience Sampling / Ecological Momentary Assessment for Sociological Investigations of Everyday Life*, Annual Reviews — [link](https://www.annualreviews.org/content/journals/10.1146/annurev-soc-091523-013249)
