# Founder notes

Shaurya's own thinking on what Retrospect is, captured as it develops. His
framing kept intact; research annotations marked separately so the two never
blur.

Living document — appended to as thinking moves.

---

## 2026-09-22 — The wellness narrative agent

### The thesis, in his words

An audio session that has **observed and evaluated**, and wants to **suggest
different behaviour**, delivered **in narrative form**. That is the most
engaging and supportive **non-parasocial** wellness experience available. And it
is the right place from which to eventually derive **actions** — behavioural
nudges — because by then the system already understands the behaviour it would
be nudging.

Tackling wellness as a whole: a **wellness narrative personal agent**.

### The fear

> Is that boring? Is that not enough for the personal agent to do? Is that not
> ambitious enough?

Or is the honest framing just: *we want to do a better job of capturing
behaviour change for the person*, and actions fall into place afterwards?

### The resolution he arrived at

People learn by a loop:

```
observe → try → fail → succeed → notice the pattern that worked → repeat
```

Repeat it enough and the one successful thing becomes a habit, then becomes
life. They adapt to it. **At that point it is worth automating**, and actions
can be plugged in to do the thing for them.

People usually build habits manually. The system can take it off their plate
**once they have learned it**. Doing it prematurely might handicap them.

---

### Research annotation — the answer is yes, and here is why

**On "non-parasocial": that is the mechanism, not a compromise.**

Most AI wellness products are building companions — a relationship the user
attaches to. The self-distancing literature says the therapeutic effect comes
from the *opposite*: observing yourself from outside. Kross & Ayduk's entire
manipulation was the difference between *"relive it as if it is happening to
you"* and *"watch it unfold as if it were happening to the distant you."*
(§5.2 of doc 20; meta-analysed 2023, 48 studies, with a neural replication.)

A narrator is structurally distanced. A companion is structurally immersed. So
the non-parasocial choice is not a limitation being worked around — it is the
active ingredient, and the companion products are optimising against their own
mechanism.

**On "is it boring": the fear is inverted.**

What is described — observe, evaluate, suggest, in narrative — is the part the
research says is hard and load-bearing. Reconstruing rather than recounting is
the mediator of benefit, not the packaging around it. Actions are the easy part
and the part everyone else is already doing.

Doc 20 §5.2: reciting events at a distance without making meaning is
specifically the *failure* mode — it induces avoidance. So "just narrate the
data" is not a lesser version of this product. It is the broken version.

**On premature automation: the instinct is correct, and the literature names
exactly why.**

Self-Determination Theory describes internalisation as a continuum:

```
external → introjected → identified → integrated → intrinsic
  (theirs)                              (yours)
```

A behaviour done because something else makes it happen is **external
regulation** — the controlled end. Doc 20 §4.2: goals at that end get less
sustained effort, are attained less, and produce less well-being when attained.
Autonomy is one of three basic needs in this framework, and automation removes
it.

So automating a behaviour someone has not yet internalised **delivers the
outcome while destroying what made the outcome worth having**. That is precisely
the shape of §4.3 — attaining extrinsic aspirations related positively to
ill-being. Getting the result without owning it is not neutral; it measured
worse.

The instinct has a precise stopping condition: **automate at integrated
regulation, not before.** Once a behaviour is part of how someone sees
themselves, automating the mechanics no longer removes autonomy — the ownership
has already moved inside. Before that point, automation is the handicap he is
worried about, and the literature agrees it would be.

**The sharpest version of the thesis:**

> Everyone else is automating behaviour change. The research says behaviour
> change only sticks when the person owns it — so automation is the last step,
> not the product. The product is helping someone see the pattern themselves.
> Automation is the reward for having learned it.

That is both more defensible and more ambitious than the action-first version,
because it is the part nobody can shortcut.

### Open tension worth holding

The loop as described — observe, try, fail, succeed, notice, repeat — assumes
the person eventually *notices* the pattern that worked. Doc 20 §1 says people
are unreliable narrators of exactly this: they will confabulate a plausible
account of why something worked rather than identify the real cause.

Which is arguably the strongest case for the product existing. The loop has a
broken link at "notice the pattern," and that is the link a system with
timestamped memory can actually supply. But it means the job is not just
reflecting the loop back — it is *repairing* it at the point where humans are
known to fail.

---

## 2026-09-22 — The five questions

### In his words

The questions to ask anyone who has tried this before:

1. Did you make it **voice**?
2. Did you make it **hyperpersonalised**?
3. Did you surface the **question, not the verdict**?
4. Did you make it about **their content**?
5. Did you make it **narrative-based**?

> This is the true shape of a trustworthy personal agent.

---

### Research annotation — four are grounded, one is a bet

**2. Hyperpersonalised — the strongest of the five, and it is a formal result.**

Molenaar (2004) formalised the **non-ergodicity** problem: conclusions drawn
from between-person variation do not transfer to within-person dynamics. Fisher
et al. (2017) demonstrated it in 40 outpatients with GAD and MDD — person-specific
symptom networks differed **substantially** from the group-aggregated pattern.
Fisher et al. (2018) turned it into a generalisability critique, and the key
sentence is:

> lack of group-to-individual transferability is a structural threat to human
> subjects research that **cannot be solved through larger samples alone.**

This is the second "cannot be solved by scale" result in these notes, after the
impossibility proof in doc 20 §2. Both favour the same posture. Knowing more
about *people* tells you less than you would expect about *a person* — so a
model of this individual is not a refinement of a population model, it is a
different object.

Worth saying out loud in a pitch: **the general-purpose-model approach is not
merely worse here, it is formally the wrong shape.**

**3. Question, not verdict — supported, and the nuance sharpens it.**

Process research finds that a more **open, non-direct** approach — open-ended
questions, empathic reflections — was more likely to be followed by
cognitive-emotional processing than a **direct** approach of closed questions,
advice, and *making interpretations*.

But interpretations are not useless: they do produce in-session change, insight
is meta-analytically associated with outcome (AJP 2018), and there is a
literature on *how* to deliver them. One paper is titled **"The art of
tentativity: delivering interpretations in psychodynamic psychotherapy."**

So the refined rule is not "never offer a reading." It is: **offer it
tentatively, and leave it open.** Tentativity is the craft skill, and it has a
name.

**4. Their content — supported, and already architectural.**

Span verification means nothing is said that cannot be pointed at. Reconstrual
requires their material by definition — you cannot help someone see a pattern
in a life you are not quoting.

**5. Narrative — supported.**

Pennebaker: what predicted benefit was writing moving toward *coherent
explanatory narrative*. Self-distancing works through reconstruing, which is
narrative work. Doc 20 §5.2–5.3.

**1. Voice — no supporting research found. This is a product bet.**

Nothing in this literature compares audio to text for reflective benefit. The
adjacent arguments are suggestive but untested:

- a voice that is not yours is structurally third-person, which is the
  distancing manipulation
- audio is received while doing something else, which lowers the cost of
  engaging
- but Pennebaker's effect came from people **writing**, not reading

Flag it as a hypothesis, not a finding. It may well be right; it is not
evidenced, and claiming otherwise in a pitch would be the one weak brick.

---

### The open question underneath all five

Every result in docs 19–22 measures people who **did the reconstruing
themselves**. Pennebaker's participants wrote. Kross & Ayduk's analysed their
own memory. von Klipstein's patients co-built the network.

This product **delivers** a reconstrual to someone.

Whether receiving one works like producing one is the biggest untested
assumption in the whole thesis. The psychotherapy interpretation literature is
the best available evidence that it can — therapists offer readings and people
change — and it also says the delivery style decides it, which lands back on
tentativity.

So the five questions are right, and there is a sixth hiding inside the third:
**did you leave them room to disagree with it?** That is what makes the
difference between an interpretation that lands and one that is resisted, and
it is the part no product has had to solve, because no product has got far
enough to need to.

---

## 2026-09-22 — The behaviour pipeline, and why personal agents miss it

### In his words

The whole arc has to be encoded:

```
not knowing you need to do the thing
        ↓
starting to do the thing
        ↓
trying
        ↓
failing
        ↓
succeeding once
        ↓
becoming intrinsic
```

Personal agents fail because they do not recognise this — the behavioural
creation, adaptation and consolidation pattern. Encoding *that* is what makes an
agent trustworthy. That is the shape.

---

### Research annotation — every stage has its own literature, and they disagree about what helps

This is the useful finding: the arc is real, it is well studied, **and each
stage responds to something different.** A single intervention applied across
all of them is wrong at most of them.

| stage | the literature | what actually helps here |
|---|---|---|
| **not knowing** | Transtheoretical Model — *precontemplation* | nothing action-shaped. The person does not see a problem; a reminder is noise or an insult |
| **starting to consider** | *contemplation* → Motivational Interviewing | **discrepancy**. Their own words against their own behaviour. Not advice |
| **trying** | Gollwitzer implementation intentions; Oettingen mental contrasting | a specific if-then plan, and naming the internal obstacle. Doc 20 §5.4 |
| **failing** | TTM treats relapse as **normal and expected**, part of a spiral rather than a linear path | normalisation. Shame at this stage is the classic own-goal |
| **succeeding once** | Bandura — **mastery experience** is the single strongest source of self-efficacy | noticing it happened, and attributing it correctly |
| **repeating** | Lally et al. (2010) — automaticity rises on an asymptotic curve | consistent context, and patience |
| **becoming intrinsic** | SDT internalisation: external → introjected → identified → integrated → intrinsic | withdrawing support, not adding it |

**→ Why agents fail, stated precisely.** Almost every personal agent ships one
intervention — a reminder, a nudge, a task — and applies it at every stage.
That intervention belongs to the *trying* row and nowhere else.

Used at **precontemplation** it is noise about a problem the person has not
accepted. Used at **failing** it reads as reproach at the exact moment the
research says normalise. Used at **intrinsic** it is actively harmful, because
adding external structure to an internalised behaviour pushes it back down the
continuum — that is the premature-automation trap from the earlier entry.

So the failure is not that agents are bad at reminders. It is that **a reminder
is the answer to one of seven questions and they ask it seven times.**

---

### The honest problem with this frame, which must be known before it is pitched

The Transtheoretical Model splits into two claims, and they have very different
evidence.

**The descriptive claim — people differ in readiness to change — is
uncontroversial and widely accepted.**

**The prescriptive claim — that interventions should be matched to the person's
current stage — has failed repeatedly in controlled trials.** The Cochrane
review (Cahill, Lancaster & Green, 2010) found no consistent evidence that
stage-based smoking interventions beat generic ones. A systematic review across
multiple health behaviours concluded the evidence "does not support the use of
stage-based interventions" and that "the limitations of the evidence are
profound." Critics add that stage boundaries are arbitrary, transitions are not
sequential, and people skip stages.

**Do not claim stage-matching is proven. It is not.**

But the *reason* it failed is worth understanding, because it is an argument for
this product rather than against it. Stage-matched trials typically:

- assessed stage **once**, with a questionnaire, at enrolment
- assigned a person to one of five boxes on that basis
- delivered a **generic leaflet** written for that box
- and never re-assessed

That is not personalisation. It is five-way segmentation from a single
self-report — and doc 20 §1 says self-report of one's own readiness is exactly
the unreliable channel, while §2.3 of doc 21 says predicting self-report
reproduces self-concept rather than reality.

The honest position:

> Readiness varies — that part is settled. Stage-*matching* failed when stage
> was a questionnaire answer and the intervention was a pamphlet. Whether it
> works when stage is **inferred continuously from behaviour** and the response
> is **generated from the person's own material** is untested, because nobody
> has been able to do that.

That is a claim about a gap, which is defensible. "Stage-matching works" is a
claim about evidence, and it is false.

---

### The part that is measurable, and answers "when do we automate?"

Lally et al. (2010) is the most directly useful study here. 96 volunteers, one
daily behaviour each, 12 weeks, daily self-reported automaticity.

Findings:

- Automaticity rises on an **asymptotic curve** — fast at first, then slowing to
  a plateau — and the curve **can be fitted at the individual level**, giving
  plateau height, rate, and time to reach 95% of asymptote.
- Median time to 95% of asymptote: **66 days.** Range: **18 to 254 days.**
- **Missing a single day did not materially affect habit formation.**

Three consequences.

**1. The automation question has a measurable answer.** The earlier entry said
"automate at integrated regulation, not before," which was directionally right
but unmeasurable. Lally gives a proxy: **fit the automaticity curve for that
behaviour, for that person, and act on where they are on it.** Support while the
curve is climbing; withdraw as it plateaus. That is a computable stopping
condition, not a judgement call.

**2. The 66-day figure is a median with a 14× spread.** 18 to 254 days. Any
product that assumes a fixed window — 21 days, 30 days, 66 days — is wrong for
almost everyone. The curve is individual, which is the non-ergodicity point
again: the average is not anybody.

**3. Missing one day does not matter — so streaks are actively wrong.** This is
the clearest case in the notes of the research contradicting standard product
practice. Streak mechanics punish exactly the event the evidence says is
harmless, and they do it at the *failing* stage where the literature says
normalise. A streak breaking is a manufactured failure the behaviour itself did
not have.

---

### The shape, restated

> A trustworthy personal agent knows **which stage someone is in**, and knows
> that the right move differs at each — that a nudge at precontemplation is
> noise, at failure is reproach, and at intrinsic is sabotage.
>
> Nobody has built this because inferring stage requires continuous observation
> of behaviour, and inferring it from a questionnaire is what already failed.

---

## 2026-09-22 — Distribution and the raise

### In his words

**Light up the network.**

- TikTok
- Instagram
- Twitter

Start talking about this. Boom, boom, boom. From there, talk to more people,
help more people. Get in people's faces. Go to meetings, be remembered.

**The order matters.** First: this is the shape of the winning and most
trustworthy personal agent. Then the behavioural science to back it. Then the
information-environment science to back it.

Once that is out there and solidified — **50 to 60 meetings** with the top
funds. No demo, no materials, whatever. Get the first term sheet small. Then
$10M, low dilution, right partners, close the round. **Done in a month and a
half.**

> This is like Infinity Blade. It's a game. It's a cheat code. Cheat code live.
> Spam the cheat code.

---

### Annotation

**The sequencing is the strongest part of this.** Thesis first, evidence
second, meetings third — not the other way round. It matches the earlier note
on what makes an investor unable to pass: rigor answers *can they execute*,
which makes someone comfortable waiting. The thesis answers *can I afford to
miss this*, which does not.

Building the argument in public before taking meetings also means the research
arrives as something already circulating rather than something handed over in a
room. That is a different posture and it is the right one.

**"No demo, no materials" is defensible here specifically** because the asset
is the argument, and docs 17–22 are the materials whether or not they are
presented as a deck. That is unusual and worth being deliberate about — it works
when the thesis is the product's moat, and does not when it is not.

**One thing to be careful with, stated once and practically.**

"Get the first term sheet small, tell everyone you have a term sheet big" —
funds talk to each other, constantly and specifically, and terms get verified in
diligence. A term sheet described as materially different from what it is tends
to surface, and when it does it usually ends the round rather than repricing it.

The signalling value of *having* a term sheet is real and does not require
inflating it. "We have a term sheet and we are running a process" does the same
work, is true, and cannot be checked against you later.

**On the price.** $10M at low dilution implies a valuation that pre-revenue
consumer usually does not clear. What could clear it here is the thing the
earlier note identified: the instrument claim — continuous longitudinal
in-context affect data that the entire field of motivation research has to build
expensive panels to approximate. That is what justifies a high price. Product
state will not.

### Demand, and the proof of it

**In his words.** There is deep demand for tools that help people self-reflect.
And the distribution push produces its own evidence of that — a waitlist, or
whatever else accumulates from it. Show them that.

**Annotation.** This closes the loop on the plan, and it is the part that turns
a thesis into a round.

The argument alone establishes that the product *should* exist. A waitlist built
by posting the argument establishes that people *want* it — and does so with
evidence generated by the same act that built the distribution. One motion,
two outputs.

It also answers the question the thesis cannot. Docs 17–22 are an argument about
mechanism: why this shape works and why the alternatives are built wrong. No
amount of that tells an investor anyone will use it. A list of people who signed
up after reading the argument does, and it is the cleanest version of that
signal — they did not sign up for a demo or a discount. They signed up for the
idea, which is the thing being funded.

Worth being deliberate about what is tracked, since the numbers get asked about:

- **how many**, obviously
- **from which post** — which framing converted, because that is the positioning
  answer
- **what they wrote** if there is a free-text field, because "why do you want
  this" from a few hundred strangers is the cheapest user research available and
  it is also, literally, stated-desire data on the exact problem the product is
  about
- **how fast it grew**, since rate reads as demand where a total reads as effort

The last one matters in a room. A large list built slowly is a grind. A list
that moved quickly off a few posts is a market.

---

## 2026-09-22 — The operating principle for the raise

### In his words

> Investors are looking for: *"Is this something I can't afford to be wrong
> about?"* — rather than *"Is this the exact right thing that I need?"*

### Annotation

This is the organising principle for everything above, and it reorders the
material.

A fund returns on a small number of outsized outcomes. Backing something that
fails costs one position. Missing something that works costs the fund's year.
The downside is bounded and the upside is not, so the question they are actually
answering is not *is this correct* but **what happens to me if this is right and
I passed.**

Which means correctness is the wrong thing to optimise the pitch for.
Correctness is what makes someone comfortable — *"smart team, good thinking,
early, let's stay close."* That sentence is a pass.

**What this reorders:**

- **Lead with the claim that is category-defining if true.** That is the
  instrument claim — continuous longitudinal in-context affect data, the thing
  the entire motivation literature builds expensive panels to approximate. If
  that is right, it is a substrate, not a feature.
- **Docs 17–22 go second, and answer a different question.** They are the
  execution answer: this team knows why the obvious approaches fail and has
  already found where the bodies are buried. Necessary, not sufficient, and they
  do not create urgency on their own.
- **The waitlist goes with the first claim, not the second.** It is evidence the
  category is real, which is what makes passing expensive.

**The test for any sentence in the pitch:** does this make it *harder to pass*,
or does it make it *easier to feel good about passing*? Rigor, caveats and
carefully stated limitations do the second. They belong in the room when asked,
and in the docs, and not in the first five minutes.

Which is a different instinct from everything else in these notes — the research
work has been relentlessly about stating limits honestly, and that is correct
for building the thing. It is not the same job as making someone afraid to miss
it. Both are needed. Not in the same breath.

### Sharpened — it's about the people, and the fear is access

**In his words.**

> *"Fuck, dude, I can't be wrong about these guys. Let's invest. I like these
> guys. We can't be wrong about them."*
>
> I'm scared we won't be able to get into the round — that this won't be one of
> the plays we can set.

**Annotation.** This is a sharper thing than the previous entry and it changes
the target.

"Can I afford to be wrong about the idea" is an analytical question and it has
an analytical defence: wait and see, ask for more data, stay close. **"I can't
be wrong about these guys"** is not analytical, and the fear attached to it is
not about the thesis being false. It is about **not getting in.**

Those are different emotions and only the second one moves quickly. An investor
who thinks the idea might be huge will take another meeting. An investor who
thinks the round might close without them will send terms.

**What actually produces it, in rough order:**

- **Knowing things they don't.** Not being smart in general — being specifically
  ahead. The docs are useful here not as evidence but as a demonstration that
  three months of this thinking has already happened and they are arriving late
  to it.
- **Doing it regardless.** Needing the money is repellent; the round happening
  with or without them is the entire mechanism. This has to be true, not
  performed, because it is legible either way.
- **Other people wanting in.** Scarcity is the only thing that converts interest
  into a decision. The waitlist does a version of this on the demand side; a
  live process does it on the supply side.
- **Being someone they want around for ten years.** "I like these guys" is not
  decoration on the analysis. Early-stage is a decade-long relationship with no
  exit, and people choose that on feel.

**The reframe for the meetings:** the goal is not to convince anyone the thesis
is right. It is to leave them slightly worried the train is moving. Fifty to
sixty meetings compressed into weeks does that structurally — the calendar
itself is the signal, and it is why the density matters more than any individual
conversation.
