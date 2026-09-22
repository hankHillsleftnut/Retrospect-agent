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
