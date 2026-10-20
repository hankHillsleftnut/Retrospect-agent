#!/usr/bin/env tsx
/**
 * `npm run eval:search [-- --persona maya]`: gate S1 (goal 6). The F2 exam's
 * questions asked through search ("what we found"), scored with the same
 * rules: >= 80% right with receipts, and "nothing here" when the answer isn't
 * there. In a throwaway in-memory database; costs ~$0.60 a persona.
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { freshDatabase, insertUser } from '../tests/support/fresh-database';
import { supabaseOnPglite } from '../tests/support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { runIngest } from '../src/pipelines/ingest';
import { runPromoter } from '../src/brain/run-promoter';
import { searchAndAnswer } from '../src/search/answer';
import { scoreOne, scoreByAbility, type EvalQuestion } from '../src/eval/brain-eval';

const only = process.argv.includes('--persona') ? process.argv[process.argv.indexOf('--persona') + 1] : null;

(async () => {
  for (const f of readdirSync('tests/fixtures/eval').filter((x) => x.endsWith('.json'))) {
    const p = JSON.parse(readFileSync(join('tests/fixtures/eval', f), 'utf8')) as { persona: string; as_of: string; items: Array<{ id: string; date: string; content_type: string; trust: string; content: string; metadata?: object }>; questions: EvalQuestion[] };
    if (only && p.persona !== only) continue;
    const { db } = await freshDatabase();
    const fake = supabaseOnPglite(db);
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
    const user = await insertUser(db);
    const itemOf = new Map<string, string>();
    for (const i of p.items) {
      const { rows } = await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content, metadata, authorship, trust_class, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [user, i.content_type, i.content, JSON.stringify(i.metadata ?? {}), i.trust === 'own_words' ? 'self' : 'other', i.trust, `${i.date}T12:00:00Z`]);
      itemOf.set(rows[0]!.id, i.id);
    }
    for (let run = 0; run < 6; run++) if (!(await runIngest({ userId: user, daysBack: 3650, triggeredBy: 'manual', notes: `eval-search:${p.persona}` })).raw_content_processed) break;
    await runPromoter({ userId: user, lookbackDays: 3650 });

    const verdicts = [];
    let tokens = { in: 0, out: 0, cheapIn: 0, cheapOut: 0 }, ms = 0;
    for (const q of p.questions) {
      const t = Date.now();
      const r = await searchAndAnswer(user, q.question, { asOf: p.as_of });
      ms += Date.now() - t;
      tokens = { in: tokens.in + r.usage.write.inputTokens, out: tokens.out + r.usage.write.outputTokens, cheapIn: tokens.cheapIn + r.usage.rewrite.inputTokens + r.usage.guard.inputTokens, cheapOut: tokens.cheapOut + r.usage.rewrite.outputTokens + r.usage.guard.outputTokens };
      const cited = new Set(r.sources.filter((s) => s.kind === 'item').map((s) => itemOf.get(s.id)).filter(Boolean) as string[]);
      const v = scoreOne(q, { id: q.id, abstain: r.abstained, answer: r.summary, cites: [] }, r.abstained ? new Set() : cited);
      verdicts.push(v);
      if (!v.correct) console.log(`  ✗ ${q.id} ${q.question} — ${v.why}`);
    }
    const scores = scoreByAbility(verdicts);
    console.log(`\n${p.persona} through search:`);
    console.table(scores.map((s) => ({ ability: s.ability, score: `${s.correct}/${s.total}`, rate: `${Math.round(s.rate * 100)}%` })));
    const right = verdicts.filter((v) => v.correct).length;
    const cost = (tokens.in * 2 + tokens.out * 10 + tokens.cheapIn * 0.1 + tokens.cheapOut * 0.5) / 1e6;
    console.log(`overall ${right}/${verdicts.length} (${Math.round((right / verdicts.length) * 100)}%) · gate ${right / verdicts.length >= 0.8 ? 'PASSED' : 'FAILED'} · avg ${Math.round(ms / verdicts.length)} ms · questions $${cost.toFixed(3)}`);
    await db.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
