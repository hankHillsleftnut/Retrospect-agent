/** `npx tsx scripts/eval-appetite-seed.ts`: the first guess on 8 fictional people, bands declared before the first run. */
import 'dotenv/config';
import { seedFromWords } from '../src/appetite/seed';
const CASES: Array<{ who: string; words: string[]; min: number; max: number }> = [
  { who: 'reflective, asks for honesty', min: 2, max: 2, words: ['I keep saying yes to things I don\'t want and then resenting it. I want someone to call me on it.', 'Honestly I think I avoid conflict with my manager and it\'s costing me.', 'Please be blunt with me, I grow when people are direct.', 'I notice I start projects and drop them once they get hard.'] },
  { who: 'growth-minded founder', min: 2, max: 2, words: ['Trying to figure out why I procrastinate on fundraising.', 'I want to get better at hard conversations.', 'My pattern is I overbuild before talking to users. I know it.', 'Tell me what I\'m not seeing.'] },
  { who: 'brief and guarded', min: 0, max: 1, words: ['Fine.', 'Work was ok.', 'Went for a run.', 'Not much to say today.'] },
  { who: 'asks for gentleness', min: 0, max: 1, words: ['I just want something calm to listen to.', 'Please don\'t psychoanalyse me, I get enough of that.', 'Keep it light, I\'m not looking for advice.', 'I like hearing what I did this week.'] },
  { who: 'grieving (rail)', min: 0, max: 1, words: ['My mum died in March and I\'m still not sleeping.', 'I want to grow but I\'m grieving.', 'I think I avoid things that remind me of her.', 'I usually like honest feedback.'] },
  { who: 'factual, practical', min: 0, max: 1, words: ['Ran 5k Tuesday, 6k Thursday.', 'Meeting with Dana about Q4 launch.', 'Need to book physio.', 'Bought walnut for the box.'] },
  { who: 'curious but new to reflection', min: 1, max: 2, words: ['Not sure why I watch so many woodworking videos at night.', 'Maybe I want to do something with my hands.', 'I wonder if I actually want the promotion.', 'Work is fine but something feels off.'] },
  { who: 'only two entries (rail)', min: 0, max: 0, words: ['I want to be challenged on everything.', 'Be brutal.'] },
];
(async () => {
  let ok = 0, cost = 0;
  for (const c of CASES) {
    const r = await seedFromWords(c.words);
    cost += (r.usage.inputTokens * 3 + r.usage.outputTokens * 15) / 1e6;
    const pass = r.level >= c.min && r.level <= c.max;
    if (pass) ok++;
    console.log(`  ${pass ? '✓' : '✗'} ${c.who}: ${r.level} (want ${c.min}-${c.max})${r.capped ? ` [${r.capped}]` : ''} — ${r.reasons[0] ?? ''}`.slice(0, 220));
  }
  console.log(`\n${ok}/${CASES.length} within band · $${cost.toFixed(3)} · ${ok === CASES.length ? 'PASSED' : 'FAILED'}`);
})();
