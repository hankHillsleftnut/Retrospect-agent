import { Router } from 'express';
import { supabase } from '../db/supabase';
import { answerHypothesis, loadOfferable, readHypothesisDial } from '../hypotheses/offer';
import { evidenceLines } from '../hypotheses/propose';
import { FRAMEWORKS, type FrameworkId } from '../hypotheses/validate';
import { readUnderstanding as readUnderstandingEngine } from '../understanding/read';

/**
 * Goal 21 for the app: the open guesses, decline in one word, and "why do you
 * think that" always has an answer. The backend's guess doors (BE1.4) read
 * these; the door checks ownership itself and maps the shapes to contract 02.
 */
export interface HypothesesDeps {
  readUnderstanding: typeof readUnderstandingEngine;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What one guess rests on: ids from the row, words from the contract (the door shows them, the agent keeps ids). */
export interface RestsOn { kind: string; id: string; text: string }
export interface PendingGuess {
  id: string;
  question: string;
  framework: { name: string; source?: string; wonders?: string };
  rationale: string | null;
  /** A never-offered ('stored') guess is reported as 'offered': listing it is the offer (pass F9). */
  status: 'offered';
  restsOn: RestsOn[];
  createdAt: string;
}

function frameworkOf(id: string): PendingGuess['framework'] {
  const f = FRAMEWORKS[id as FrameworkId];
  return f ? { name: f.name, source: f.cite, wonders: f.wonders } : { name: id };
}

export function makeHypothesesRouter(deps: Partial<HypothesesDeps> = {}): Router {
  const d: HypothesesDeps = { readUnderstanding: readUnderstandingEngine, ...deps };
  const router = Router();

  /**
   * GET /hypotheses/:userId/pending -- the guesses the journal may show: every stored or
   * offered row whose evidence is still believed (chooseOffer's rule, applied to every row),
   * newest first, with the words each rests on. Never marks anything offered: offered_count
   * and the 14-day rule belong to the episode, or a daily listing would burn a guess's two
   * offers in two days (pass F8). `speaking` is the founder's dial; false means `[]`.
   */
  router.get('/:userId/pending', async (req, res) => {
    const { userId } = req.params;
    if (!UUID.test(userId)) return res.status(400).json({ error: 'userId must be an id' });
    try {
      const dial = await readHypothesisDial();
      if (!dial.speak) return res.json({ speaking: false, guesses: [] });
      const [rows, contract] = await Promise.all([loadOfferable(userId), d.readUnderstanding(userId)]);
      const lines = new Map(evidenceLines(contract).map((l) => [`${l.kind}:${l.id}`, l.text]));
      const guesses: PendingGuess[] = [];
      for (const r of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
        const restsOn = r.supports.map((s) => ({ kind: s.kind, id: s.id, text: lines.get(`${s.kind}:${s.id}`) ?? '' }));
        // Everything it rests on must still be believed and spoken-of; otherwise it waits (goal 21).
        if (restsOn.some((e) => !e.text)) continue;
        guesses.push({ id: r.id, question: r.question, framework: frameworkOf(r.framework), rationale: r.rationale, status: 'offered', restsOn, createdAt: r.created_at });
      }
      return res.json({ speaking: true, guesses });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST /hypotheses/:userId/:id { verdict: "yes" | "no" } */
  router.post('/:userId/:id', async (req, res) => {
    const verdict = req.body?.verdict;
    if (verdict !== 'yes' && verdict !== 'no') return res.status(400).json({ error: 'verdict "yes" or "no"' });
    try { return res.json(await answerHypothesis(req.params.userId, req.params.id, verdict)); }
    catch (err) { return res.status(404).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  /** GET /hypotheses/:userId/:id/why: the framework it comes from and what it rests on, in words. */
  router.get('/:userId/:id/why', async (req, res) => {
    const { userId, id } = req.params;
    const { data, error } = await supabase.from('hypotheses').select('question,framework,rationale,supports,status,created_at').eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found' });
    const h = data as { question: string; framework: string; rationale: string | null; supports: Array<{ kind: string; id: string }>; status: string; created_at: string };
    try {
      const lines = new Map(evidenceLines(await d.readUnderstanding(userId)).map((l) => [`${l.kind}:${l.id}`, l.text]));
      return res.json({
        id, question: h.question, status: h.status === 'stored' ? 'offered' : h.status, framework: frameworkOf(h.framework), rationale: h.rationale,
        restsOn: (h.supports ?? []).map((s) => ({ kind: s.kind, id: s.id, text: lines.get(`${s.kind}:${s.id}`) ?? '' })), createdAt: h.created_at,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}

export const hypothesesRouter = makeHypothesesRouter();
