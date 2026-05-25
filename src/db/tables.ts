/**
 * Centralized table name constants — shared with Retrospect's existing schema.
 * Tables introduced by this project are marked NEW.
 */
export const Tables = {
  USERS: 'users',
  RAW_CONTENT: 'raw_content',
  GOALS: 'goals',
  OBSERVATIONS: 'observations',
  INSIGHTS: 'insights',
  PODCAST_EPISODES: 'podcast_episodes',
  PIPELINE_RUNS: 'pipeline_runs',
  // NEW (added by 100_agent_extensions.sql)
  USER_PREFERENCES: 'user_preferences',
  GOAL_CANDIDATES: 'goal_candidates',
  EPISODE_FEEDBACK: 'episode_feedback',
  // NEW (added by 101_pipeline_run_traces.sql)
  PIPELINE_RUN_TRACES: 'pipeline_run_traces',
} as const;
