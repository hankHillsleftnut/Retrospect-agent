import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannerV2For } from '../src/pipelines/podcast';

test('the new episode path is off unless switched on, for everyone or for named people', () => {
  assert.equal(plannerV2For('u1', {}), false);
  assert.equal(plannerV2For('u1', { EPISODE_PLANNER: 'v2' }), true);
  assert.equal(plannerV2For('u1', { EPISODE_PLANNER_V2_USERS: 'u0, u1' }), true);
  assert.equal(plannerV2For('u2', { EPISODE_PLANNER_V2_USERS: 'u0, u1' }), false);
});
