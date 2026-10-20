/**
 * `npm run eval:conversation`: gate F-V live part (goal 18), on the fictional
 * persona. 10 things she's just sending: it must say nothing or acknowledge.
 * 10 questions: it must answer in its first sentence, within budget.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { freshDatabase, insertUser } from '../tests/support/fresh-database';
import { supabaseOnPglite } from '../tests/support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { runIngest } from '../src/pipelines/ingest';
import { runPromoter } from '../src/brain/run-promoter';
import { converse } from '../src/conversation/reply';
import { sentenceBudget } from '../src/conversation/rules';

const FYI = ['Sending you this article on joinery', 'fyi class moved to Sunday', 'Saved a video about sanding', 'Just logging that I ran 5k', 'note to self: buy walnut', 'Here is the pricing spreadsheet', 'Dinner with Priya tonight', 'Booked physio for Thursday', 'Reading this later', 'ok'];
const QUESTIONS = ['What race did I sign up for?', 'When did I sell my first piece?', 'Where do I take woodworking classes?', 'How many times did I skip a Saturday run?', 'Who is my manager?', 'What did I say about the promotion?', 'Did I drop the half marathon?', 'What extra work did I take on in October?', 'What led to the physio appointment?', 'What have I been watching lately?'];
(async () => {
  const p = JSON.parse(readFileSync('tests/fixtures/eval/persona-maya.json', 'utf8'));
  const { db } = await freshDatabase(); const fake = supabaseOnPglite(db); Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const user = await insertUser(db);
  for (const i of p.items) await db.query(`INSERT INTO raw_content (user_id, content_type, content, metadata, trust_class, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [user, i.content_type, i.content, JSON.stringify(i.metadata ?? {}), i.trust, `${i.date}T12:00:00Z`]);
  for (let r = 0; r < 6; r++) if (!(await runIngest({ userId: user, daysBack: 3650, triggeredBy: 'manual' })).raw_content_processed) break;
  await runPromoter({ userId: user }).catch(() => undefined);
  let quiet = 0, answered = 0, overBudget = 0, cost = 0;
  const now = new Date(`${p.as_of}T18:00:00Z`);
  for (const t of FYI) {
    const r = await converse(user, t, { now }); cost += (r.usage.inputTokens * 3 + r.usage.outputTokens * 15) / 1e6;
    const ok = r.reply === '' || r.reply.split(/\s+/).length <= 4;
    if (ok) quiet++; console.log(`  ${ok ? '✓' : '✗'} fyi "${t}" → "${r.reply}"`);
  }
  for (const t of QUESTIONS) {
    const r = await converse(user, t, { now }); cost += (r.usage.inputTokens * 3 + r.usage.outputTokens * 15) / 1e6;
    const n = r.reply ? r.reply.split(/(?<=[.!?])\s+/).length : 0;
    if (n > sentenceBudget(t)) overBudget++;
    const ok = r.intent === 'question' && n >= 1;
    if (ok) answered++; console.log(`  ${ok ? "✓" : "✗"} q "${t}" → "${r.reply}"${r.cut.length ? ` (cut: ${r.cut.map((c) => c.reason).join(" | ")})` : ""}`);
  }
  console.log(`\nquiet on fyi ${quiet}/10 · answered questions ${answered}/10 · over budget ${overBudget} · $${cost.toFixed(3)}`);
  console.log(`gate F-V live ${quiet >= 9 && answered >= 8 && overBudget === 0 ? 'PASSED' : 'FAILED'} (bars: quiet ≥ 9, answered ≥ 8, over budget 0)`);
})();
