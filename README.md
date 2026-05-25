# retrospect-agent

Agent-based ingestion and weekly podcast generation for Retrospect.

A clean rebuild of the data → observation → insight → podcast pipeline, replacing the rigid 3-pass LLM chain in the original Retrospect backend with **one tool-using agent** wrapped by two plain LLM calls (one for outlining the present, one for writing the final transcript).

Sibling project to [Retrospect](../Retrospect). Shares the same Supabase database via additive migrations.

## What's in here

Two systems:

1. **Daily ingestion** — every 24h, a single LLM call turns new raw content (voice notes, screen time, docs, health) into observations + insights, and optionally flags new goal candidates.
2. **Weekly podcast** — three "cooks" produce the episode:
   - **Cook A** writes an outline of this week from goals + recent insights/observations.
   - **Cook B** is an agent with 5 tools (`search_insights`, `search_observations`, `search_previous_podcasts`, `search_raw_content`, `internet_research`) that enriches Cook A's outline with the user's longer history.
   - **Cook C** writes the final script in the user's preferred tone with ElevenLabs v3 audio tags.

Every step writes intermediate output to a `pipeline_run_traces` row that you can inspect in the local `/runs` dashboard.

Full diagram: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Getting started

```bash
cd ~/Projects/retrospect-agent
npm install
npm run setup           # generates .env by copying values from ../Retrospect/backend/.env
```

Apply the migrations (in the existing Retrospect Supabase project, SQL editor):

1. `supabase/migrations/100_agent_extensions.sql`
2. `supabase/migrations/101_pipeline_run_traces.sql`

Verify everything is wired up:

```bash
npm run doctor
# Walks through every env var, supabase table/column/RPC, openai auth, storage bucket.
# Prints exact fix instructions for any failure.
```

Once `doctor` passes, you're done with setup. Run the pipeline end-to-end:

```bash
npm run seed:demo
# Output ends with the demo user id — save it.

npm run ingest -- --user <demo-id>
npm run podcast -- --user <demo-id> --skip-tts

# Start the server and inspect:
npm run dev
open http://localhost:3001/runs
```

## CLI

| Command | Purpose |
|---|---|
| `npm run setup` | Generate `.env` by copying values from Retrospect's backend. |
| `npm run doctor` | Diagnose env, supabase schema, RPCs, storage, openai auth. |
| `npm run backfill -- --user <id>` | Embed historical `raw_content` / `podcast_episodes.summary` rows. |
| `npm run seed:demo` | Create demo user with fixture data. Use `--reset` to wipe and re-seed. |
| `npm run ingest -- --user <id> [--days N] [--dry-run]` | System A. |
| `npm run podcast -- --user <id> [--days N] [--skip-tts] [--dry-run] [--persona ...]` | Full System B. |
| `npm run cookA -- --user <id> [--days N]` | Just Cook A → writes `outlineV1.json` to `scripts/outputs/`. |
| `npm run cookB -- --user <id> --outline <path>` | Just Cook B (agent) on a saved outline. |
| `npm run cookC -- --user <id> --outline <path>` | Just Cook C on a saved enriched outline. |
| `npm run replay -- --run <trace-id> [--skip-tts]` | Re-run a past trace with current prompts. |
| `npm run scenarios [-- --keep]` | Run all fixtures in `tests/scenarios/` and dump scripts side-by-side. |
| `npm run dev` | Start Express + cron + `/runs` dashboard on port 3001. |
| `npm run typecheck` | `tsc --noEmit`. |

## HTTP API

| Method | Path | What |
|---|---|---|
| `GET` | `/health` | Liveness + db check |
| `POST` | `/ingest/run` | Body: `{ userId, daysBack?, rawContentIds?, dryRun? }` |
| `POST` | `/podcasts/generate` | Body: `{ userId, daysBack?, skipTTS?, dryRun?, persona? }` |
| `GET` | `/podcasts/:userId` | List recent episodes |
| `GET/PUT` | `/preferences/:userId` | Read or upsert user preferences |
| `POST` | `/feedback/episodes/:episodeId` | Post-episode feedback |
| `GET` | `/runs` | HTML dashboard / `?json=1` for JSON list |
| `GET` | `/runs/:id` | HTML detail / `?json=1` for one trace |
| `GET` | `/runs/:a/compare/:b?json=1` | Compare two traces |

## Why this design

The 3-pass chain in the original Retrospect backend was rigid: outline → research → script with every step receiving only what the previous step produced. The agent in the middle of this project decides which tools to use, how often, with what date ranges — so the same architecture can do "find a 3-month pattern", "avoid topics from last week's episode", and "look up a citation" without bolting on three more LLM calls.

The two outer plain calls (Cook A and Cook C) stay non-agentic on purpose: Cook A's job is bounded, and Cook C's job is HOW (tone, voice, pacing) not WHAT.

## Tracing & testability

Every run — whether from cron, CLI, or HTTP — writes a `pipeline_run_traces` row with:

- `inputs_snapshot` — the exact ids that went in (lets `replay` be deterministic)
- `outline_v1` — Cook A output
- `agent_tool_calls` — every tool call Cook B made, in order, with inputs and outputs
- `outline_v2` — Cook B output
- `final_script` — Cook C output
- `audio_url` (if not `--skip-tts`)
- `episode_summary` — the 2-paragraph summary written back for next week's Cook B
- `cost_breakdown` — tokens, perplexity calls, eleven labs chars, est usd

You can open `/runs/<id>` in a browser and see all of it.

## Layout

```
src/
  agents/              # ingestion-agent (1 LLM call) + podcast-agent (tool loop)
    tools/             # 5 agent tools
  pipelines/           # ingest.ts, podcast.ts, trace.ts
  prompts/             # one prompt per file
  routes/              # express handlers
  services/            # openai, perplexity, elevenlabs, embeddings
  db/                  # supabase client + table names
  jobs/                # daily-ingestion, weekly-podcast
  public/              # /runs dashboard HTML
scripts/               # CLIs (cookA, cookB, cookC, ingest, podcast, replay, seed-demo, scenarios)
tests/
  fixtures/            # demo-user data
  scenarios/           # regression fixtures
supabase/migrations/   # 100_agent_extensions.sql, 101_pipeline_run_traces.sql
```
