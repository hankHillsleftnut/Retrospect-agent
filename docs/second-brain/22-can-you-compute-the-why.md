# 22 — Can you compute the why?

**The claim under test.** Someone says they want to work out and doesn't. Doc 20
§2 says that observation is ambiguous — they didn't want to, or wanted to and
failed. But ask *why* enough times, across enough data, and you could triangulate
the actual cause: an eating disorder, a brother they never feel they match. Then
start rewiring it.

**Yes or no?**

---

## The answer

**Yes, the why is knowable. No, it cannot be computed from observation alone.**

The gap between those two sentences is the whole document, and it resolves into
something buildable.

---

## 1. For the claim: an entire discipline does exactly this

Applied behaviour analysis has a formal method for determining why a behaviour
occurs: **functional analysis** (Iwata et al., 1982/1994).

> Functional analysis is well established as the **gold-standard methodology for
> identifying the function of challenging behavior** — and is the only method
> that can demonstrate a **causal relation** between the behaviour and its
> reinforcing consequences.

The framework is **ABC**: antecedents, behaviour, consequences. Observe what
reliably precedes the behaviour and what reliably follows it, and the function
becomes visible.

> **→ In plain English.** There's a whole field whose job is answering "why does
> this person keep doing this," and it works. It's the standard in autism and
> developmental disability treatment, and it has been for forty years.
>
> The method isn't mysterious: watch what happens right before the behaviour,
> and what the person gets right after. Do that enough and the function shows
> up — the behaviour is getting them something.

**So the intuition is sound.** Why someone doesn't go to the gym is a real,
discoverable fact, not an unknowable interior.

### But note what makes it the gold standard

There is a crucial distinction the field itself draws:

- **Functional analysis (FA)** *changes the environment* to test a hypothesis,
  then observes what happens.
- **Functional behavioural assessment (FBA)** observes the behaviour in its
  natural environment without manipulation.

FA is the benchmark **because it manipulates.** It is the only method that
establishes causation — and it establishes it by *intervening and watching the
result*.

> **→ In plain English.** The gold standard isn't watching harder. It's
> **testing**. You form a guess about why, change one thing, and see if the
> behaviour changes.
>
> Pure observation — however much of it — gives you hypotheses. Testing gives
> you causes. That's the line, and it's exactly the line doc 20 §2 draws
> formally.

**Holds up: Solid.** Forty years, thousands of studies, standard clinical
practice, with comparative effectiveness trials still being run.

---

## 2. Against the claim: twelve expert labs, one patient, twelve answers

This is the single most relevant study to the question, and it goes the other
way.

**Bastiaansen et al. (2020)** gave **twelve research teams** — all experts in
experience sampling — the *same* time-series data from *one* patient. Repeated
depression and anxiety measures over time. One question: what should the
clinician treat?

> Analysts differed in their preprocessing, statistical techniques, and
> software. The twelve labs **varied widely in selected treatment targets and in
> the underlying rationale.**

Twelve expert teams. Identical data. Different conclusions about what was wrong
and what to do.

> **→ In plain English.** This is the direct test of "compute the why from lots
> of data," and it failed.
>
> They didn't disagree because some were careless. They disagreed because
> deciding what to look at, how to clean it, and which method to use are
> *judgement calls*, and reasonable experts make them differently. The data
> didn't settle it.
>
> If twelve specialist labs can't converge on one patient, an automated pipeline
> producing one confident answer isn't being smarter than them. It's hiding the
> disagreement.

**Holds up: Solid, and damning for the strong version of the claim.** Part of a
broader "same data, different conclusions" literature showing radical dispersion
when independent analysts test the same hypothesis.

### The companion critique

von Klipstein et al. (2020), *Using person-specific networks in psychotherapy:
challenges, limitations, and how we could use them anyway*:

- **No gold standard exists** for building person-specific networks, so
  different construction choices yield substantially different networks and
  therefore different case conceptualisations.
- Even built consistently, **results remain ambiguous** — subject to multiple
  interpretations.
- These methods **capture linear associations** and may misrepresent
  relationships that are non-linear.

> **→ In plain English.** Even when you build the personalised model carefully,
> there's no agreed right way to build it, and the thing you get out can be read
> several ways. And it assumes relationships are straight lines, which human
> behaviour mostly isn't.

---

## 3. The resolution, which is genuinely useful

von Klipstein's paper is titled *"...and how we could use them anyway,"* and its
answer is precise:

> When used responsibly, person-specific networks may support case
> conceptualisation **by generating questions that serve as a starting point for
> a dialogue** between therapist and patient.
>
> Beyond its potential for treatment planning, **the collaborative creation of
> the network may itself function as an active psychoeducational and
> self-regulatory intervention.**

That second sentence is the important one.

> **→ In plain English.** The model isn't the answer. The model is **a better
> question**, and handing it to the person to argue with is where the value is.
>
> And the stronger claim: *building the model together is itself the treatment.*
> Not the output — the process of working it out with someone. The thing you
> were worried wasn't ambitious enough is, in this literature, the intervention.

**This converges with everything in doc 20.** Motivational Interviewing evokes
rather than asserts. Self-distancing works through *reconstruing*, which is the
person reaching a new understanding — not being handed one. Doc 20 §7.5: compute
the discrepancy, never assert the want.

Four independent literatures, same instruction: **produce the question, not the
verdict.**

---

## 4. One correction to the method as described

The claim says "asking *why* a handful of times."

Doc 20 §1.3 is precisely about why that fails. People lack introspective access
to their own processes and generate plausible-sounding explanations instead —
they confabulate, sincerely, without knowing they're doing it. Ask someone why
they don't go to the gym and you'll get their *theory*, which is data about
their self-concept and weak evidence about the cause.

**Functional analysis deliberately does not ask.** It observes antecedents and
consequences. The whole method exists because self-report of function is
unreliable.

> **→ In plain English.** Don't ask why. Ask **what happens around it.**
>
> What was going on the day before each skipped session. What they did instead.
> What happened right after. Who was involved. What they wrote that week.
>
> "Why didn't you go?" gets you a story. "What was happening each time you
> didn't go?" gets you a pattern. The second one is the method.

---

## 5. What this means concretely

### The hypothesis is computable. The conclusion is not.

Narrowing from "they don't go to the gym" to a small set of candidate
explanations is exactly what functional analysis does, and lots of longitudinal
data makes it better. That part of the claim survives.

What doesn't survive is arriving at *one* answer automatically. Bastiaansen is
the counterexample and it's not close.

### The missing ingredient is testing, and the product can supply it

FA is the gold standard because it manipulates and observes. That's normally
expensive — a clinician arranging conditions.

But the loop from the founder notes is already the experimental design:

```
observe → try → fail → succeed → notice the pattern
                ↑
        this is the manipulation
```

A suggested change *is* an intervention. What happens next *is* the observation.
A system that proposes something and then reads what the person writes over the
following fortnight is running a single-case experiment, whether or not it calls
it one.

**That converts the impossibility result from a wall into a workflow.** Doc 20
§2 says you can't infer the reward from a fixed policy. But a policy that
*changes* in response to an intervention gives you evidence a static one never
can.

### The stakes make the delivery non-negotiable

The example given — an eating disorder, or a brother they never feel they match
— is exactly right about how consequential the guess is, and exactly why it must
be a question.

Those two hypotheses call for opposite responses, and asserting the wrong one to
someone about their own life is harmful in a way no accuracy metric captures.
Doc 20 §5 already establishes that a true statement delivered in the wrong form
is an intervention with the wrong sign. Here it's sharper: a *plausible but
wrong* statement, delivered with the confidence of computation, about something
this tender.

The literature's answer is unanimous and it isn't hedging: **generate the
question, hold the hypothesis, let the person confirm or reject it.** The
confirmation is also the test.

---

## Verdict

| the claim | verdict |
|---|---|
| The reason is a real, discoverable fact | **Yes** — functional analysis, forty years |
| More data narrows the candidates | **Yes** — and multi-stream helps |
| You can compute *the* answer from observation | **No** — twelve expert labs couldn't |
| Asking "why" repeatedly gets you there | **No** — that's the confabulation channel |
| Observing antecedents and consequences does | **Yes** — that's the actual method |
| You can then test it and know | **Yes** — and that's the only route to causal |
| It should be delivered as a conclusion | **No** — question, unanimously |

**So: yes, with the method changed and the output reframed.** Not "we computed
why you don't go to the gym." Rather: "here is what was happening each of the
last nine times — does this look like anything to you?" And then the answer to
*that* is the next piece of evidence.

---

## Bibliography

### Functional analysis
- Iwata, Dorsey, Slifer, Bauman & Richman (1982/1994). *Toward a functional analysis of self-injury* — the founding FA methodology
- [Functional behavior assessment — overview](https://en.wikipedia.org/wiki/Functional_behavior_assessment) · [ScienceDirect topic](https://www.sciencedirect.com/topics/psychology/functional-behavioral-assessment)
- *A comparative effectiveness trial of functional behavioral assessment methods* — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10843530/)
- *When should a functional analysis be done and who should do it?* — [ASAT](https://asatonline.org/research-treatment/clinical-corner/functional-analysis/)

### Against automatic inference
- **Bastiaansen et al. (2020).** *Time to get personal? The impact of researchers' choices on the selection of treatment targets using the experience sampling methodology*, Journal of Psychosomatic Research — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S002239992030773X)
- Breznau et al. (2021). *Same data, different conclusions: radical dispersion in empirical results when independent analysts operationalize and test the same hypothesis* — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0749597821000200)
- **von Klipstein, Riese, van der Veen, Servaas & Schoevers (2020).** *Using person-specific networks in psychotherapy: challenges, limitations, and how we could use them anyway*, BMC Medicine — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7682008/) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/33222699/)

### Personalised modelling generally
- *Personalized Models of Psychopathology*, Annual Review of Clinical Psychology — [Annual Reviews](https://www.annualreviews.org/content/journals/10.1146/annurev-clinpsy-102419-125032)
- *Person-specific networks in psychopathology: past, present, and future* — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2352250X21000300)
- *From person-specific networks to personalized psychiatry: what evidence is still needed?* — [Frontiers](https://www.frontiersin.org/journals/psychiatry/articles/10.3389/fpsyt.2026.1967025/full)
