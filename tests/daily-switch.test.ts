import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyV2For } from '../src/briefs/run-daily-brief-v2';

test('the new daily path is off unless switched on, for everyone or named people', () => {
  assert.equal(dailyV2For('u', {}), false);
  assert.equal(dailyV2For('u', { DAILY_PLANNER: 'v2' }), true);
  assert.equal(dailyV2For('u', { DAILY_PLANNER_V2_USERS: 'a,u' }), true);
});
