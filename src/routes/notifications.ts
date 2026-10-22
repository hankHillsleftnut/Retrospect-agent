import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { config } from '../config';
import { NOTIFICATION_SYSTEM_PROMPT } from '../prompts/notification';
import { checkDailySpend, spendLimitedBody } from '../pipelines/spend-guard';
import { recordSpend, usageLines } from '../pipelines/spend-ledger';

interface NotificationVariant { title: string; body: string; }
interface NotificationResult {
  morning: NotificationVariant;
  evening: NotificationVariant;
  referenced?: string;
}

export type NotificationModel = (system: string, user: string) => Promise<{ data: NotificationResult; usage: ClaudeUsage }>;
export interface NotificationsDeps {
  model: NotificationModel;
  checkSpend: typeof checkDailySpend;
  recordSpend: typeof recordSpend;
}

const defaultModel: NotificationModel = (system, user) =>
  claudeJsonCompletion<NotificationResult>(system, user, { maxTokens: 500, model: config.anthropic.cookBModel });

export function makeNotificationsRouter(deps: Partial<NotificationsDeps> = {}): Router {
  const d: NotificationsDeps = { model: defaultModel, checkSpend: checkDailySpend, recordSpend, ...deps };
  const notificationsRouter = Router();

  /**
   * POST /notifications/generate
   * Body: { userId: string }
   *
   * Builds a personalized weekly notification (morning + evening variants) that
   * references something specific from the user's last week, so iOS can schedule
   * it at the receptive window. Returns both variants.
   */
  notificationsRouter.post('/generate', async (req, res) => {
    const { userId } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
      // The cap comes first: over it, no model is called (BEA.4).
      const spend = await d.checkSpend(userId);
      if (!spend.allowed) return res.status(429).json(spendLimitedBody(spend));

      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [obsRes, insRes, epRes, userRes] = await Promise.all([
        supabase
          .from(Tables.OBSERVATIONS)
          .select('content, observation_date')
          .eq('user_id', userId)
          .gte('observation_date', sinceIso)
          .order('observation_date', { ascending: false })
          .limit(40),
        supabase
          .from(Tables.INSIGHTS)
          .select('title, content, created_at')
          .eq('user_id', userId)
          .gte('updated_at', sinceIso)
          .order('updated_at', { ascending: false })
          .limit(10),
        supabase
          .from(Tables.PODCAST_EPISODES)
          .select('title, summary, created_at')
          .eq('user_id', userId)
          .eq('status', 'ready')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from(Tables.USERS).select('id').eq('id', userId).maybeSingle(),
      ]);

      if (!userRes.data) return res.status(404).json({ error: 'user not found' });

      const observations = (obsRes.data ?? []) as { content: string; observation_date: string }[];
      const insights = (insRes.data ?? []) as { title: string; content: string }[];
      const episode = epRes.data as { title: string; summary: string } | null;

      const obsBlock = observations.length
        ? `# This week's observations\n${observations.map((o) => `- (${o.observation_date.slice(0, 10)}) ${o.content}`).join('\n')}`
        : '# This week\'s observations\n(none)';
      const insBlock = insights.length
        ? `# Recent insights\n${insights.map((i) => `- ${i.title}: ${i.content}`).join('\n')}`
        : '# Recent insights\n(none)';
      const epBlock = episode
        ? `# Latest episode\n${episode.title}\n${episode.summary ?? ''}`
        : '# Latest episode\n(none yet)';

      const userMessage = `${obsBlock}\n\n${insBlock}\n\n${epBlock}\n\nWrite the morning and evening notification variants. Anchor on the single most specific, resonant detail. Return STRICT JSON.`;

      const { data, usage } = await d.model(NOTIFICATION_SYSTEM_PROMPT, userMessage);
      await d.recordSpend(userId, 'notification', usageLines([{ model: config.anthropic.cookBModel, usage }]));

      // Defensive normalization
      const clean = (v: Partial<NotificationVariant> | undefined): NotificationVariant => ({
        title: typeof v?.title === 'string' ? v.title : 'A note about your week',
        body: typeof v?.body === 'string' ? v.body : 'Want to hear what I noticed?',
      });

      return res.json({
        morning: clean(data.morning),
        evening: clean(data.evening),
        referenced: data.referenced ?? null,
        hadData: observations.length > 0 || insights.length > 0 || !!episode,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return notificationsRouter;
}

export const notificationsRouter = makeNotificationsRouter();
