# 21 — Inferring a person from their digital traces

What research exists on taking many streams from someone's life — stated
desires, consistent behaviour, what they read, what they scroll, browsing
history, relationships, messages — and triangulating what they actually want.

Same format as doc 20: **→ In plain English** after each finding, and a rating
of how much weight it bears (Solid / Reasonable / Contested / Framework).

---

## The short answer

Three substantial literatures exist. **None of them does what you described**,
and the gap is instructive rather than merely absent.

| literature | what it does | what it infers |
|---|---|---|
| **Digital phenotyping** | continuous passive measurement from phones | states — mood, symptoms, relapse risk |
| **Computational personality** | predicting people from digital footprints | **traits** — Big Five, stable dispositions |
| **Lifelogging** | capturing everything, then trying to use it | memory retrieval, mostly |

Everything here infers **traits and states**. Almost nothing infers **desires**.

That distinction is the whole document. Doc 20 §2 explains why: traits are
stable patterns, and patterns predict patterns, which is a tractable
machine-learning problem. Desires are formally underdetermined from behaviour —
you cannot separate *didn't want it* from *wanted it and failed*. One is a
modelling problem; the other is provably not.

So: the literature you were hoping for does not exist. What exists is adjacent,
and worth knowing precisely because of where it stops.

---

## 1. Digital phenotyping — the measurement layer

**Definition** (Torous, Kiang, Lorme & Onnela, 2016): the "moment-by-moment
quantification of the individual-level human phenotype in situ using data from
personal digital devices."

Splits into **active data** (things the person supplies) and **passive data**
(sensors, usage patterns, gathered without participation). The clinical case is
that this replaces periodic cross-sectional assessment, which is prone to recall
bias, with continuous in-situ measurement.

Onnela's lab built the **Beiwe** platform under NIH funding; applications
include schizophrenia cohorts, suicide risk, and self-management science.

> **→ In plain English.** This is the field that says: stop asking people how
> they've been and start measuring how they actually were. Your phone already
> knows how much you moved, slept, texted, and left the house.
>
> It was invented for the same reason doc 20 §4.4 matters — memory distorts, so
> retrospective self-report is a weak instrument. Measuring continuously avoids
> the problem entirely.
>
> This is the closest existing thing to the infrastructure you described. Note
> what it's used for: detecting *states* — is someone relapsing, deteriorating,
> at risk. Not what they want.

**Holds up: Reasonable, and young.** A real and funded field with clinical
deployments. But data quality is a known live problem — there's a whole paper on
characterising the clinical relevance of digital phenotyping *data quality*,
which tells you it's a concern. Passive sensing has missingness, device
differences, and compliance issues that don't appear in the headline claims.

---

## 2. Computational personality — and its ceiling

### 2.1 The headline result

Kosinski, Stillwell & Graepel (2013) showed private traits are predictable from
Facebook Likes. Youyou, Kosinski & Stillwell (2015) went further: computer
judgments of personality from Likes were **more accurate than judgments made by
friends and family**, with only spouses coming close.

Stachl et al. (PNAS, 2020) did the mobile-sensing version, predicting Big Five
from six behaviour classes — communication and social behaviour, music, app
usage, mobility, overall phone activity, and day/night activity. **Communication
and social behaviour were the most predictive.**

> **→ In plain English.** Enough digital traces and a model can describe your
> personality better than your friends can. The most-quoted version is
> Facebook likes; the phone version found that *who you talk to and how* beats
> everything else — better than where you go or what music you play.
>
> If you're deciding which data streams matter most, that's the finding to
> take: **messages and social patterns, not browsing or location.**

**Holds up: Reasonable, with the accuracy widely overstated in popular
retellings.** See below.

### 2.2 The ceiling, which is rarely quoted

A meta-analysis of Big Five prediction from social-media footprints found
correlations from **r = 0.29 (agreeableness) to r = 0.40 (extraversion)** —
described as "in line with the standard correlational upper-limit for behavior
to predict personality."

Effect sizes rise when studies combine *multiple types* of footprint plus
demographics, which is the one genuinely encouraging finding for a multi-source
approach.

> **→ In plain English.** "Better than your friends" is true and sounds
> enormous. The actual number is a correlation around 0.3 to 0.4.
>
> That's a real signal and a weak predictor. It means the model is right
> considerably more often than chance and wrong a great deal of the time. Your
> friends are just worse than people assume.
>
> The useful part: accuracy improves when you combine *several kinds* of trace
> rather than going deep on one. Which is an argument for the multi-source
> approach you described — just not for expecting it to be decisive.

**Holds up: Solid on the numbers, Contested on the interpretation.**

### 2.3 The circularity problem — the most important criticism

> Almost all researchers seek to predict **self-report data** from digital
> footprints, risking the possibility that the ensuing computer models are also
> predicting personality from more biased assessments.

> **→ In plain English.** Here's the catch that undermines a lot of this.
>
> How do you know the model got someone's personality right? You compare it to a
> questionnaire they filled in about themselves. That questionnaire is the
> ground truth.
>
> But doc 20 §1 is entirely about how people are unreliable narrators of
> themselves. So the model isn't learning to predict who someone *is* — it's
> learning to predict **what they'd say about themselves on a form.**
>
> Those are different targets, and the difference is exactly the gap your
> product is supposed to be about. A model that perfectly predicts someone's
> self-report has perfectly reproduced their self-concept, including its
> distortions.

**Holds up: Solid as a critique.** This is acknowledged within the field, not an
outside attack. It limits what any of this can claim.

---

## 3. Lifelogging — and the critique that should shape the product

Sellen & Whittaker, **"Beyond Total Capture: A Constructive Critique of
Lifelogging"** (Communications of the ACM, 2010).

Lifelogging proponents — Gordon Bell's MyLifeBits being the flagship — argued we
should remove the memory burden from humans by offloading it to comprehensive
external stores. Sellen & Whittaker argue those claims need scrutiny, and that
system design should follow **the psychological basis of human memory** rather
than the capture-everything instinct.

> **→ In plain English.** Someone tried recording their entire life. The
> conclusion from people who studied it: **capturing everything doesn't produce
> understanding, and often produces less.**
>
> Human memory isn't a bad recording. It's selective *by design* — it keeps
> what matters and discards the rest, and that discarding is the useful part.
> An archive that keeps everything has no opinion about what mattered, so
> everything must be sifted again at retrieval time.
>
> This is the most directly relevant paper to "record all of it and
> triangulate." It's a 15-year-old warning against precisely that instinct.
>
> Which — worth saying plainly — is the argument *for* how Retrospect is
> already built. A fact bank that drops any claim without a quote, a promotion
> bar that refuses to call one instance a pattern, and a pass that just deleted
> 57 of 81 queued entries as noise, are all mechanisms for *not* being a
> lifelog. That's the right side of this debate.

**Holds up: Solid as a critique, and it aged well.** Fifteen years on, no
total-capture system has become generally useful, which is reasonable
confirmation.

---

## 4. Psychological targeting — where this gets ethically sharp

Matz, Kosinski, Nave & Stillwell, *Psychological targeting as an effective
approach to digital mass persuasion* (PNAS, 2017).

Appeals matched to someone's extraversion or openness produced up to **40% more
clicks and 50% more purchases** than mismatched or generic equivalents.

The authors say plainly that this can help people "make better decisions and
lead healthier and happier lives," and equally can be used to "covertly exploit
weaknesses in their character and persuade them to take action against their own
best interest" — their own example being targeting online casino advertising at
people with traits associated with pathological gambling. They note it falls
through the cracks of existing regulation.

> **→ In plain English.** Once you can infer what someone is like, tailoring a
> message to them works. Measurably — half again as many purchases.
>
> The researchers were explicit that the same capability helps or harms
> depending only on intent, and they gave the harmful example themselves:
> finding people predisposed to gambling addiction and showing them casino ads.
>
> This is the closest anyone has come to "infer what they want and act on it,"
> and it's the part of this literature with the worst reputation — adjacent to
> the Cambridge Analytica story.
>
> Which is the fork for your product. Same inference, opposite relationship to
> the person: **targeting uses the model on someone; reflection hands the model
> back to them.** The technique doesn't distinguish those. Only the design does.

**Holds up: Solid finding, real effect.** Replicated in the sense that
personalised advertising broadly works; the specific 40–50% figures are from one
set of field experiments.

---

## 5. What this literature does *not* have

The honest gaps, which are where the opportunity is.

**Nothing infers desires.** Everything predicts traits (stable: Big Five) or
states (transient: mood, risk). Nobody predicts *what someone wants*, and doc 20
§2 says the reason is formal, not technological.

**Nothing follows the chain to outcomes.** These studies predict a trait score
and stop. Nothing traces stated goal → behaviour → attainment → whether it
helped. That chain exists in the motivation literature (doc 20 §4), measured
with expensive panels; it does not exist in the digital-traces literature at all.
**The two fields have not been joined.**

**Nothing feeds it back.** These are inference systems built for a researcher or
advertiser. The idea that the subject is the audience — that the model's output
goes to the person it describes — is almost absent. Digital phenotyping's
clinical use comes closest, and there the output goes to a clinician.

**Everything validates against self-report.** §2.3. The field's ground truth is
the thing doc 20 says can't be trusted.

> **→ In plain English.** The field you'd want doesn't exist. What exists is:
> people who can measure you continuously, people who can guess your personality
> from your data, and people who can sell to you better once they have.
>
> Nobody has joined continuous measurement to the motivation research, and
> nobody has pointed the output at the person being measured.
>
> That's the gap. It's also a warning — if this were easy, the Kosinski lab
> would have done it in 2015. The reason they didn't is §2.3 and doc 20 §2, and
> those constraints apply to you identically.

---

## 6. What to take from it

**Messages and social behaviour are the highest-signal stream.** Stachl et al.
tested six classes and communication won. If sources have to be prioritised,
that's the empirical answer — above browsing, location and music.

**Multi-source beats deep-single-source.** The meta-analysis found effect sizes
rise when footprint types are combined with demographics. Triangulation is
supported; decisiveness is not.

**Expect r ≈ 0.3–0.4, not certainty.** That's the ceiling for behaviour
predicting disposition. Any product claim above that is overselling, and the
ceiling applies to a *much* easier problem than the one being attempted.

**Do not validate against self-report.** The circularity in §2.3 is the field's
main weakness and is avoidable here — because the product doesn't have to guess
at a questionnaire score. It can point at what someone actually wrote, which is
a better ground truth than a Likert scale about themselves.

**Total capture is the wrong instinct, and refusing it is a feature.**
Sellen & Whittaker, 2010, and the field has not disproved them since.

**The targeting fork is real and should be stated explicitly somewhere.** The
same inference serves persuasion or reflection. Matz demonstrated the first.
Nobody has properly built the second.

---

## Bibliography

### Digital phenotyping
- Torous, Kiang, Lorme & Onnela (2016). Original definition, JMIR Mental Health — [field overview](https://en.wikipedia.org/wiki/Digital_phenotyping)
- Onnela & Rauch (2016). *Harnessing Smartphone-Based Digital Phenotyping to Enhance Behavioral and Mental Health*, Neuropsychopharmacology — [Nature](https://www.nature.com/articles/npp20167)
- Torous et al. (2017). *New dimensions and new tools to realize the potential of RDoC: digital phenotyping via smartphones and connected devices*, Translational Psychiatry — [Nature](https://www.nature.com/articles/tp201725)
- *Characterizing the clinical relevance of digital phenotyping data quality*, npj Digital Medicine — [Nature](https://www.nature.com/articles/s41746-018-0022-8)
- *Issues and opportunities of digital phenotyping: EMA and behavioral sensing*, Frontiers in Psychology (2023) — [Frontiers](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1103703/full)

### Computational personality from digital footprints
- Kosinski, Stillwell & Graepel (2013). *Private traits and attributes are predictable from digital records of human behavior*, PNAS — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3625324/)
- Youyou, Kosinski & Stillwell (2015). *Computer-based personality judgments are more accurate than those made by humans*, PNAS — [Stanford summary](https://news.stanford.edu/stories/2015/01/personality-computer-knows-011215)
- Stachl et al. (2020). *Predicting personality from patterns of behavior collected with smartphones*, PNAS — [PNAS](https://www.pnas.org/doi/10.1073/pnas.1920484117) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/32665436/)
- Azucar, Marengo & Settanni (2018). *Predicting the Big 5 personality traits from digital footprints on social media: a meta-analysis* — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0191886917307328) · [PDF](https://www.cs.columbia.edu/~julia/papers/azucaretal2017.pdf)
- Hinds & Joinson (2019). *Human and Computer Personality Prediction From Digital Footprints*, Current Directions in Psychological Science — [SAGE](https://journals.sagepub.com/doi/full/10.1177/0963721419827849)

### Lifelogging and its critique
- Sellen & Whittaker (2010). *Beyond Total Capture: A Constructive Critique of Lifelogging*, CACM 53(5) — [ACM](https://dl.acm.org/doi/10.1145/1735223.1735243) · [PDF, Stanford](https://hci.stanford.edu/courses/cs247/2011/readings/sellen.pdf) · [Microsoft Research](https://www.microsoft.com/en-us/research/publication/beyond-total-capture-a-constructive-critique-of-lifelogging/)

### Psychological targeting
- Matz, Kosinski, Nave & Stillwell (2017). *Psychological targeting as an effective approach to digital mass persuasion*, PNAS — [PNAS](https://www.pnas.org/doi/10.1073/pnas.1710966114) · [PDF, Columbia](https://business.columbia.edu/sites/default/files-efs/pubfiles/25553/Matz_Psychological%20Targeting.pdf) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/29133409/)
