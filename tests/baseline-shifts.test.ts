/** W3.4 gate: a real shift is found; a normal week finds none. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineShifts, mannWhitneyP } from '../src/brain/baseline-shifts';
import type { DailySummary } from '../src/brain/daily-summaries';

const TODAY = '2026-10-19';
const day = (offset: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - offset * 864e5).toISOString().slice(0, 10);
const cal = (offset: number, hours: number): DailySummary => ({ day: day(offset), domain: 'calendar', items: 1, source_ids: [`c${offset}`], metrics: { hours_booked: hours, with_others: 0 } });
const steps = (offset: number, n: number): DailySummary => ({ day: day(offset), domain: 'health', items: 1, source_ids: [`h${offset}`], metrics: { steps: n } });
// A wobbly but stable baseline: 2-4 hours a day.
const wobble = (o: number) => 2 + ((o * 7) % 5) / 2;

test('a week of much heavier meetings is found, with its counts and items', () => {
  const s = [...Array.from({ length: 28 }, (_, i) => cal(i + 7, wobble(i))), ...Array.from({ length: 7 }, (_, i) => cal(i, 7 + (i % 2)))];
  const shifts = baselineShifts(s, TODAY);
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0]!.metric, 'hours_booked');
  assert.equal(shifts[0]!.direction, 'up');
  assert.equal(shifts[0]!.recentDays, 7);
  assert.equal(shifts[0]!.sourceIds.length, 7);
});

test('a normal week finds nothing', () => {
  const s = Array.from({ length: 35 }, (_, i) => cal(i, wobble(i)));
  assert.deepEqual(baselineShifts(s, TODAY), []);
});

test('a calendar connected this week has no baseline: nothing is claimed', () => {
  assert.deepEqual(baselineShifts(Array.from({ length: 7 }, (_, i) => cal(i, 9)), TODAY), []);
});

test('unrecorded health days are not zeros: three low days among missing ones say nothing', () => {
  const s = [...Array.from({ length: 28 }, (_, i) => steps(i + 7, 8000 + i * 10)), steps(0, 1000), steps(2, 1100), steps(4, 900)];
  assert.deepEqual(baselineShifts(s, TODAY), [], 'only 3 recorded days this week, below the minimum of 4');
});

test('it reports drops as readily as rises', () => {
  const s = [...Array.from({ length: 28 }, (_, i) => steps(i + 7, 9000 + (i % 4) * 300)), ...Array.from({ length: 7 }, (_, i) => steps(i, 3000 + i * 50))];
  const [shift] = baselineShifts(s, TODAY);
  assert.equal(shift!.direction, 'down');
});

test('a small but consistent change is not worth saying', () => {
  const s = [...Array.from({ length: 28 }, (_, i) => steps(i + 7, 8000)), ...Array.from({ length: 7 }, (_, i) => steps(i, 8800))];
  assert.deepEqual(baselineShifts(s, TODAY), [], '+10% is under the 25% bar');
});

test('the rank test agrees with a known case', () => {
  assert.ok(mannWhitneyP([1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12]) < 0.05);
  assert.ok(mannWhitneyP([3, 5, 4, 6], [4, 5, 3, 6, 5, 4, 6, 3]) > 0.5);
});
