import express from 'express';
import cors from 'cors';
import path from 'path';
import cron from 'node-cron';
import { config } from './config';
import { requireInternalSecret } from './middleware/internal-auth';
import { healthRouter } from './routes/health';
import { ingestRouter } from './routes/ingest';
import { cook0Router } from './routes/cook0';
import { podcastsRouter } from './routes/podcasts';
import { preferencesRouter } from './routes/preferences';
import { feedbackRouter } from './routes/feedback';
import { onboardingRouter } from './routes/onboarding';
import { runsRouter } from './routes/runs';
import { runDailyIngestion } from './jobs/daily-ingestion';
import { runWeeklyPodcasts } from './jobs/weekly-podcast';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const publicDir = path.join(__dirname, 'public');
app.use('/public', express.static(publicDir));

// Open routes (no auth): health checks + the developer-only /runs dashboard.
// /runs is not exposed publicly because the service is deployed as a Render
// private service (see render.yaml). In local dev it's reachable at localhost.
app.use('/health', healthRouter);
app.use('/runs', runsRouter);

app.get('/podcast-test', (_req, res) => {
  res.sendFile(path.join(publicDir, 'podcast-test.html'));
});

// Protected routes: require the shared INTERNAL_API_SECRET header set by the
// existing retrospect-api backend's agent-client.
app.use('/ingest', requireInternalSecret, ingestRouter);
app.use('/cook0', requireInternalSecret, cook0Router);
app.use('/podcasts', requireInternalSecret, podcastsRouter);
app.use('/preferences', requireInternalSecret, preferencesRouter);
app.use('/feedback', requireInternalSecret, feedbackRouter);
app.use('/onboarding', requireInternalSecret, onboardingRouter);

app.get('/', (_req, res) => {
  res.redirect('/runs');
});

app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[unhandled]', err);
    res.status(500).json({ error: err.message });
  }
);

const server = app.listen(config.server.port, () => {
  console.log(
    `\n  retrospect-agent listening on http://localhost:${config.server.port}\n  dashboard:  http://localhost:${config.server.port}/runs\n  env:        ${config.server.nodeEnv}\n`
  );
});

server.timeout = 600_000; // podcast generation can take a while
server.keepAliveTimeout = 120_000;

// In-process cron jobs. Gated behind ENABLE_AGENT_CRONS so we can deploy the
// service without it autonomously running ingestion/podcasts until we say so.
// Defaults to disabled — explicit opt-in via env var.
const cronsEnabled = process.env.ENABLE_AGENT_CRONS === 'true';

if (cronsEnabled) {
  // Daily ingestion at 5 AM UTC — safety net so journal entries that miss the
  // synchronous /content -> agent-client hook still get processed within 24h.
  cron.schedule('0 5 * * *', () => {
    console.log('[cron] daily-ingestion fired');
    runDailyIngestion().catch((err) => console.error('[cron] daily-ingestion error:', err));
  });

  // Weekly podcast at 6 AM UTC on Sundays — sole source of weekly episodes
  // once the legacy backend's weekly-podcast cron is disabled.
  cron.schedule('0 6 * * 0', () => {
    console.log('[cron] weekly-podcast fired');
    runWeeklyPodcasts().catch((err) => console.error('[cron] weekly-podcast error:', err));
  });

  console.log('[cron] agent crons enabled (daily ingest 5am UTC, weekly podcast Sun 6am UTC)');
} else {
  console.log(
    '[cron] agent crons disabled (set ENABLE_AGENT_CRONS=true to enable daily ingest + weekly podcast)'
  );
}

export default app;
