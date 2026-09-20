# Day 0 — how to run this and who to ask

Read [00-README.md](./00-README.md) first. This file is the **operational** half of the handoff: clone, env, a first journal, how to prove ingest hit the agent, which database you may touch, and what to do when you are stuck.

If 00–07 and this file disagree on **product**, 00–07 win. If they disagree on **how to boot the laptop**, this file wins — and then you update the stale README that misled you.

---

## What you are being handed

| You get | You do not get (ask) |
|---------|----------------------|
| This folder as the spec | Production Supabase keys (unless the founder says so) |
| Two private GitHub repos | iOS signing / App Store |
| A first-week ticket list in [06](./06-implementation-plan.md) | Permission to write Facts onto the founder’s live account |
| A demo-user seeder in the agent | A Slack runbook (there isn’t one in-repo) |

**Owner of product locks:** the founder. Reopen [01](./01-locked-product-behavior.md) or D1–D13 in [05](./05-decisions-and-non-goals.md) only with them.

**Owner of code review for this project:** ask the founder who reviews PRs. Default: they do.

**This briefing may be uncommitted** when you receive it. Ask which branch to cut from. Do **not** mix second-brain work with unrelated WIP that may already be in the tree (paywall, onboarding, speech proxy, etc.).

---

## Access you must have before coding

Ask for all of these on day 0. Do not start phase 1 against a guessed database.

1. **GitHub access** to both private repos (below).
2. **A non-production Supabase** (staging project, or a throwaway project you create). Service role key. You will run ingest and possibly `seed:demo` against it.
3. **API keys for local agent work:** `OPENAI_API_KEY` (embeddings), `ANTHROPIC_API_KEY` (ingest / cooks — the agent uses Claude). `PERPLEXITY_API_KEY` and `ELEVENLABS_API_KEY` are **not** required for Fact-write tickets.
4. **The shared `INTERNAL_API_SECRET`** if you will run API → agent on your machine (or generate one and put the **same** value in both `.env` files).
5. Confirmation: **do not** point local `SUPABASE_*` at production unless the founder writes that down.

If any of 1–2 are missing, stop and ask. You cannot do phase 0 measure without a database.

---

## The two repositories (clone these, not a laptop path)

| Role | GitHub | Default local folder name |
|------|--------|---------------------------|
| iOS + public API (`backend/`) | [hankHillsleftnut/NPRdoinglaundry](https://github.com/hankHillsleftnut/NPRdoinglaundry) | `retrospect-main` (or the clone name you prefer) |
| Agent (ingest, graph-v2, cooks) | [hankHillsleftnut/Retrospect-agent](https://github.com/hankHillsleftnut/Retrospect-agent) | `retrospect-agent` **as a sibling** |

As of this briefing:

- API repo default remote is `NPRdoinglaundry`. People also call it retrospect-main. Same repo.
- Agent `origin/main` was at `277f7f8` (`feat(integrations): connector fleet, durable job queue and graph v2`). **Re-check `git log -1` after clone.** The GitHub page can lag a laptop copy.

Recommended layout:

```
~/Projects/
  retrospect-main/      # this briefing lives in docs/second-brain/
  retrospect-agent/     # almost all Fact/Pattern code
```

You need **Node 18+**. You do **not** need Xcode for phase 1.

---

## Stale READMEs (read this or you will “fix” the wrong product)

| File | What is wrong |
|------|----------------|
| `retrospect-agent/README.md` | Describes Cook B as **5 tools** and the agent as a clean rebuild that *replaced* a 3-pass chain. Today there are **7** tools; the 3 cooks still exist; journal ingest does **not** write graph-v2. Layout section omits `graph-v2.ts`. |
| `retrospect-main/backend/README.md` | Describes GPT-4 insight extraction, `text-embedding-3-small`, and legacy insight_units/pattern crons. Current upload path is **agent ingest**; embeddings are **`text-embedding-3-large` 3072-d**. Cron scripts in `package.json` are no-ops that print “agent owns this.” |
| Agent `npm run setup` | Looks for `../Retrospect/backend/.env`. A clone named `retrospect-main` or `NPRdoinglaundry` **will not be found**. Copy `.env.example` yourself. |
| `docs/retrospect-data-model-and-pipeline.md` | Claims `POST /content` still runs legacy extraction. **False.** |

This folder is the spec. Those READMEs are boot hints plus landmines.

---

## Environment variables (the ones that matter for the brain)

Do not commit `.env`. Do not paste secrets into PRs or chat.

### Both services (must match)

| Variable | Why |
|----------|-----|
| `SUPABASE_URL` | Shared Postgres. **Same project** on API and agent. |
| `SUPABASE_SERVICE_KEY` | Service role. Bypasses RLS. Treat as prod-equivalent power. |
| `SUPABASE_ANON_KEY` | Listed in examples; service key is what ingest uses. |
| `INTERNAL_API_SECRET` | **Same string in both files.** API sends it as `X-Internal-Secret`. Agent rejects ingest without it. `npm run setup` on the agent **does not copy this key.** |
| `OPENAI_API_KEY` | Embeddings (`text-embedding-3-large`). |
| `ANTHROPIC_API_KEY` | Ingestion / Cooks. |

### API only (`retrospect-main/backend/.env`)

Copy from `backend/.env.example`.

| Variable | Local value |
|----------|-------------|
| `PORT` | `3000` |
| `NODE_ENV` | `development` (required for `POST /auth/dev/test-user`) |
| `AGENT_SERVICE_URL` | **`http://localhost:3001`** — the example’s `http://retrospect-agent:3001` is for Compose/Render, not your laptop |
| `JWT_SECRET` | Any long random string locally |
| `APPLE_*` | Not needed if you use the dev test-user route |
| Integration OAuth keys | Not needed for journal → Facts |

### Agent only (`retrospect-agent/.env`)

Copy from `retrospect-agent/.env.example`.

| Variable | Local value |
|----------|-------------|
| `PORT` | `3001` |
| `NODE_ENV` | `development` |
| `ENABLE_INTEGRATION_RUNTIME` | `false` |
| `ENABLE_INTEGRATION_WORKER` | `false` |
| `ENABLE_INTEGRATION_SCHEDULER` | `false` |
| `PERPLEXITY_API_KEY` / `ELEVENLABS_*` | Optional. Skip TTS and internet research. |
| KMS / OAuth client ids | Not needed for phase 1 |

Generate a shared secret once:

```bash
openssl rand -hex 32
```

Put that value in **both** `.env` files as `INTERNAL_API_SECRET`.

---

## Boot (first time)

Terminal 1 — API:

```bash
cd /path/to/retrospect-main/backend
cp .env.example .env          # then edit
npm install
npm run dev                   # listens on :3000
```

Terminal 2 — agent:

```bash
cd /path/to/retrospect-agent
cp .env.example .env          # then edit; do not rely on npm run setup
npm install
npm run doctor                # env + tables + OpenAI; follow its fix text
npm run dev                   # listens on :3001
```

Smoke:

```bash
curl -sS http://localhost:3000/health
curl -sS http://localhost:3001/health
```

Both should be reachable. If the agent `/health` fails, fix Supabase/env before anything else.

Optional: open `http://localhost:3001/runs` — local-only dashboard, **no auth**. Do not expose this port. Production agent is supposed to be a Render **private** service; `/runs` is unauthenticated in code (`src/index.ts`). If you ever deploy the agent with a public URL, that is a leak. Do not “fix” it as part of phase 1 unless asked; do not make it worse.

---

## Which user and database to use

**Rule:** develop on a **throwaway user** in a **non-prod** Supabase.

| User | How you get them | Use for |
|------|------------------|---------|
| **Dev test user** | `POST /auth/dev/test-user` on local API (`NODE_ENV≠production`) | Full path: JWT → `POST /content` → agent. **Preferred for proving the 202 path.** |
| **Demo fixture user** | Agent `npm run seed:demo` | Journals + goals already inserted. `apple_user_id = demo-user-fixture`, email `demo@retrospect-agent.local`. Good for CLI ingest. **`--reset` deletes that user’s content.** |
| Founder’s production user | You should not have this by default | **Do not** run `seed:demo --reset`, backfill, or experimental ingest here. |

`seed:demo` writes to **whatever `SUPABASE_URL` is in the agent `.env`**. If someone gave you production keys, `seed:demo --reset` will wipe the demo user **in production** (and only that apple id — still do not do it).

`POST /auth/dev/test-user` **404s** when `NODE_ENV=production`. It always **inserts a new user**; it cannot log you into an existing account.

---

## Prove the current path (before you change code)

You need two proofs: (A) API stores a journal and calls the agent, (B) you can inspect rows.

### A — phone-equivalent: JWT + `POST /content`

```bash
# 1. Mint a throwaway user (API must be NODE_ENV=development)
curl -sS -X POST http://localhost:3000/auth/dev/test-user
# Save data.token and data.user.id

# 2. Upload a journal
curl -sS -X POST http://localhost:3000/content \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contentType": "journal_entry",
    "content": "I skipped Thursday standup. Told myself I was too tired.",
    "contentDate": "2026-03-12T09:00:00.000Z"
  }'
# Expect HTTP 202 and data.rawContentId
```

Allowed `contentType` values include `journal_entry`, `text_entry`, `voice_journal`, `onboarding_profile`, plus integration types you do not need yet (`backend/src/types/index.ts`).

202 means the row is in `raw_content` and `setImmediate` fired `runAgentIngest`. It does **not** mean ingest finished. Watch:

- API terminal: agent errors
- Agent terminal / `http://localhost:3001/runs`
- SQL: `processing_status` on that `raw_content` id (`pending` → `completed` or `failed`)

If the agent is down, you still get 202 and the row can sit `pending` or later `failed`. That is today’s hole (see [02](./02-current-system.md)).

JWT lifetime is **30 days** (`config.jwt.expiresIn`).

### B — skip the API: agent CLI

After `seed:demo` (prints `Demo user: <uuid>`):

```bash
cd /path/to/retrospect-agent
npm run ingest -- --user <demo-or-test-user-id>
```

This calls `runIngest` directly (no JWT). Use this while you change `ingest.ts` / `graph-v2.ts`. Still run path A once so you do not break `POST /content`.

HTTP equivalent (agent must be up):

```bash
curl -sS -X POST http://localhost:3001/ingest/run \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
  -d '{"userId":"<uuid>","rawContentIds":["<raw-id>"]}'
```

Wrong or missing secret → **401**. Missing `INTERNAL_API_SECRET` on the agent → **500** (`server misconfigured`).

### C — measure (phase 0)

In the Supabase SQL editor, on **your** test user id:

```sql
select count(*) as raw_rows,
       count(embedding) as raw_embedded
from raw_content
where user_id = '<test-user-id>';

select count(*) as assertions from assertions where user_id = '<test-user-id>';
select count(*) as entities from entities where user_id = '<test-user-id>';
select count(*) as identity_inferences from identity_inferences where user_id = '<test-user-id>';
```

After **today’s** ingest you should see observations/insights go up and **assertions stay 0** (journals do not call graph-v2 yet). That is the gap. After phase 1 ticket 1.2, assertions should rise and `assertion_evidence.raw_content_id` should point at the journal.

Parked schema checks (write the answer in your PR or a note):

```sql
-- Is observations.goal_id still NOT NULL?
select is_nullable
from information_schema.columns
where table_name = 'observations' and column_name = 'goal_id';
```

Legacy API crons: `backend/package.json` `cron:daily` / `cron:weekly` / `cron:pipeline` / `cron:podcasts` are **print-and-exit** stubs. Do not extend them. If Render still has old cron jobs pointed at those scripts, they do nothing useful.

---

## After you change ingest (phase 1 sanity)

Same journal text twice (retry ingest on the same `raw_content` id) must **not** double Facts (`origin_key`). Excerpt must be a substring of `content`. Integrations: do not break `materializeGraphV2` — if you have no integration fixtures, at least keep `npm run typecheck` green in the agent and do not change the `source_items` mapper without a reason.

Agent tests: `npm run test` and `npm run typecheck` in `retrospect-agent`. API: `npm run test` if you touch `content.ts` / `agent-client.ts`.

---

## Hosted environments (so you do not invent URLs)

| Piece | Where |
|-------|--------|
| Public API (prod blueprint) | Render service `retrospect-api`, health `/health`. OAuth callback base in `backend/render.yaml`: `https://retrospect-api.onrender.com` |
| Public API (staging blueprint) | `retrospect-api-staging` in `backend/render.staging.yaml` |
| Agent | Render **private** service. The phone never calls it. API uses `AGENT_SERVICE_URL`. |

You do not need Render access to do phase 1 locally. Do not treat hosted prod as your test bench.

---

## What to do in week 1 (operational version of 06)

1. Get access + non-prod Supabase (this file).
2. Read 00–07. Skim the files listed at the bottom of [06](./06-implementation-plan.md).
3. Boot both services. Run path A and path B. Save your test `user_id`.
4. Run the SQL measures. Confirm assertions = 0 for a journal-only user.
5. Ticket 1.1: extract `writeFact` in `retrospect-agent/src/pipelines/graph-v2.ts`.
6. Stop and ask if you cannot get `/health` or ingest 401s after the secret matches.

Do **not** open `historical-agent-system.ts` to “improve patterns.”

---

## Who to ask, for what

| Situation | Ask |
|-----------|-----|
| Repo invite, env keys, which Supabase, which git branch | Founder |
| Reopen a lock in 01 or a D-number in 05 | Founder (before writing the PR) |
| Severe / safety classifier beyond “tag extreme, do not put in episode” | Founder |
| “Can I install Graphiti for a spike?” | Default no ([05](./05-decisions-and-non-goals.md) D1). Written approval only |
| `observations.goal_id` nullability, live cron on Render | Founder or whoever has the dashboard; do not guess in prod |
| Agent SHA on GitHub ≠ what 00 said | Trust **your clone’s `git log`**; update the briefing if you are changing the write path |
| iOS / playback / paywall / ElevenLabs in the binary | Out of scope; different work |

If you are blocked more than half a day on env, **stop coding architecture** and get the keys.

---

## Open items this briefing does not pretend to know

Fill these on day 0; they change per environment.

- [ ] Non-prod `SUPABASE_URL` you are allowed to write
- [ ] Your throwaway `user_id`
- [ ] Assertion count before you start (expect 0 for journals)
- [ ] `observations.goal_id` nullability
- [ ] Whether anyone still invokes old insight_units jobs on Render
- [ ] PR reviewer name
- [ ] Branch to cut from (this folder may not be on `main` yet)

---

## Security / hygiene (short)

- Service role key = full database. Never log it, never put it in a fixture committed to git.
- Do not run doctor/seed/backfill against prod “to see the real numbers” unless asked.
- Agent `/runs` is open on whatever host the process binds. Localhost only.
- Do not retry `POST /ingest/run` on 5xx until phase 1 idempotency exists (`agent-client.ts` is correct to refuse that today).

---

## File map for the first debugging session

| Symptom | Look here |
|---------|-----------|
| 401 on `/content` | Missing `Authorization: Bearer`; or JWT signed with a different `JWT_SECRET` |
| 404 on `/auth/dev/test-user` | `NODE_ENV=production` |
| 202 but status stays `pending` | Agent down, or `AGENT_SERVICE_URL` still `http://retrospect-agent:3001` |
| 401 on `/ingest/run` | `INTERNAL_API_SECRET` mismatch |
| 500 `missing INTERNAL_API_SECRET` | Agent `.env` lacks the key (`setup` did not copy it) |
| Ingest runs, no assertions | **Expected today.** You have not done ticket 1.2 |
| `npm run setup` cannot find source `.env` | Folder is not named `Retrospect`. Copy `.env.example` |

Then start [06-implementation-plan.md](./06-implementation-plan.md) ticket 1.1.
