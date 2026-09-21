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
  // Integration collection, normalization, and exact provenance
  INTEGRATION_CONNECTIONS: 'integration_connections',
  INTEGRATION_SYNC_STATES: 'integration_sync_states',
  INTEGRATION_JOBS: 'integration_jobs',
  INTEGRATION_CREDENTIALS: 'integration_credentials',
  INTEGRATION_IMPORTS: 'integration_imports',
  SOURCE_ASSETS: 'source_assets',
  INTEGRATION_AUDIT_EVENTS: 'integration_audit_events',
  INTEGRATION_OAUTH_STATES: 'integration_oauth_states',
  INTEGRATION_SYNC_RUNS: 'integration_sync_runs',
  SOURCE_PAYLOADS: 'source_payloads',
  SOURCE_ITEMS: 'source_items',
  SOURCE_ITEM_RELATIONS: 'source_item_relations',
  ANALYSIS_UNITS: 'analysis_units',
  EVIDENCE_LINKS: 'evidence_links',
  INTEGRATION_TEST_RUNS: 'integration_test_runs',
  BEHAVIOR_PATTERNS: 'behavior_patterns',
  BEHAVIOR_PATTERN_FACTS: 'behavior_pattern_facts',
  BEHAVIOR_PATTERN_WHYS: 'behavior_pattern_whys',
  LINT_FINDINGS: 'lint_findings',
  REMEDIATION_LOG: 'remediation_log',
  ENTITIES: 'entities',
  ENTITY_ALIASES: 'entity_aliases',
  ENTITY_RESOLUTION_CANDIDATES: 'entity_resolution_candidates',
  ASSERTIONS: 'assertions',
  ASSERTION_EVIDENCE: 'assertion_evidence',
  ASSERTION_RELATIONS: 'assertion_relations',
} as const;
