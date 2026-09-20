# Second brain — briefing for engineers

**Audience:** a junior developer who has not lived in this conversation, these two repos, or the product history. Read this folder before you write code.

**Purpose:** Retrospect today can store a person’s life as text and sometimes turn a slice of it into a podcast outline. The founder’s goal is different: a **robust second brain** that (1) ingests everything reliably, (2) is easy to read and search, (3) infers **patterns** only after behavior repeats, (4) uses that bank to write a good story about the person. This folder is the decision record for how we get from here to there.

**If you only remember five sentences**

1. The brain is a **fact-first retrieval bank**. Another system (the podcast cooks) writes the narrative. The brain must stay the easiest thing that storyteller can query.
2. **Facts** are born on ingest if a source span supports them. **Patterns** are a separate object and are born only after repetition (faster if severe). **Why** is inferred only after a Pattern exists, and is never mixed into facts.
3. Do **not** install Graphiti, Letta, LangExtract, or gbrain as running products. Copy their **contracts** into the TypeScript agent and Postgres we already have.
4. Do **not** start by rewriting Cook B’s search tools. Those tools have nothing honest to retrieve until journal ingest writes the graph.
5. The first implementation slice is: **journal ingest → graph facts with spans + idempotent completion + embed `raw_content`.**

---

## How to read this folder

Read in order. Each file assumes you read the one before it.

| File | What it is |
|------|------------|
| [00-README.md](./00-README.md) | This page. Glossary, repos, map of the world. |
| [01-locked-product-behavior.md](./01-locked-product-behavior.md) | What the founder said the brain must do. Locked decisions. Not negotiable without asking. |
| [02-current-system.md](./02-current-system.md) | How the product actually works today, with file paths. What is broken vs merely empty. |
| [03-research-and-comparables.md](./03-research-and-comparables.md) | Products and papers we researched that match (or fail to match) the desired behavior. |
| [04-target-architecture.md](./04-target-architecture.md) | The system we are building: objects, pipeline, typed pulls, story agent. |
| [05-decisions-and-non-goals.md](./05-decisions-and-non-goals.md) | Adopt vs replicate. Explicit do-nots. Why we are not installing the three libraries. |
| [06-implementation-plan.md](./06-implementation-plan.md) | Phases, effort, first tickets, definition of done. |
| [07-sota-capability-map.md](./07-sota-capability-map.md) | Earlier 16-area research audit: scores, what we would implement, what later product locks overrode. |
| [08-day-0-handoff.md](./08-day-0-handoff.md) | Clone, env, ports, which DB, first curl, who to ask. **Read this before you try to run anything.** |

Existing older docs (still useful for tables and HTTP routes, **out of date** on the agent path):

- [`../retrospect-data-model-and-pipeline.md`](../retrospect-data-model-and-pipeline.md) — describes the 15-table model and claims `POST /content` still runs legacy extraction. **Wrong now.** Content upload calls the agent.
- [`../retrospect-full-stack-architecture.md`](../retrospect-full-stack-architecture.md) — iOS ↔ Render ↔ Supabase map. Useful topology, stale pipeline detail.

---

## What Retrospect is (one paragraph)

Retrospect is a personal iOS app. A user journals, connects data (Health, calendar, docs, etc.), and the product is supposed to understand them well enough to produce a weekly podcast that feels like it *knows* them — not a generic pep talk. The public API is `retrospect-api` (this repo, `backend/`). The thinking layer is a sibling service, `retrospect-agent`. Both share one Supabase Postgres database. The iOS app never talks to the agent directly.

---

## Two repositories

| Repo | GitHub | Job |
|------|--------|-----|
| **retrospect-main** (this repo; remote is also called `NPRdoinglaundry`) | [hankHillsleftnut/NPRdoinglaundry](https://github.com/hankHillsleftnut/NPRdoinglaundry) | Auth, `POST /content`, goals, podcasts trigger, integrations edge, iOS |
| **retrospect-agent** | [hankHillsleftnut/Retrospect-agent](https://github.com/hankHillsleftnut/Retrospect-agent) | Ingest, Cook 0, graph-v2, Cooks A/B/C, podcast generation |

Clone them as **siblings**. How to boot, env, and first curl: [08-day-0-handoff.md](./08-day-0-handoff.md). Do not use another engineer’s laptop path.

The API calls the agent with `X-Internal-Secret` via `backend/src/services/agent-client.ts`:

- `POST /ingest/run`
- `POST /podcasts/generate`
- `/integrations/*`

If you change “how memory works,” you will almost always edit **retrospect-agent**. If you change “how the phone uploads or plays,” you edit **retrospect-main**.

The agent GitHub page may show an older push than the laptop copy. As of this briefing the local agent `main` was at `277f7f8` (2026-08-08).

---

## Glossary

Read this twice. These words are overloaded in the codebase.

| Term | Means here | Does **not** mean |
|------|------------|-------------------|
| **Second brain** | A durable, queryable model of one person’s life: facts, patterns, current portrait, significant people | A notes app, a chatbot with a long context window, or the podcast itself |
| **Fact** | A structured claim with a source span: who/what/when, still true?, pointer to `raw_content` | A vibe, a personality label, a Cook B outline bullet |
| **Observation** | Today: a row in `observations`, usually tied to a goal, written by the ingestion LLM | Tomorrow: may become a *view* of facts. Do not treat current observations as the brain. |
| **Insight** | Today: a synthesized cluster of observations (`insights` table) | A Pattern. Insights are episode-adjacent conclusions and are not the pattern store. |
| **Pattern** | A **new** first-class object: a repeated behavior, promoted only after a bar is hit | A sentence Cook B invented in `notRealizedYet` and then discarded |
| **Why** | An inferred mechanism attached **only** to a Pattern, labeled inferred | A `reason_why` column on an observation (that field is “why this relates to a goal,” not a psychological why) |
| **Portrait** | The short, current, always-readable model of the person (today: `user_understanding` document; target: named blocks) | The entire history |
| **Cook 0** | Agent that rewrites the user-understanding document after ingest | A search agent |
| **Cook A** | Writes this week’s outline from a **dump** of recent rows + the portrait | A retrieval agent |
| **Cook B** | The **only** tool-using cook. Cosine-searches history and invents historical connections / unrealized patterns | The pattern promoter. It must not remain the place patterns are born. |
| **Cook C** | Writes the episode transcript from the outline | The brain |
| **UUD** | User Understanding Document — JSON in `user_understanding.document` | A knowledge graph |
| **graph-v2** | `retrospect-agent/src/pipelines/graph-v2.ts` — writes `entities` / `assertions` / evidence | Currently wired from **integrations**, not from journal ingest |
| **Typed pull** | A named query: `live_patterns`, `facts_for(pattern_id)`, `changed_since(...)` | Embedding a sentence and hoping |
| **Supersession** | A newer fact retires an older one (`valid_to` + relation). “Quit marathon” beats “training for marathon” | Deleting the old row, or hoping similarity notices the contradiction |
| **Span / source grounding** | Character offsets (or an excerpt that can be checked) in the exact `raw_content` row | “This observation is generally about that journal” |
| **Significance** | How much a person in the user’s life matters: recency × interactions × intensity | A full biography of that person (gbrain-style) |
| **IVFFlat / 3072** | pgvector index type vs OpenAI `text-embedding-3-large` dimensions. IVFFlat maxes out at **2000** dims. Several indexes **cannot exist**. | A working vector index |

---

## Picture of the world (current vs target)

```
CURRENT
  phone → POST /content → raw_content
                         → fire-and-forget /ingest/run
                         → LLM writes observations / insights / identity_inferences
                         → Cook 0 rewrites UUD from that pile
  later: Cook A reads last 14 days (dump)
         Cook B embeds a query, cosine-searches, invents patterns in the outline
         Cook C writes audio from the outline
         patterns die with the episode

TARGET
  phone → POST /content → raw_content (immutable, receipt, lease)
                         → extract facts WITH spans (drop if unsupported)
                         → graph-v2: entities, assertions, supersession
                         → embed sources
                         → pattern promoter (after repetition; faster if severe)
                         → why only on patterns
                         → Cook 0 patches portrait BLOCKS from live graph
  later: Cook A reads portrait + this week + live patterns
         Cook B asks typed questions of the bank → evidence pack + gaps
         Cook C writes audio ONLY from the pack
         patterns live in the database and can be searched next week
```

---

## Locked product decisions (preview)

Full text is in [01-locked-product-behavior.md](./01-locked-product-behavior.md). Do not “simplify” these in a PR.

- Capabilities required: facts, patterns, why, current state, goals vs actual pursuit, impediments, self-talk, change over time, close people as part of the user’s life.
- **Not** required (founder did not select it): predicting what they will do next week.
- Patterns are their **own section**. They appear after the same behavior shows a few times. Severe things promote faster.
- Why is inferred **only after a Pattern exists**.
- Voice of the brain: **heavily fact-based**, easiest bank for another system to retrieve. The narrative layer is a consumer.
- Scope: evaluate the user and their life. Other people exist because they shape the user, with a **significance** score — not a world-model of everyone.
- Use: a living portrait that updates on ingest, **and** direct search. Episodes pull from the same bank.
- Retrieval for audio: an agent that asks many questions and retrieves a lot, then turns that into audio. We specify typed pulls as the default.

---

## What you are not being asked to do

- Replace the iOS app.
- Migrate off ElevenLabs or rewrite TTS.
- Install gbrain / Graphiti / Letta / LangExtract as production dependencies (unless a spike, approved in writing, proves a library call is cheaper than our write path — default answer is no).
- Infer a personality from onboarding alone.
- Let Cook B keep inventing `notRealizedYet` types after the pattern table exists.

---

## If you get lost

1. Find the object: is this a **fact**, a **pattern**, a **why**, or **story**? They have different birth rules.
2. Find the write path: journals go through ingest in the **agent**. Integrations already have `materializeGraphV2`. Journals do not, yet.
3. Find the read path: Cook A dumps; Cook B cosines. Target is typed pulls.
4. Ask before collapsing Pattern into Insight or Why into `observations.reason_why`. Those are different types.
5. Cannot boot the stack? [08-day-0-handoff.md](./08-day-0-handoff.md).

## How this conversation got here (so the folder is not mysterious)

The founder did not start with “write a handbook.” The sequence was:

1. **Product audit** across 16 capability areas (ingest, graph, retrieval, goals, writing, voice, …).
2. **2026 SOTA mapping** for each area, with evidence/fit/overall confidence, then a list of what was actually worth implementing (mostly bug fixes; only supersession + span-verify as research).
3. **gbrain** and then **Graphiti / Letta / LangExtract** as candidate “existing brains.”
4. **Founder Q&A** that locked: facts vs patterns vs why, portrait + search, people-with-significance, brain as a bank for a story agent, no next-week prediction.
5. **Current retrieval** inspected (Cook A dump, Cook B cosine, empty graph).
6. **Decision:** copy contracts into the existing TS agent + Postgres; first slice is journal → graph facts.
7. **This folder** so a junior can execute without the chat.

Portable copy of step 2: [07-sota-capability-map.md](./07-sota-capability-map.md). Step 3: [03](./03-research-and-comparables.md). Step 4: [01](./01-locked-product-behavior.md).

Then continue with [01-locked-product-behavior.md](./01-locked-product-behavior.md).
