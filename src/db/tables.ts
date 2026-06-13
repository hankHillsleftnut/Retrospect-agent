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
  // NEW (added by 102_identity_inferences.sql)
  IDENTITY_INFERENCES: 'identity_inferences',
  // NEW (added by 103_user_understanding.sql)
  USER_UNDERSTANDING: 'user_understanding',
  // NEW (added by 105_graph_edges.sql) — MVP knowledge graph
  GRAPH_EDGES: 'graph_edges',
} as const;
