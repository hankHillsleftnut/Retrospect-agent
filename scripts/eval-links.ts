/**
 * `npm run eval:links`: gate R1.5 (goal 23). 50 saved links, each with the
 * person's reason, among a fictional person's other material. Each is searched
 * for by why it was saved (half paraphrased); it passes if the link is in the
 * top 5. And saved links may support no claim about the person (0 answers moved).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { freshDatabase, insertUser } from '../tests/support/fresh-database';
import { supabaseOnPglite } from '../tests/support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { searchPerson } from '../src/search/search';
import { SELF_PREDICATES_BY_CLASS } from '../src/brain/trust';
import { embedSaved } from '../src/reference/embed';

type Link = { url: string; title: string; summary: string; intent: string; query: string; paraphrase: boolean };

(async () => {
  const gate = JSON.parse(readFileSync('tests/fixtures/gates/r1-links.json', 'utf8')) as { bar: { found_top5_rate: number }; cases: Link[] };
  const maya = JSON.parse(readFileSync('tests/fixtures/eval/persona-maya.json', 'utf8')) as { items: Array<{ date: string; content_type: string; trust: string; content: string }> };
  const { db } = await freshDatabase();
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const user = await insertUser(db);

  for (const i of maya.items) await db.query(`INSERT INTO raw_content (user_id, content_type, content, trust_class, created_at) VALUES ($1, $2, $3, $4, $5)`, [user, i.content_type, i.content, i.trust, `${i.date}T12:00:00Z`]);
  const ids = new Map<string, Set<string>>();
  for (const l of gate.cases) {
    const { rows: [raw] } = await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content, trust_class) VALUES ($1, 'shared_link', $2, 'reference') RETURNING id`, [user, `${l.url} ${l.intent}`]);
    const { rows: [ref] } = await db.query<{ id: string }>(`INSERT INTO reference_items (user_id, raw_content_id, url, intent, title, summary, status) VALUES ($1, $2, $3, $4, $5, $6, 'enriched') RETURNING id`, [user, raw!.id, l.url, l.intent, l.title, l.summary]);
    ids.set(l.url, new Set([raw!.id, ref!.id]));
  }

  console.log(`saved links embedded: ${await embedSaved(user)}`);
  let found = 0, foundPara = 0;
  for (const l of gate.cases) {
    const hits = (await searchPerson(user, l.query, { limit: 15 })).slice(0, 5);
    const ok = hits.some((h) => ids.get(l.url)!.has(h.id));
    if (ok) { found++; if (l.paraphrase) foundPara++; } else console.log(`  ✗ "${l.query}" (${l.paraphrase ? 'paraphrase' : 'shares a word'}) → ${l.title}`);
  }
  const paras = gate.cases.filter((l) => l.paraphrase).length;
  const moved = SELF_PREDICATES_BY_CLASS.reference.size;
  const rate = found / gate.cases.length;
  console.log(`\nfound in top 5: ${found}/${gate.cases.length} (${Math.round(rate * 100)}%) · paraphrased ${foundPara}/${paras} · shares a word ${found - foundPara}/${gate.cases.length - paras}`);
  console.log(`claims about the person a saved link may support: ${moved} (must be 0)`);
  console.log(`gate R1.5 ${rate >= gate.bar.found_top5_rate && moved === 0 ? 'PASSED' : 'FAILED'} (bar ${gate.bar.found_top5_rate * 100}%)`);
})();
