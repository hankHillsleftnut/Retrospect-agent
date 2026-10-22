import { completeDocument } from '../brain/complete-document';
import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runMagicMoments as runMagicMomentsEngine } from '../pipelines/magic-moments';
import { extractStatedGoals as extractStatedGoalsEngine } from '../onboarding/stated-goals';
import { checkDailySpend, spendLimitedBody } from '../pipelines/spend-guard';
import { recordSpend, usageLines } from '../pipelines/spend-ledger';
import { loadOnboardingFacts, stageFor, advanceOnboarding } from '../onboarding/pipeline';
import { defaultAdvanceDeps } from '../jobs/onboarding-pipeline';
import { writeNewDocumentVersion } from '../agents/cook0-agent';
import type { DbUserUnderstanding, MagicMoment, UserUnderstandingDocument } from '../types';

export interface OnboardingDeps {
  runMagicMoments: typeof runMagicMomentsEngine;
  extractStatedGoals: typeof extractStatedGoalsEngine;
  checkSpend: typeof checkDailySpend;
  recordSpend: typeof recordSpend;
}

export function makeOnboardingRouter(deps: Partial<OnboardingDeps> = {}): Router {
  const d: OnboardingDeps = { runMagicMoments: runMagicMomentsEngine, extractStatedGoals: extractStatedGoalsEngine, checkSpend: checkDailySpend, recordSpend, ...deps };
  const onboardingRouter = Router();

  /**
   * POST /onboarding/interpret
   * Body: { userId: string, keep?: number }
   *
   * Runs the magic-moments interpretation engine on the user's onboarding
   * answers + integration data, then seeds/enriches their User Understanding
   * Document with the top moments as TRACKED HYPOTHESES (stored in
   * emerging_dimensions so Cook 0 keeps testing them every week).
   *
   * Returns the moments so the caller can drive the first podcast / a teaser.
   */
  onboardingRouter.post('/interpret', async (req, res) => {
    const { userId, keep } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
      // The cap comes first: over it, no model is called (BEA.4).
      const spend = await d.checkSpend(userId);
      if (!spend.allowed) return res.status(429).json(spendLimitedBody(spend));
      const result = await d.runMagicMoments({ userId, keep: keep ?? 2 });
      await d.recordSpend(userId, 'onboarding_interpret', result.cost);

      if (result.moments.length === 0) {
        return res.json({
          moments: [],
          documentVersion: null,
          note: 'No magic moments produced — likely thin onboarding + no integrations.',
          notes: result.notes,
          hadOnboarding: result.hadOnboarding,
          integrationTypes: result.integrationTypes,
        });
      }

      // Load the latest document (ingestion may have created a cold-start one already).
      const { data: latest } = await supabase
        .from(Tables.USER_UNDERSTANDING)
        .select('*')
        .eq('user_id', userId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      const prior = (latest as DbUserUnderstanding | null)?.document ?? null;
      const merged = mergeMomentsIntoDocument(prior, result.moments);

      const version = await writeNewDocumentVersion({
        userId,
        document: merged,
        generationNotes: `Seeded ${result.moments.length} magic moment(s) from onboarding interpretation: ${result.moments
          .map((m) => m.structure)
          .join(', ')}.`,
        inferenceIdsAtVersion: (latest as DbUserUnderstanding | null)?.inference_ids_at_version ?? [],
        sourceIngestionRunId: null,
      });

      return res.json({
        moments: result.moments,
        documentVersion: version,
        notes: result.notes,
        hadOnboarding: result.hadOnboarding,
        integrationTypes: result.integrationTypes,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Merge magic moments into the document. They become:
   *  - emerging_dimensions entries (label "magic-moment:<structure>") so Cook 0
   *    carries + evolves them every ingestion run (this is the long-term wiring)
   *  - a forward_focus that tells Cook A/B what to watch for next
   */
  function mergeMomentsIntoDocument(
    prior: UserUnderstandingDocument | null,
    moments: MagicMoment[]
  ): UserUnderstandingDocument {
    const base: UserUnderstandingDocument = completeDocument(prior) ?? {
      identity_core: '(seeded from onboarding interpretation — Cook 0 will flesh this out on first ingestion)',
      active_goals: [],
      behavioral_patterns: '',
      emotional_baseline: '',
      live_tensions: [],
      track_record: '(first week — no history yet)',
      forward_focus: '',
      emerging_dimensions: [],
    };

    const now = new Date().toISOString();

    // Drop any prior magic-moment dimensions so re-running replaces cleanly.
    const keptDimensions = base.emerging_dimensions.filter(
      (d) => !d.label.startsWith('magic-moment:')
    );

    const momentDimensions = moments.map((m) => ({
      label: `magic-moment:${m.structure}`,
      content: `HYPOTHESIS (seeded from onboarding): ${m.pattern}
  Evidence at seed time: ${m.evidence}
  Reframe for episode: ${m.reframe}
  Watch for: ${m.hypothesis}`,
      first_seen_at: now,
    }));

    const forwardFocus = `Two magic-moment hypotheses to test and surface in early episodes:
  ${moments
    .map((m, i) => `${i + 1}. [${m.structure}] ${m.reframe} — confirm by: ${m.hypothesis}`)
    .join('\n')}`;

    return {
      ...base,
      forward_focus: forwardFocus,
      emerging_dimensions: [...keptDimensions, ...momentDimensions],
    };
  }

  /**
   * POST /onboarding/goals
   * Body: { userId: string, answersText: string }
   *
   * The goals the person stated in onboarding, from one model call over their
   * answers (src/onboarding/stated-goals.ts). Seconds, not the minutes the full
   * pipeline took. Saves nothing: the backend stores the goals it shows.
   */
  onboardingRouter.post('/goals', async (req, res) => {
    const { userId, answersText } = req.body ?? {};
    if (!userId || typeof answersText !== 'string') {
      return res.status(400).json({ error: 'userId and answersText required' });
    }
    try {
      // The cap comes first: over it, no model is called (BEA.4).
      const spend = await d.checkSpend(userId);
      if (!spend.allowed) return res.status(429).json(spendLimitedBody(spend));
      const result = await d.extractStatedGoals(answersText);
      const cost = usageLines([{ model: result.model, usage: result.usage }]);
      const usd = await d.recordSpend(userId, 'onboarding_goals', cost);
      console.log(`[onboarding/goals] user=${userId} goals=${result.goals.length} dropped=${result.dropped} $${usd.toFixed(4)}`);
      return res.json({ goals: result.goals, dropped: result.dropped, cost });
    } catch (err) {
      console.error('[onboarding/goals] failed:', err);
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * GET /onboarding/readiness/:userId -- where this person is: reading,
   * understanding, making_episode, or ready. The app polls this to bring them in
   * once their first episode is ready, without a tap.
   */
  onboardingRouter.get('/readiness/:userId', async (req, res) => {
    try {
      const facts = await loadOnboardingFacts(req.params.userId);
      return res.json({ stage: stageFor(facts, new Date()), facts });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * POST /onboarding/advance { userId } -- take the next step now instead of waiting for the next tick.
   * Not refused at the door: reading is never refused, and the episode step checks the cap itself
   * (mayMakeEpisode), answering { action: 'over_spending_limit' } rather than stranding the onboarding.
   */
  onboardingRouter.post('/advance', async (req, res) => {
    const { userId } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
      return res.json(await advanceOnboarding(userId, defaultAdvanceDeps));
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return onboardingRouter;
}

export const onboardingRouter = makeOnboardingRouter();
