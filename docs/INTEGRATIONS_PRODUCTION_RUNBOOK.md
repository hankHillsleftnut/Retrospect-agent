# Integrations Production Runbook

## Release Order

1. Revoke the OpenAI key that previously shipped in the iOS `Info.plist`.
2. Create isolated staging Supabase, Render, AWS KMS, and Sentry resources.
3. Apply migrations `106`, `107`, `108`, and `109` to staging.
4. Deploy staging API and the existing agent service with `ENABLE_INTEGRATION_RUNTIME=true`.
5. Run `npm run doctor`, `npm run integration:smoke`, and real-account connector tests.
6. Apply the same migrations to production during a reviewed maintenance window.
7. Deploy production API and the existing agent service using manual Render approval.
8. Release the iOS build only after native-source device tests pass.

## External Setup Checklist

- Rotate the exposed OpenAI key and every secret that may have shared its environment.
- Create a US West AWS KMS symmetric key. Restrict its IAM policy to the agent and integration worker.
- Create staging and production Sentry projects and configure immediate dead-letter alerts.
- Configure Apple Sign in client ID `com.shauryanarang.Retrospect`, capabilities, privacy declarations, and provisioning.
- Configure Google OAuth consent, callback URLs, readonly Drive/Docs/Gmail/YouTube scopes, verification, and Gmail security review.
- Configure Spotify and Reddit applications and callback URLs.
- Configure Pinterest only after API access is approved. Do not mark it continuous until a connector contract test passes.
- Configure TikTok Login Kit first for API-visible profile/video sync. Add Data Portability only after app review grants the required richer categories; do not treat it as the default onboarding path.
- Configure LinkedIn OIDC for limited profile sync only. Do not imply richer professional activity unless LinkedIn partner access is approved.
- Configure X only after the paid API tier, scopes, and per-month cost ceiling are approved. Do not configure Grok as a connectable source until an official consumer-history API exists.
- Do not show Netflix, ChatGPT, Claude, or Grok as default onboarding connections unless an official low-friction provider API exists. They may appear as optional advanced file imports, but that is fallback, not the main integration path.
- Create/update Render services from `render.staging.yaml` and `render.yaml`; the current deployment runs integration scheduling and worker loops inside the existing agent service. Split worker/scheduler into separate services later only when load or debugging pressure justifies it.
- Enable Supabase point-in-time recovery and daily backups for staging and production.

## Required Secrets

- API: Supabase keys, JWT secret, internal secret, Apple client ID, provider OAuth client credentials, Sentry DSN.
- Agent service: Supabase service key, internal secret, model keys, KMS key and AWS credentials, provider refresh credentials, Sentry DSN, and `ENABLE_INTEGRATION_RUNTIME=true`.
- Never put provider, model, service-role, or KMS credentials in the iOS application.

## Release Gates

- `/health/ready` returns `ready`.
- `npm run doctor` has no errors.
- `npm run integration:smoke` passes.
- Queue age stays below 15 minutes and dead-letter count is zero.
- Every production connector has a real-account successful sync, token refresh, pagination, idempotency, and revocation test.
- Every derived observation, hypothesis, and assertion has exact evidence.
- Tenant-isolation tests prove one user cannot read another user's connections, evidence, entities, or assertions.

## Recovery

- Worker crashes are recovered after lease expiry.
- Failed jobs retry with exponential backoff and enter `dead_letter` after their maximum attempts.
- Replay only through a new idempotency key and retain prior payload versions.
- Disconnect stops future collection. Delete-data removes stored assets, raw evidence, normalized items, graph evidence, and unsupported derived records.
- Perform quarterly database restore drills and record restoration time and data-loss window.

## Honest Source Status

- Device sync: Apple Health, Screen Time, Calendar, Apple Music, Photos, Contacts.
- Continuous OAuth sync implemented or planned behind credentials: Google Docs, Spotify, Reddit, YouTube API-visible data, TikTok API-visible profile/videos, LinkedIn OIDC profile, and X API-visible data.
- Restricted continuous sync: Gmail requires Google verification/security review before full production use.
- Approval-dependent sign-in sync: Pinterest, TikTok richer activity/Data Portability, LinkedIn richer professional data, and X paid/tier-scoped data.
- Not default-onboarding connectable: Grok history, Netflix viewing history, ChatGPT consumer history, and Claude consumer history until official low-friction APIs exist.
- Advanced import fallback: user-provided JSON, CSV, or ZIP imports may exist only if explicitly labeled as imports and never shown as ordinary connected integrations.
