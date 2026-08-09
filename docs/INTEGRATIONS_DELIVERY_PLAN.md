# Retrospect Integrations Delivery Plan

## Objective

Build every Retrospect integration as a durable input into the agent-owned personal
intelligence system. An integration is not complete when authorization succeeds. It is
complete only when provider data can be collected repeatedly, traced to its origin,
normalized without losing meaning, converted into evidence-grounded intelligence, and
verified in production.

## Current Implementation Status — June 16, 2026

### Built and locally verified

- The agent-owned integration schema, atomic source-item ingestion RPC, normalization
  contract, raw-content projection, sync-run state, processing leases, failure recovery,
  exact evidence linkage, Graph v2 assertions, entity resolution, connector verification,
  smoke harness, and Integrations dashboard are implemented.
- The public API authenticates users, verifies Apple identity tokens, owns OAuth start and
  callback flows, and forwards device batches/imports/sync requests to the protected agent
  endpoint.
- The iOS onboarding catalog must surface sources by actual collection path, not by wish.
  Apple Health, Screen Time, Calendar, Apple Music, Photos, and Contacts use device sync.
  Google Docs is a backend-owned continuous OAuth connector. Archive-only sources must not
  look like normal sign-in integrations.
- Apple Health explicitly distinguishes unavailable metrics from measured zero values and
  counts modern sleep stages. Screen Time source records remain factual. Google Docs uses
  Drive change cursors and paragraph-aware document sections.
- iOS, public API, and agent builds have passed locally. Agent typecheck, archive fixture
  tests, and repository diff checks pass.

### Live rollout gate

- Live Supabase must contain migrations `106_integration_foundation.sql`,
  `107_integration_agent_linkage.sql`, `108_integration_operations_graph_v2.sql`,
  and `109_fix_integration_ingestion_rpc_ambiguity.sql`.
  The live doctor reports the missing integration tables, columns, graph tables, and RPCs
  accurately.
- Applying those migrations requires the project owner's private Supabase/GitHub
  dashboard sign-in. Immediately afterward, run the structural smoke test, optional
  full-agent smoke test, doctor, and dashboard verification before any deployment.

### Not yet production-complete

- Calendar, Apple Music, Photos, Contacts, and continuous OAuth connectors are
  code-complete enough for staging, but they are not production-complete until
  source-specific fixture tests, real-device/real-account acceptance tests, and deletion
  behavior pass.
- Approval-restricted providers remain gated by provider access, exact field
  confirmation, and a signed-off user experience that does not hide provider limits.
- The product decisions near the end of this document still gate the affected connectors;
  implementation must not silently choose them.

## Non-Negotiable Architecture

Every connector must implement the same lifecycle:

1. **Authorize, device-sync, or explicitly import** using the strongest sustainable
   provider-supported method.
2. **Collect immutable source payloads** before interpretation.
3. **Normalize provider objects** into stable, versioned source items.
4. **Create analysis units** at the smallest useful semantic granularity.
5. **Project canonical text into `raw_content`** for the current intelligence pipeline.
6. **Run agent ingestion** to create observations, insights, identity inferences, and goals.
7. **Attach exact evidence links** from derived intelligence back to analysis units.
8. **Write knowledge-graph relationships** only when evidence supports them.
9. **Persist cursor and sync-run state** for replay, recovery, and debugging.
10. **Run connector verification tests** and expose results in the agent dashboard.

The public API authenticates the user and forwards batches. `retrospect-agent` owns
normalization contracts, sync processing, provenance, intelligence projection, testing,
and observability.

## 2026 Source Access Strategy

Retrospect should make data easy for the user to grant. The default product rule is:
native permission or official OAuth/sign-in first, provider-approved async portability
second, and manual archive import only as an advanced fallback. A source cannot appear as
`Connected` until a real verified sync or device batch has produced evidence in the agent.

| Source | Best 2026 collection path | Main data available without manual download | Lift | Onboarding rule |
| --- | --- | --- | --- | --- |
| Apple Health | Native HealthKit permission | Quantities, sleep, workouts, mindfulness, symptoms where permitted | Medium | Show now after device test |
| Screen Time | Native DeviceActivity / FamilyControls | App/category usage, pickups, notifications, report windows | High because extension entitlement and app-group reliability are fragile | Show as device sync only after repair |
| Calendar | Native EventKit permission | Events, recurrence, calendars, locations, attendee metadata if allowed | Low-medium | Show after real-device sync test |
| Contacts | Native Contacts permission | Names, organizations, relationship labels, contact identifiers for resolution | Low-medium | Show after hashing/identity policy is decided |
| Photos | Native PhotoKit permission | Asset metadata, albums, favorites, locations, originals if user allows | High because storage, Wi-Fi/charging policy, and image analysis policy matter | Show metadata sync first; originals/analysis separate opt-in |
| Apple Music | Native MediaPlayer/MusicKit | Library, playlists, play counts, ratings/favorites, last-played when available | Medium | Show as library/taste sync, not full listening history |
| Google Docs / Drive | Google OAuth with Drive changes and Docs API | Docs, Drive metadata, revisions/modified state, deletions/inaccessibility | Medium | Show once backend OAuth is deployed |
| Spotify | Spotify OAuth | Recently played, top items, saved tracks/albums, playlists, followed artists | Medium | Show early; strong low-friction intelligence |
| Reddit | Reddit OAuth/API | Identity, posts, comments, saved items, subscribed communities | Medium | Show after current API access/rate limits are verified |
| YouTube | Google OAuth / YouTube Data API | Subscriptions, playlists, liked videos, owned channel activity | Medium-high because watch history is not standard API-visible | Show as API-visible YouTube data only; do not promise watch history |
| Gmail | Google OAuth / Gmail API | Messages, threads, labels, participants, attachments if scoped | Very high because restricted scopes can require verification/security assessment | Start with opt-in thread/metadata path; gate full bodies |
| Pinterest | Pinterest OAuth after app approval | Boards, pins, descriptions, links, user profile where scopes allow | Medium-high because app access is reviewed | Do not show as connectable until Pinterest approval is real |
| TikTok | TikTok Login Kit plus Display API/video.list; Data Portability only as later enrichment | Profile and public/user videos first; richer activity categories only if TikTok grants portability access | High because review, scopes, and category coverage are approval-scoped | Show as API-visible sign-in sync after approval; do not promise watch/FYP history |
| LinkedIn | LinkedIn OIDC/OAuth | Basic identity/profile/email; richer profile/activity only with approved partner permissions | High because rich data is restricted | Show limited profile connect only unless richer access is approved |
| X | X OAuth/API | User posts, likes/bookmarks/activity only where paid tier and scopes allow | High because cost, tier limits, and Grok history uncertainty | Show only the exact enabled X data types |
| Grok | No confirmed official consumer chat-history pull API | None through a normal Retrospect sign-in path; user-provided files may be optional fallback | Blocked for sign-in, low-priority fallback for files | Do not show as connectable |
| Netflix | No public third-party sign-in API for viewing history | None through a normal Retrospect sign-in path | Blocked unless user accepts manual CSV | Do not show as connectable |
| ChatGPT | No official third-party consumer chat-history OAuth pull path; user export exists | None through a normal Retrospect sign-in path; user-provided files may be optional fallback | Blocked for sign-in, low-priority fallback for files | Do not show as connectable |
| Claude | Claude API supports developer-created messages, not a user's consumer Claude history | None through a normal Retrospect sign-in path; user-provided files may be optional fallback | Blocked for sign-in, low-priority fallback for files | Do not show as connectable |

Implementation consequence: the app still keeps a reusable archive-import framework for
users who explicitly choose it, but files/archives are no longer the default plan for
TikTok, LinkedIn, X, Netflix, ChatGPT, Claude, or Grok. The catalog and onboarding must separate
`device sync`, `continuous sync`, `API-visible sync`, `limited profile sync`, and
`advanced import`.

Research references checked for this matrix: Apple HealthKit, DeviceActivity,
FamilyControls, EventKit, Contacts, PhotoKit, MusicKit, and MediaPlayer developer docs;
Google Drive `files.list` and `changes.list`, Google Docs `documents.get`, Gmail scopes
and User Data Policy, YouTube Data API, Spotify Web API, Reddit API/OAuth docs, Pinterest
OAuth/app review docs, TikTok Scopes and Data Portability docs, LinkedIn OIDC/OAuth/Profile
API docs, X API/OAuth docs, Netflix help/privacy docs, OpenAI ChatGPT export docs, and
Anthropic Claude API docs.

## Shared Connector Contract

Each provider object must supply:

- `providerObjectType`: provider-native object category.
- `providerObjectId`: stable provider ID or deterministic imported-object ID.
- `payload`: complete allowed original payload.
- `canonicalType`: Retrospect semantic object type.
- `canonicalText`: loss-minimized text representation for current agents.
- `normalizedData`: typed fields used by graph builders and future models.
- `occurredAt`: when the represented event actually happened.
- `providerCreatedAt` and `providerUpdatedAt`, when available.
- `parserVersion` and `normalizerVersion`.
- `contentType` and metadata.

Every connector must support:

- Idempotent replay.
- Initial backfill and incremental synchronization.
- Stable deduplication.
- Provider deletion handling where the provider exposes deletions.
- Partial failure reporting.
- Authorization expiry and reconnect behavior.
- Rate-limit handling.
- Schema-version migration.
- A deterministic fixture-based test suite.
- A production smoke test using a real consented account.

## Locked Requested Source Plan

The current Google Docs connector is the reference shape: backend-owned OAuth,
provider cursor state, immutable payload, typed source item, semantic analysis unit,
`raw_content` projection, agent ingestion, evidence links, and Graph v2 assertions. The
sources below should be rebuilt or hardened into that same shape rather than handled as
one-off ingestion scripts.

### Group A: Lock First Because They Are Already Native or Already Ingesting

#### Apple Health

Keep Apple Health as the reference native connector. Extract daily quantities, sleep
stages, workouts, mindfulness, symptoms when authorized, source device, units, timezone,
sample windows, and unavailable-versus-zero state. The agent should extract routine,
recovery, consistency, energy, and goal-alignment observations, while explicitly avoiding
medical diagnosis.

Implementation work: move every HealthKit upload into the integration-source contract,
add stable per-day/per-session IDs, add late-sample reconciliation, and run real-device
tests across partial permission sets.

#### Calendar

Extract event instances, recurring series, title, notes when allowed, start/end/timezone,
all-day state, calendar identity, location, attendee count, attendee identities only if
approved, status/cancellation, organizer, recurrence rules, and last modified state. The
graph should create tentative event, place, organization, project, routine, and person
co-occurrence nodes, while not assuming attendance from an event title.

Implementation work: keep the existing iOS EventKit batch path, add recurrence-aware
provider object IDs, add rolling historical/future windows, and add deletion/cancellation
handling.

#### Contacts

Extract names, nicknames, organizations, job titles, relationship labels, birthdays if
present, contact notes only if explicitly approved, and hashed communication identifiers
if the product accepts that entity-resolution policy. Contacts feed entity resolution, not
relationship truth: they create person/organization candidates and aliases for calendar,
Gmail, photos, and user-authored text.

Implementation work: keep native iOS collection, add hashed identifier policy, merge
history, deletion propagation, and contact-to-entity alias confidence.

#### Google Docs / Drive

Google Docs already works and should not be paused. Evolve it into the Graph v2 contract:
Drive file metadata, owner/shared state, created/modified time, revision/change cursor,
deleted/inaccessible state, document title, paragraph-aware sections, headings, tables,
and stable section IDs. Extract goals, projects, recurring language, beliefs, questions,
plans, and changes in thinking over time.

Implementation work: harden the current `google-docs` connector with deterministic
section IDs, source-item versioning by Drive modified time, deletion handling, and
expected-observation evals.

### Group B: Build Next Because They Are High-Signal and Low-Friction

#### Spotify

Extract recently played tracks, played-at timestamps, saved tracks/albums, top artists and
tracks, followed artists, playlists, playlist descriptions, playlist ownership, genres,
album/artist metadata, and popularity when available. The graph should create music taste,
routine, artist affinity, genre affinity, temporal mood/context candidates, and repeated
interest edges. Music must remain weak emotional evidence unless confirmed by context.

Implementation work: extend the current connector beyond recently played/saved/playlists/
followed artists to top items and albums, add scope-specific coverage reporting, cursor
contract tests, rate-limit tests, and a real Spotify account smoke run.

#### Apple Music

Extract local/library tracks, artists, albums, playlists, play counts, skip counts if
available, rating/favorite state, last played, date added, genres, and playlist membership.
Separate "this is in the user's library" from "the user recently listened to this." Graph
edges should mirror Spotify but keep Apple Music provider provenance separate.

Implementation work: harden native MediaPlayer/MusicKit upload, add stable track/playlist
IDs, cloud-library edge cases, and dedupe against Spotify only at the canonical entity
layer, never at raw evidence.

#### Photos Metadata

Start with metadata only: asset ID/local identifier, creation date, media type, favorite
state, album membership, burst/live-photo grouping, coarse location, timezone, dimensions,
and optional original asset upload only under the media policy. The graph should create
place, memory, event-candidate, travel/routine, and person-candidate context; photo volume
does not prove importance by itself.

Implementation work: keep native PhotoKit sync metadata-first, add limited-library
handling, changed selection handling, location clustering, original-media storage policy,
and load/cost tests before any image-content analysis.

#### Reddit

Extract authenticated profile, authored posts, authored comments, saved items, subscribed
communities, subreddit metadata, thread context, timestamps, scores, links, and edit/delete
states where visible. The graph should extract interests, questions, opinions, community
affinities, vocabulary, recurring concerns, and saved-content curiosity signals. Saved
does not mean endorsed.

Implementation work: harden the current connector with full listing pagination,
relationship-specific object types, mature/private/deleted content handling, API policy
checks, and rate-limit tests.

#### YouTube API-Visible Data

Extract subscriptions, playlists, playlist items, liked videos, owned/uploaded channel
activity, video/channel metadata, descriptions, topics/categories where available, and
published timestamps. Do not promise watch history from the standard API. The graph should
extract learning topics, creator affinity, media interests, and explicit saved/liked
signals.

Implementation work: extend the current connector to playlist items and channel/uploads,
add quota accounting, missing/private video handling, OAuth scope coverage, and clear UI
copy that says "subscriptions, playlists, likes, and available activity."

### Group C: Make Happen, But Treat As Repair, Verification, or Approval Work

#### Screen Time

Extract daily app/category usage, pickups, notifications, first pickup, report window,
device/app identifiers, and aggregate trends through DeviceActivity/FamilyControls. This
is a repair-heavy source because the data comes from an iOS report extension and app group,
not a normal server API. The graph should extract attention allocation, routines,
friction, and alignment/tension with explicit goals.

Implementation work: fix report extension reliability, app-group persistence, background
handoff, duplicate-day idempotency, and "no report" handling before marking connected.

#### Gmail

Extract threads, messages, participants, labels, timestamps, subject, snippet/body
according to approved scope, attachments metadata, commitments, requests, organizations,
projects, and communication cadence. This is high-lift because Gmail body access is
restricted/sensitive and can require Google's verification and security assessment. The
graph should create person, organization, commitment, project, relationship-cadence, and
temporal obligation edges.

Implementation work: ship metadata/user-selected-thread mode first, add quoted-text and
signature stripping, history ID incremental sync, attachment metadata policy, restricted
scope review package, and tenant-isolation tests.

#### Pinterest

Extract boards, pins, descriptions, notes, links, images/thumbnails where permitted, board
sections, privacy state, created/updated timestamps, and topic/category metadata where
available. Pinterest is personality-rich because boards are aspirational structure:
style, projects, identity, taste, future-self signals. It is approval-heavy because app
access and scopes are reviewed.

Implementation work: complete OAuth production app review, extend the current connector
from boards to pins and sections, add pin URL/image metadata normalization, and build
goal/aspiration extraction evals.

#### TikTok

Extract profile and public/user videos through Login Kit plus the Display API first. Richer
activity/profile/direct-message categories can be added through approved TikTok Data
Portability requests later, but that is enrichment, not the default onboarding path.
The graph should extract creator affinity, topic exposure, attention loops, humor/taste,
identity signals, and creative output.

Implementation work: complete TikTok app review for Login Kit/video scopes, verify exact
Display API fields in staging, then add portability request/status/download jobs only after
TikTok grants those categories. Keep strict coverage reporting either way.

#### LinkedIn

Extract OIDC identity/profile/email immediately where available. Richer professional
profile, network, posts, reactions, or activity require approved LinkedIn permissions and
storage constraints. LinkedIn is personality-rich for career identity, status language,
skills, organizations, aspirations, and professional network, but access is approval-heavy
because LinkedIn restricts many useful APIs.

Implementation work: ship limited profile sync only if product accepts the limitation,
then apply for partner permissions for richer profile/activity. Add storage-rule checks
and UI that never implies "full LinkedIn brain" unless approved.

#### X

Extract user profile, authored posts, replies/mentions, public metrics, likes/bookmarks
where the paid tier and scopes allow, followed topics/lists/communities if available, and
media metadata. X is personality-rich for opinions, humor, news attention, community,
contrarian signals, and saved curiosity, but high-lift because API economics, access tier,
rate limits, and scope availability determine what is real.

Implementation work: choose paid API tier and cost ceiling, implement OAuth, add authored
post timeline first, then likes/bookmarks only after confirming scopes, and add per-source
coverage labels so missing data is visible rather than silently absent.

## Why Prior Confidence Was Mixed

- **Medium but doable** meant the provider has a real official API or native framework,
  but production quality still requires pagination, cursor correctness, revoked-token
  handling, dedupe, rate-limit handling, fixture tests, and real-account smoke tests.
  Spotify, Reddit, YouTube API-visible data, Apple Music, Photos metadata, Calendar, and
  Contacts are in this category.
- **Repair needed** meant the architecture is valid but the existing local implementation
  is fragile or incomplete. Screen Time is the clearest case because iOS report extensions,
  app groups, background refresh, and permissions make it more brittle than normal native
  reads.
- **Verification/security needed** meant the data is technically accessible but external
  policy gates are substantial. Gmail is the main example because message data triggers
  Google OAuth verification and possible security assessment.
- **Approval needed** meant Retrospect can build the connector shape, but cannot honestly
  promise the source until the provider grants product/scopes/tier access. Pinterest,
  TikTok Data Portability, LinkedIn richer data, and X paid/scoped data are in this group.
- **Blocked for normal sign-in** meant no official low-friction consumer pull path is
  currently available. ChatGPT, Claude, Grok, and Netflix can support optional file import
  if users already have files, but they should not compete with real native/OAuth sources
  in onboarding.

## Knowledge and Graph Rules

The graph must distinguish facts from model conclusions:

- **Source item:** a provider object or imported record.
- **Analysis unit:** the smallest evidence-bearing portion of a source item.
- **Observation:** a grounded statement supported by one or more analysis units.
- **Insight:** a broader pattern supported by multiple observations.
- **Identity inference:** a provisional or durable claim about the person.
- **Goal / goal candidate:** an explicitly stated or responsibly inferred desired future.

No inferred edge may be presented as fact. Every observation, insight, identity inference,
and inferred goal must retain evidence links, confidence, creation time, and model/run
version. Contradictions and changing behavior must create temporal relationships rather
than overwrite history.

## Personal Intelligence Reasoning Layer

Integrations should not only feed more data into Retrospect; they should feed a reasoning
system that can say what the evidence suggests, why it suggests that, how strong the
suggestion is, and what would change the conclusion. The graph is the evidence substrate.
The reasoning layer is the careful interpreter on top of it.

### Claim Types

Every derived record must declare its claim type:

- `fact`: directly observed from source evidence, such as a calendar event or saved track.
- `observation`: a grounded natural-language statement about one or more evidence items.
- `signal`: a weak pattern that may matter but is not yet a conclusion.
- `hypothesis`: a cross-source explanation that may explain a pattern.
- `insight`: a useful synthesized conclusion with enough support to surface.
- `goal_candidate`: an inferred possible goal that still needs confirmation.
- `identity_trait_candidate`: an inferred possible durable trait or preference.
- `emotional_state_candidate`: a temporally scoped mood/state inference.
- `user_confirmed`: a claim the user explicitly confirmed, corrected, or supplied.
- `contradicted`: a claim whose evidence is meaningfully challenged by later evidence.
- `superseded`: a claim that may have been true before but appears outdated.

The product language must match the claim type. Weak claims use wording like "may suggest"
or "could indicate." Confirmed claims may use stronger wording. Contradicted and
superseded claims remain visible in history instead of being deleted.

### Evidence Strength

Each observation, hypothesis, insight, goal, and identity record must store evidence
strength, not just generic confidence. Strength is based on both source quality and pattern
quality.

Evidence strength ordering:

1. Explicit user confirmation or correction.
2. Explicit user-authored statements in high-intent contexts, such as onboarding, journal,
   Google Docs, emails, or AI conversations supplied by the user.
3. Repeated commitments or plans, such as calendar blocks, recurring documents, or task-like
   language.
4. Repeated behavior across multiple independent sources, such as Spotify plus Apple Music,
   Reddit plus YouTube, or Calendar plus Gmail.
5. Single-source repeated behavior.
6. Passive likes, saves, pins, subscriptions, follows, and metadata.
7. One-off passive signals.

Every claim should also store:

- `source_diversity`: how many independent source families support it.
- `recency_weight`: whether the evidence is current, stale, or resurfacing.
- `frequency_weight`: whether the pattern is repeated or isolated.
- `intent_weight`: whether the user actively expressed it or passively produced it.
- `contradiction_weight`: how much opposing evidence exists.
- `confidence`: final calibrated confidence after evidence and contradiction scoring.

### Cross-Source Hypothesis Engine

The system should deliberately ask: "What does this person doing X over here and Y over
there suggest?" This is a separate step between observations and insights.

Example process:

1. Collect factual observations from individual sources.
2. Cluster observations by entity, topic, goal, emotion, project, person, place, and time.
3. Look for cross-source agreement, tension, repetition, and change.
4. Create hypotheses with explicit supporting and contradicting evidence.
5. Promote only well-supported hypotheses into surfaced insights or goal/identity updates.
6. Keep weaker hypotheses internal until more evidence or user feedback arrives.

Example:

- Google Docs: repeated writing about creative independence.
- Calendar: recurring project-building blocks.
- Pinterest/Reddit/YouTube: repeated saved creative and entrepreneurial material.
- LinkedIn/Gmail: professional context suggesting work tension.
- Hypothesis: "This may suggest a durable drive toward creative autonomy."
- Confidence rises if the pattern persists, crosses source families, or the user confirms
  it. Confidence falls if later evidence shows the material was temporary research,
  external work, or no longer relevant.

### Contradiction Handling

Contradictions must become graph structure, not silent overwrites. A contradiction can be:

- `stated_vs_behavioral`: the user says one thing, repeated behavior suggests another.
- `past_vs_present`: an old pattern no longer matches recent evidence.
- `source_vs_source`: two sources imply different interpretations.
- `model_vs_user`: the model inferred something and the user corrected it.
- `goal_vs_capacity`: a stated goal conflicts with time, energy, attention, or context.

When a contradiction appears, Retrospect should create a contradiction edge with:

- supporting evidence IDs,
- contradicting evidence IDs,
- claim IDs affected,
- temporal scope,
- severity,
- explanation,
- status: `open`, `resolved`, `user_clarified`, or `superseded`.

The system should surface contradictions carefully:

> "You have repeatedly written that health matters to you, but recent sleep and schedule
> evidence may suggest the goal is under-supported right now."

That is different from saying:

> "You do not care about health."

### Temporal Identity

Retrospect should model identity over time, not as a static profile. Identity records
should answer:

- Who has this person consistently been?
- What changed recently?
- What seems to be emerging?
- What may have been true before but is less true now?
- Which identity claims are stable, seasonal, situational, or unresolved?

Temporal identity records need:

- `valid_from`,
- `valid_until`,
- `observed_at`,
- `last_supported_at`,
- `stability`: `emerging`, `recurring`, `stable`, `declining`, `superseded`,
- `life_domain`: work, health, relationships, creativity, curiosity, emotion, media,
  spirituality, finance, learning, or other,
- evidence and contradiction links.

The graph should support "identity snapshots" so the agent can reason about the user at
different moments:

- current identity model,
- last 7 days,
- last 30 days,
- last 6 months,
- historically stable traits,
- newly emerging traits.

### Feedback Loop

User feedback is the strongest evidence because it turns model guesses into calibrated
personal understanding. Every surfaced insight, goal candidate, contradiction, identity
claim, and emotional-state hypothesis should support feedback:

- confirm,
- reject,
- partially true,
- true before but not now,
- true in one context,
- missing nuance,
- private / do not use,
- ask me again later.

Feedback should write back into the graph as evidence with higher strength than passive
signals. Rejected claims should not simply disappear; they should become negative training
evidence so similar future overreach is less likely.

### Quality Gates for Reasoning

No personal-intelligence claim may ship unless:

- it has at least one exact evidence link,
- its claim type is explicit,
- confidence and evidence strength are stored separately,
- contradictory evidence has been checked,
- temporal scope is present,
- weak claims use weak language,
- user feedback can update or invalidate it,
- evals verify that the model does not overstate passive evidence.

Reasoning evals must include:

- cross-source agreement tests,
- contradiction tests,
- old-versus-new evidence tests,
- user-correction tests,
- weak-signal overreach tests,
- evidence citation tests,
- temporal drift tests,
- goal-candidate promotion tests.

## Universal Definition of Done

A connector is production-complete only when:

- Onboarding connection, reconnect, disconnect, and error states work.
- Initial backfill and two consecutive incremental syncs succeed.
- Replaying the same batch creates no duplicate source items or raw content.
- Updating one provider object updates only the corresponding source item.
- Original payload, normalized item, analysis unit, raw content, derived observation,
  evidence link, graph edge, sync run, and linked agent trace are visible.
- Expected missing or revoked permissions fail honestly.
- Connector tests pass in the agent dashboard.
- Product-specific intelligence evaluation passes: generated observations are accurate,
  useful, appropriately cautious, and attributable.

## Delivery Batches

### Batch 0: Deploy and Prove the Foundation

Apply agent migrations `106_integration_foundation.sql`,
`107_integration_agent_linkage.sql`, `108_integration_operations_graph_v2.sql`,
and `109_fix_integration_ingestion_rpc_ambiguity.sql`.
Verify the atomic ingestion RPC, dashboard, provenance chain, Graph v2 assertions,
integration test runs, and replay behavior with a synthetic connector before migrating
real sources.

Exit gate: one synthetic object can be replayed and updated without duplication, and every
step from payload to graph is visible.

### Batch 1: Existing High-Confidence Sources

#### Apple Health

**Collection method:** Native HealthKit reads.

**Collection logic:** Store one stable daily aggregate item per metric family and day,
rather than one unstructured daily paragraph. Begin with steps, active energy, heart rate,
sleep, and mindfulness. Add workouts and additional metrics only after deciding their
intelligence purpose.

**Normalized objects:** `health_daily_activity`, `health_sleep_session`,
`health_heart_rate_summary`, `health_mindfulness_session`, and later `health_workout`.

**Graph contribution:** temporal evidence about routines, recovery, energy, consistency,
and relationships between stated goals and behavior. Never infer medical diagnoses.

**Special quality requirements:** distinguish zero from unavailable data; retain units,
source devices, aggregation windows, and timezone; prevent overlapping sleep samples from
being double-counted.

**Tests:** permission denied, partial metric permission, empty day, timezone boundary,
late-arriving HealthKit sample, replay, and changed aggregate.

#### Screen Time

**Collection method:** Native DeviceActivity / FamilyControls report extension.

**Collection logic:** One daily summary item plus child analysis units for app and category
usage. Preserve totals, pickups, first pickup, app usage, category usage, and report window.
Do not bake speculative behavioral judgments into the source payload.

**Normalized objects:** `attention_day`, `app_usage_day`, `category_usage_day`.

**Graph contribution:** attention allocation, recurring digital routines, and evidence of
alignment or tension with explicit goals.

**Special quality requirements:** source data must remain descriptive; interpretations such
as “avoidance” belong in provisional insights, not normalized facts.

**Tests:** extension produces no report, partial app names, duplicate daily report, changed
report, backfill ordering, authorization revoked, and app-group data corruption.

#### Google Docs

**Collection method:** Google OAuth, Drive API for discovery, Docs API/export for content.

**Collection logic:** Track each document by Drive file ID and revision/modified time.
Preserve document metadata and chunk large documents into deterministic, paragraph-aware
analysis units. Incrementally resync modified documents and mark deleted/inaccessible files.

**Normalized objects:** `document`, `document_section`, and optionally `document_comment`
only if deliberately requested and permitted.

**Graph contribution:** projects, recurring themes, articulated goals, work context,
interests, and changes in thinking over time.

**Special quality requirements:** avoid arbitrary character chunks; distinguish authored
content from templates or shared documents; retain title, ownership, and modified time.

**Tests:** large document, formatting-only change, renamed document, deleted document,
shared document, empty document, token expiry, and repeated sync.

### Batch 2: Native Context Sources

#### Calendar

**Collection method:** Native EventKit.

**Collection logic:** Store individual events using calendar item identifiers, including
start/end, timezone, recurrence, status, calendar identity, location, attendee count, and
allowed attendee information. Synchronize a rolling historical and future window. Treat
recurring instances as temporal occurrences connected to a recurring series.

**Normalized objects:** `calendar_event`, `calendar_event_series`, `calendar_attendance`.

**Graph contribution:** commitments, routines, time allocation, organizations, places, and
relationship co-occurrence. Event titles alone do not prove behavior or attendance.

**Tests:** recurring events, moved event, cancelled event, all-day event, timezone change,
duplicate calendars, private event, and revoked permission.

#### Contacts

**Collection method:** Native Contacts framework.

**Collection logic:** Store stable contact records with normalized names, organizations,
relationship labels, and non-sensitive identifiers required for future entity resolution.
Do not treat presence in contacts as proof of an active relationship.

**Normalized objects:** `person_record`, `organization_record`, `declared_relationship`.

**Graph contribution:** candidate person and organization nodes used to resolve references
across calendar, communications, photos, and user-authored content.

**Tests:** merged contacts, renamed contact, duplicate people, organization-only contact,
large address book, deletion, and limited permission.

#### Apple Music

**Collection method:** Native MediaPlayer/MusicKit according to available user-library and
history access.

**Collection logic:** Store track, artist, album, genre, playlist membership, play count,
rating/favorite state, and last-played time when available. Separate library preference
from actual recent listening.

**Normalized objects:** `music_track`, `music_play_signal`, `music_playlist`.

**Graph contribution:** taste, changing interests, recurring contexts, and possible mood
associations. Music choice must not be treated as direct emotional-state proof.

**Tests:** no library, cloud-only library, missing metadata, duplicate track editions,
changed play count, and permission revoked.

#### Photos

**Collection method:** Native Photos framework.

**Collection logic:** Begin with metadata-only asset records: creation date, media type,
favorite state, album membership, coarse location grouping, and activity counts. Image
content analysis is a separate product decision and must not be silently introduced.

**Normalized objects:** `photo_asset_metadata`, `photo_activity_day`, `photo_place_cluster`,
`photo_album`.

**Graph contribution:** memory timing, places, activity cadence, and candidate life events.
Photo frequency does not prove emotional importance.

**Tests:** limited-library permission, changed limited selection, missing dates, burst/live
photos, duplicate imports, timezone changes, and location unavailable.

### Batch 3: Standard OAuth and High-Value External Sources

#### Spotify

**Collection method:** Spotify Web API OAuth.

**Collection logic:** Collect recently played items incrementally using playback cursors,
saved tracks/albums, followed artists, playlists, and top items. Preserve track, artist,
album, context, and played-at timestamps.

**Normalized objects:** `music_play`, `music_preference`, `playlist`, `artist_affinity`.

**Graph contribution:** taste evolution, routines, repeated interests, and cross-platform
music identity.

**Tests:** cursor pagination, repeated track plays, private playlist, removed track, token
refresh, rate limiting, and account with little history.

#### Reddit

**Collection method:** Reddit OAuth/API where current terms and production access permit.

**Collection logic:** Prioritize user-authored comments/posts, saved items, and subscribed
communities that the API legitimately exposes. Preserve subreddit, thread context, score,
timestamps, and authored-versus-saved distinction.

**Normalized objects:** `social_post`, `social_comment`, `saved_content`,
`community_membership`.

**Graph contribution:** interests, communities, expressed opinions, questions, and changes
in viewpoint. Saved content is interest evidence, not endorsement.

**Tests:** deleted content, removed subreddit, edited comment, pagination, mature content,
rate limiting, and token expiry.

#### Pinterest

**Collection method:** Pinterest API if the required user-data scopes and production access
are approved. If production API access is not approved, keep Pinterest out of default
onboarding rather than pretending a manual export is a normal connection.

**Collection logic:** Collect boards, pins, descriptions, links, and timestamps. Preserve
board structure because it often carries more aspiration meaning than individual pins.

**Normalized objects:** `aspiration_board`, `saved_idea`, `external_reference`.

**Graph contribution:** aspirations, aesthetic taste, planned projects, and emerging
interests. A pin is a weak signal until repeated or explicitly connected to a goal.

**Tests:** private boards, duplicate pins, changed board name, deleted pin, unavailable URL,
OAuth revocation, and scope reduction.

### Batch 4: Google and Media Sources Requiring Special Handling

#### Gmail

**Collection method:** Gmail API with the minimum justified scopes, after Google sensitive
or restricted-scope verification as required.

**Collection logic:** Start with metadata and user-selected threads before considering full
message bodies. Normalize threads, participants, timestamps, labels, and extracted
commitments. Strip signatures and quoted history before analysis while preserving original
payload provenance.

**Normalized objects:** `email_thread`, `email_message`, `communication_commitment`,
`person_interaction`.

**Graph contribution:** active relationships, commitments, projects, organizations, and
communication cadence. Email frequency does not equal relationship quality.

**Tests:** long thread, quoted replies, aliases, mailing lists, attachments, deleted mail,
incremental history ID recovery, token expiry, and scope reduction.

#### YouTube

**Collection method:** YouTube Data API for subscriptions, playlists, liked videos, and
user-owned activity. Do not claim the standard API provides complete watch history.
Optional watch-history import can exist only as an advanced fallback if the user explicitly
asks for it.

**Collection logic:** Keep subscriptions, playlist membership, likes, and authored content
as separate evidence types. If an advanced watch-history import exists later, it must be
visibly labeled as imported history, not continuous sync.

**Normalized objects:** `video_preference`, `channel_subscription`, `playlist`,
`video_watch_event`.

**Graph contribution:** learning topics, media interests, creators, and attention patterns.

**Tests:** unavailable/private video, playlist mutation, missing liked-video access,
quota exhaustion, token refresh, revocation, and pagination.

#### Netflix

**Collection method:** No default onboarding connector. Netflix exposes viewing history to
the user in the web account UI, including CSV download, but there is no official
low-friction third-party sign-in API for Retrospect to pull viewing history.

**Collection logic:** If the product later accepts advanced imports, parse viewing activity
and profile identity from user-provided CSV/account exports. Store each viewing event with
title, profile, and viewed-at date. Resolve series/episode relationships without
incorrectly merging similarly named titles.

**Normalized objects:** `video_watch_event`, `series`, `episode`, `media_preference`.

**Graph contribution:** entertainment taste, recurring routines, and topic interests.

**Tests:** multiple profiles, repeated episode, renamed title, partial export, re-import,
malformed date formats, and explicit "not connectable" onboarding state.

### Batch 5: Conversation Sources With No Low-Friction Pull API

#### ChatGPT

**Collection method:** No default onboarding connector. OpenAI documents a user export
flow for ChatGPT data, but Retrospect should not present ChatGPT as a normal sign-in data
source unless an official third-party consumer-history access path exists.

**Collection logic:** Optional advanced import may parse user-provided conversations as
trees, preserving branches, message authors, timestamps, model metadata when present,
attachments metadata, and conversation titles. Create analysis units per meaningful user
message and coherent exchange, not per entire conversation dump. This is a fallback path,
not a primary onboarding integration.

**Normalized objects:** `ai_conversation`, `ai_message`, `question`, `project_context`.

**Graph contribution:** questions, projects, recurring concerns, learning paths, stated
goals, and changes in reasoning. Assistant-generated text is context, not evidence about
the user unless the user adopts or reacts to it.

**Tests:** branched conversation, regenerated response, missing timestamps, attachments,
large archive, deleted conversation, re-import, and explicit "advanced import only" UI.

#### Claude

**Collection method:** No default onboarding connector. Anthropic's Claude API gives
developers programmatic access to Claude models and managed-agent infrastructure; it is
not the same thing as an official pull API for a user's consumer Claude conversation
history.

**Collection logic:** Optional advanced import may preserve user-provided conversations,
user/assistant roles, projects or artifacts when included, timestamps, and source file
version. Apply the same user-versus-assistant evidence distinction as ChatGPT. This is a
fallback path, not a primary onboarding integration.

**Normalized objects:** `ai_conversation`, `ai_message`, `project_context`,
`external_artifact`.

**Graph contribution:** the same high-intelligence thinking and project signals as ChatGPT,
with provider-specific provenance retained.

**Tests:** multi-turn conversation, artifacts, large export, missing metadata, malformed
archive, re-import, and explicit "advanced import only" UI.

### Batch 6: Approval-Restricted and High-Friction Sources

#### TikTok

**Collection method:** TikTok Login Kit plus Display API/video.list for the primary
tap-to-sign-in path. Use approved Data Portability requests only for richer activity
categories after TikTok grants those scopes. This is not a manual archive-first flow.

**Collection logic:** After OAuth, fetch profile and video pages immediately, then mark the
source connected only after the first verified sync. If portability is later approved,
create an async request, poll request status, download the returned files when ready, parse
by category, and store request ID, scope, category, requested-at, fulfilled-at, and parser
version. The user experience must distinguish "connected" from "preparing richer history."

**Normalized objects:** `social_video`, `video_interaction`, `video_watch_event`,
`creator_affinity`.

**Graph contribution:** attention, creators, media interests, and authored creative work.

**Exit dependency:** confirm app review, portability scopes, data categories, request
frequency, status/download behavior, and exact available fields before production.

#### LinkedIn

**Collection method:** LinkedIn OIDC/OAuth for identity, email, and lite profile. Richer
profile, network, or activity data requires approved LinkedIn partner permissions and must
not be implied in onboarding unless access is granted.

**Collection logic:** Start with `limited_profile_sync`: authenticated member ID, name,
picture, locale/email when returned, headline/profile fields only if permissioned, and
organization/role hints only where allowed. Keep richer professional activity behind a
separate provider-access gate.

**Normalized objects:** `professional_profile`, `organization`, `professional_relationship`,
`professional_activity`.

**Graph contribution:** career identity, organizations, skills, and professional network.

**Exit dependency:** confirm approved products/scopes, storage restrictions, and whether
Retrospect is allowed to retain any returned profile fields beyond the authenticated
member's own profile.

#### X / Grok

**Collection method:** X OAuth/API for the exact user-authorized data enabled by the
current paid tier and scopes. Grok consumer chat history has no confirmed official pull
path, so Grok may only exist as optional user-provided file import unless an official
provider-supported path appears.

**Collection logic:** Implement X separately from Grok. For X, store authored posts,
public metrics, mentions/replies, likes/bookmarks only where the API tier and scopes allow.
For Grok, do not build a connect button until an official consumer-history API exists.
If users already have Grok files, parse them through the advanced import framework and
label them as imported files.

**Normalized objects:** `social_post`, `saved_content`, `social_interaction`,
`ai_conversation`.

**Graph contribution:** expressed opinions, interests, communities, and questions.

**Exit dependency:** approve ongoing API cost, exact tier, scopes, and whether Grok has an
official supported data path.

## Required Product Decisions

These decisions cannot be inferred from architecture and must be answered before their
associated connector reaches production:

1. Should Photos remain metadata-only, or may Retrospect analyze image content on-device?
2. Should Gmail initially ingest full message bodies, user-selected threads, or metadata
   only?
3. Should contacts include phone/email hashes for cross-source entity resolution?
4. Should calendar attendee identities be ingested, or only attendee counts?
5. Should advanced user exports exist at all as fallback, and if so should they be hidden
   from onboarding, uploaded as archives, parsed on-device, or both?
6. How much historical backfill should each source request by default?
7. Should Retrospect automatically infer goals from passive behavior, or only create
   provisional goal candidates requiring user confirmation?
8. What retention policy applies to immutable provider payloads?
9. Should LinkedIn ship as limited profile sync even if richer professional activity is
   unavailable?
10. Should YouTube ship without watch history, clearly labeled as subscriptions/playlists/
   likes only?

## Recommended Execution Order

1. Deploy and verify Batch 0.
2. Complete Apple Health end-to-end as the reference connector.
3. Repair Screen Time and complete backend-owned Google Docs.
4. Upgrade Calendar and Contacts together to establish person/time graph resolution.
5. Ship Spotify because it is low-friction OAuth with high intelligence yield.
6. Upgrade Apple Music and Photos, including original-media policy and load tests.
7. Build Reddit and YouTube API-visible data, with honest coverage labels.
8. Pursue Gmail verification/security review while other batches ship.
9. Build TikTok as sign-in Data Portability sync after scopes and app review are approved.
10. Build Pinterest after access is approved.
11. Build LinkedIn limited profile sync only if the product accepts that it is limited.
12. Build X only after API tier/cost is approved; keep Grok out of normal onboarding until
    official consumer-history access exists. Optional Grok file import can share the
    advanced AI-conversation parser later.
13. Keep Netflix, ChatGPT, Claude, and any other no-API sources out of default onboarding
    unless the user explicitly chooses advanced import.

This order maximizes intelligence early while using each completed connector to harden the
shared architecture before adding sources with external approval risk.
