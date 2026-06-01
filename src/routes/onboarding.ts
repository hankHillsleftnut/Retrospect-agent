import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runMagicMoments } from '../pipelines/magic-moments';
import { writeNewDocumentVersion } from '../agents/cook0-agent';
import type { DbUserUnderstanding, MagicMoment, UserUnderstandingDocument } from '../types';

export const onboardingRouter = Router();

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
    const result = await runMagicMoments({ userId, keep: keep ?? 2 });

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
  const base: UserUnderstandingDocument = prior ?? {
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
