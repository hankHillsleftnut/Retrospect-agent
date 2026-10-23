# 25 — Making AI write well: tools, metrics and research

Survey of what exists for getting good prose out of a model — open-source tools,
measurable benchmarks, and the research. Motivated by the fact that for this
product, **the script is the deliverable.** Everything upstream exists to make
one piece of writing land.

---

## The shape of the field

Three distinct layers, at very different maturity:

| layer | maturity | what's available |
|---|---|---|
| **Deterministic linting** | **shippable today** | npm packages, no model calls, JSON output |
| **Benchmarks and scores** | usable | published formulas, live leaderboards |
| **Style control research** | active, early | style vectors, neuron steering, LoRA-as-intervention |

The first layer is the surprise: there are maintained, zero-dependency linters
that catch the tells deterministically, and they can go into a pipeline this
week.

---

## 1. The slop taxonomy — what is actually wrong

A document circulating as `LLM_PROSE_TELLS.md` catalogues ~30 named patterns
with a rule for each. Condensed, because this is effectively a ready-made lint
spec:

### Sentence structure
- **Em-dash pivot** — "not X—but Y". *Rewrite as separate clauses.*
- **Em-dash overuse** — dashes substituting for commas, colons, periods.
- **Colon elaboration** — short clause, colon, longer explanation.
- **Triple construction** — three parallel items, always exactly three.
- **Staccato burst** — several very short sentences at identical cadence.
- **Uniform paragraph length** — every paragraph 3–5 sentences.
- **Dramatic fragment** — a fragment standing alone as a paragraph.
- **Pivot paragraph** — one-sentence transition carrying no information.
- **Question-then-answer** — rhetorical question immediately answered.
- **Unnecessary contrast** — a contrast that restates the main clause.

### Word choice
- **Overused intensifiers** — crucial, vital, robust, leverage, navigate.
- **Elevated register drift** — utilize/use, commence/start, facilitate/help.
- **Filler adverbs** — importantly, essentially, ultimately, particularly.
- **"Almost" hedge** — almost always, almost certainly.

### Rhetoric
- **The balanced take** — every argument followed by its concession.
- **Throat-clearing opener** — a first paragraph with no information.
- **False conclusion** — "at the end of the day", "moving forward".
- **Hedge stack** — several qualifiers in one sentence saying nothing.
- **Empathy performance** — "deeply challenging", "your feelings are valid".

### Structure and framing
- **Symmetrical sections** — every section the same length.
- **Connector addiction** — every paragraph opening with a transition word.
- **Absence of mess** — no contradictions, tangents, or unfinished thoughts.
- **"Broader implications"** — zooming out to claim significance unearned.
- **Metaphor crutch** — double-edged sword, tip of the iceberg.

> **The one to sit with is "absence of mess."** Every other item is something to
> remove. That one is something missing — and it is the hardest to fix by
> filtering, because you cannot subtract your way to texture.

### The mechanistic explanation

*The Last Fingerprint: How Markdown Training Shapes LLM Prose*
([arXiv 2603.27006](https://arxiv.org/html/2603.27006v1)) argues the em dash is
**markdown leaking into prose** — the smallest surviving unit of the structural
orientation models absorb from markdown-saturated training data. It occupies a
dual position: valid prose punctuation *and* a structural marker.

The supporting evidence is striking: **Llama models produce zero em dashes
across tens of thousands of words**, while OpenAI and Anthropic models show
elevated rates. It is a training-corpus artefact, not a stylistic choice.

And the sharpest framing of the whole problem, from a rhetorical analysis:

> The problem is not that LLMs use these techniques. It's that they're so
> robotically consistent in how they use them that it becomes an abuse. What the
> LLM lacks is **the taste to know when to deploy these techniques.**

---

## 2. Tools that work today

### `slopless` — the standout

[berelevant-ai/slopless](https://github.com/berelevant-ai/slopless) · 325★ ·
TypeScript · actively maintained (updated two days ago)

> Deterministic textlint rules and CLI for catching prose slop in English
> Markdown. **No model calls, no API key.**

Named rules include `boilerplate-framing`, `prohibited-phrases`,
`negation-reframe`, `universalizing-claims`, `cliches`. Their own example, six
findings in four sentences:

```
[slopless/boilerplate-framing]    let me be honest
[slopless/prohibited-phrases]     in a world where
[slopless/negation-reframe]       We do not sell software. We sell outcomes.
[slopless/universalizing-claims]  everyone knows
[slopless/cliches]                at the end of the day
[slopless/prohibited-phrases]     the future belongs to
```

`npm install -D slopless`, JSON by default, and it ships agent skills for Claude
Code and Codex so a writing agent can loop: generate → lint → rewrite → rerun
until clean.

> **Note `universalizing-claims`.** "Everyone knows" is the *same rule* as doc
> 24 §4's attribution finding and migration 115's authorship work — promoting a
> particular to a general without corroboration. Three unrelated systems have
> now independently arrived at it. That is not a stylistic preference; it is a
> truth-preservation constraint that happens to also read badly.

### Others worth knowing

| repo | ★ | what |
|---|---|---|
| [hexiecs/talk-normal](https://github.com/hexiecs/talk-normal) | 1852 | system prompt that removes AI slop — the prompt-side approach |
| [seyedehsanhadi/sloptrim](https://github.com/seyedehsanhadi/sloptrim) | 209 | Python; scores every prose file an agent saves |
| [eric-tramel/slop-guard](https://github.com/eric-tramel/slop-guard) | 164 | slop scoring |
| [lechmazur/writing](https://github.com/lechmazur/writing) | 447 | benchmark: can a model weave 10 mandatory story elements into a short story |
| [lechmazur/writing_styles](https://github.com/lechmazur/writing_styles) | 27 | the style side of the same benchmark |
| [Trystan-SA/claude-design-system-prompt](https://github.com/Trystan-SA/claude-design-system-prompt) | 1959 | reverse-engineered system prompt for opinionated output |

---

## 3. The measurable version — EQ-Bench's Slop Score

[eqbench.com/slop-score.html](https://eqbench.com/slop-score.html) publishes a
weighted composite, which is the most directly implementable metric found:

| weight | component |
|---|---|
| **60%** | **slop words** — individual words appearing unnaturally often in LLM output |
| **25%** | **not-x-but-y patterns** — "not just X, but Y" contrast constructions |
| **15%** | **slop trigrams** — three-word phrases over-represented in model output |

The master slop list is derived empirically from over-represented words and
phrases across many models' outputs — not hand-written taste.

EQ-Bench also runs a [Creative Writing v3
leaderboard](https://eqbench.com/creative_writing.html) using an LLM judge
against rubrics covering character authenticity, originality, coherence of plot
and character choice, and metaphor — with a manual slider to weight slop.

Also: [LitBench](https://aclanthology.org/2026.eacl-long.362.pdf) (EACL 2026),
a benchmark and dataset for reliable creative-writing evaluation.

---

## 4. Research findings that matter here

### Consistency degrades in the middle

*Lost in Stories: Consistency Bugs in Long Story Generation*
([arXiv 2603.05890](https://arxiv.org/abs/2603.05890)). Models generating long
narratives contradict their own established facts, character traits and world
rules. The useful specifics:

> Consistency errors are most common in **factual and temporal** dimensions, and
> tend to appear **around the middle of narratives.**

Directly applicable: a twenty-minute episode is long-form, its failures will be
factual and temporal, and they will cluster in the middle rather than at the
seams. That is where a guard should look hardest.

### Lexical metrics don't work

> Metrics based on lexical matching correlate poorly with human judgments and do
> not effectively measure story quality.

LLM-as-judge across named dimensions is the current standard. Worth knowing
before building any BLEU-style quality score.

### Style control is an active research area

- **Style vectors** ([arXiv 2402.01618](https://arxiv.org/pdf/2402.01618)) —
  steering generation toward a style without fine-tuning.
- **sNeuron-TST** ([EMNLP 2024](https://aclanthology.org/2024.emnlp-main.745/))
  — identify style-specific neurons, deactivate source-style-only ones.
- **Causal-Steer** — LoRA reframed as a causal intervention to extract style
  vectors from non-parallel data, giving smooth bidirectional control.
- **Stylometric limits** ([DSH, Oxford](https://academic.oup.com/dsh/article/40/2/587/8118784))
  — fine-tuning on an author's corpus imitates vocabulary and syntax accurately,
  but struggles with "innovation, deep causal reasoning, and authentic authorial
  voice."

> The honest read: surface style is controllable now; **voice is not.**

---

## 5. What this means for Retrospect

### The transcript guard already exists and is unwired

`src/brain/transcript-guard.ts` is written, tested, merged — and the podcast
pipeline never calls it. The canvas marks it `notInstrumented` with the caveat
*"Nothing currently checks a script before it is voiced."*

This research is what it should check. Three tiers, in order of cost:

1. **Deterministic lint** — `slopless` or equivalent, zero model calls. Catches
   negation-reframe, universalizing claims, boilerplate framing, clichés.
2. **Slop score** — the 60/25/15 composite, computable locally against a word
   list, trended per episode.
3. **Structural checks** — middle-of-narrative factual and temporal consistency,
   since that is where the research says it breaks.

### The insight that reframes the whole problem

Every tool above is built for **generic** writing — blog posts, marketing, essays
by people with nothing particular to say. Their remedy is subtraction: strip the
tells, delete the hedges, ban the clichés.

**Slop is what a model produces when it has nothing specific to say.** The
filler is load-bearing; remove it and there is a hole.

Retrospect is the rare case with the opposite problem. It has a supply of
specifics nobody else has: span-verified quotes from one person's actual life,
with dates, names and character offsets. Every fact in the bank is an
anti-slop token.

> The strongest anti-slop mechanism here is not a filter. It is the **existing
> rule that every claim must carry a quote.** Prose built from verified specifics
> cannot easily drift into "in a world where" — there is always something truer
> and more particular available.

Which suggests the guard should check something the generic tools do not:
**specificity density.** How much of this script is quoted or citable material
versus connective tissue? A script that has drifted into slop is a script that
has drifted away from its evidence, and that is measurable from data already
held.

### And the one thing subtraction cannot fix

"Absence of mess" — no contradictions, no tangents, no unfinished thoughts.
Every other tell is removable. That one has to be *added*, and the literature has
no method for it.

Retrospect has an unusual answer available. Doc 20 §3.3 and §3.5 are about
competing commitments and counterfinality — **genuine contradictions in the
person's own material.** The mess does not have to be invented. It is in the
data, and surfacing it honestly is both the psychologically correct move and the
thing that makes the writing read as human.

---

## Sources

**Tools**
- [berelevant-ai/slopless](https://github.com/berelevant-ai/slopless) — deterministic prose linter
- [hexiecs/talk-normal](https://github.com/hexiecs/talk-normal) — anti-slop system prompt
- [seyedehsanhadi/sloptrim](https://github.com/seyedehsanhadi/sloptrim) · [eric-tramel/slop-guard](https://github.com/eric-tramel/slop-guard)
- [lechmazur/writing](https://github.com/lechmazur/writing) · [lechmazur/writing_styles](https://github.com/lechmazur/writing_styles)
- [LLM_PROSE_TELLS.md](https://git.eeqj.de/sneak/prompts/src/branch/main/prompts/LLM_PROSE_TELLS.md)

**Benchmarks and metrics**
- [EQ-Bench Slop Score](https://eqbench.com/slop-score.html) · [Creative Writing v3](https://eqbench.com/creative_writing.html) · [Longform](https://eqbench.com/creative_writing_longform.html)
- [LitBench: A Benchmark and Dataset for Reliable Creative Writing Evaluation](https://aclanthology.org/2026.eacl-long.362.pdf), EACL 2026

**Research**
- [The Last Fingerprint: How Markdown Training Shapes LLM Prose](https://arxiv.org/html/2603.27006v1)
- [Lost in Stories: Consistency Bugs in Long Story Generation by LLMs](https://arxiv.org/abs/2603.05890)
- [A Survey on LLMs for Story Generation](https://aclanthology.org/2025.findings-emnlp.750.pdf), EMNLP 2025 Findings
- [Agents' Room: Narrative Generation through Multi-step Collaboration](https://arxiv.org/pdf/2410.02603)
- [Style over Story: Measuring LLM Narrative Preferences](https://arxiv.org/pdf/2510.02025)
- [Do Language Models Enjoy Their Own Stories? Prompting LLMs for Automatic Story Evaluation](https://arxiv.org/pdf/2405.13769)
- [Style Vectors for Steering Generative LLMs](https://arxiv.org/pdf/2402.01618)
- [Style-Specific Neurons for Steering LLMs in Text Style Transfer](https://aclanthology.org/2024.emnlp-main.745/), EMNLP 2024
- [Beyond the surface: stylometric analysis of GPT-4o's capacity for literary style imitation](https://academic.oup.com/dsh/article/40/2/587/8118784), DSH
- [Why ChatGPT writes like that](https://www.deadlanguagesociety.com/p/rhetorical-analysis-ai) — rhetorical analysis
- [LLM Style Slop is Absolutely Everywhere](https://www.lesswrong.com/posts/yBM2rQ6AJY6MoRGFQ/llm-style-slop-is-absolutely-everywhere)
