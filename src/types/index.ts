// ============================================
// Core DB row types (subset of fields we use)
// ============================================

export interface DbUser {
  id: string;
  apple_user_id: string;
  email?: string | null;
  voice_persona?: VoicePersona | null;
  created_at: string;
  updated_at: string;
}

export interface DbGoal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  embedding?: number[] | string | null;
  created_at: string;
  updated_at: string;
}

export interface DbRawContent {
  id: string;
  user_id: string;
  content: string;
  content_type: string;
  content_date: string | null;
  processing_status: string;
  processing_started_at?: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
  source_item_id?: string | null;
  /** Present once the source has been embedded for fallback search. */
  embedding?: number[] | null;
  processed_at?: string | null;
  processing_error?: string | null;
}

export type IntegrationCollectionMode = 'native_ios' | 'oauth_api' | 'data_export';
export type IntegrationRunType =
  | 'initial_backfill'
  | 'incremental_sync'
  | 'webhook_recovery'
  | 'replay'
  | 'export_import';

export type IntegrationJobType =
  | 'initial_backfill'
  | 'incremental_sync'
  | 'webhook_recovery'
  | 'replay'
  | 'export_import'
  | 'device_batch'
  | 'oauth_sync'
  | 'archive_parse'
  | 'reconcile'
  | 'delete_connection_data';

export interface IntegrationJob {
  id: string;
  user_id: string;
  connection_id: string;
  job_type: IntegrationJobType;
  status: 'queued' | 'leased' | 'running' | 'completed' | 'failed' | 'dead_letter' | 'cancelled';
  attempt_count: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  lease_owner: string | null;
  leased_until: string | null;
}

export interface IntegrationSourceItemInput {
  providerObjectType: string;
  providerObjectId: string;
  payload: Record<string, unknown>;
  canonicalType: string;
  canonicalText: string;
  normalizedData: Record<string, unknown>;
  occurredAt?: string;
  analysisEligible?: boolean;
  providerCreatedAt?: string;
  providerUpdatedAt?: string;
  parserVersion: string;
  normalizerVersion: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

export interface ProcessIntegrationBatchInput {
  userId: string;
  providerId: string;
  collectionMode: IntegrationCollectionMode;
  runType: IntegrationRunType;
  cursorBefore: Record<string, unknown>;
  cursorAfter: Record<string, unknown>;
  items: IntegrationSourceItemInput[];
}

export interface ProcessIntegrationBatchResult {
  syncRunId: string;
  ingestionTraceId: string | null;
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  itemsFailed: number;
  rawContentIds: string[];
  failures: { providerObjectId: string; error: string }[];
}

export interface DbObservation {
  id: string;
  user_id: string;
  goal_id: string | null;
  raw_content_id: string | null;
  content: string;
  reason_why: string;
  confidence_score: number;
  observation_date: string;
  is_goal_candidate?: boolean;
  embedding?: number[] | string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface DbInsight {
  id: string;
  user_id: string;
  goal_id: string;
  title: string;
  content: string;
  evidence_summary: string;
  supporting_observation_ids: string[];
  confidence_score: number;
  time_range_start: string | null;
  time_range_end: string | null;
  embedding?: number[] | string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbPodcastEpisode {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  script: string;
  audio_url: string | null;
  duration_seconds: number | null;
  mood: string | null;
  status: 'generating' | 'ready' | 'failed';
  generation_type: 'weekly' | 'on_demand' | 'milestone';
  insight_ids: string[];
  goal_ids: string[];
  outline?: Record<string, unknown>;
  research_citations?: unknown[];
  episode_number: number | null;
  covers_period_start: string | null;
  covers_period_end: string | null;
  previous_episode_id: string | null;
  topics_covered: string[];
  summary?: string | null;
  summary_embedding?: number[] | string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbUserPreferences {
  id: string;
  user_id: string;
  tone: string | null;
  trusted_voice_description: string | null;
  focus_areas: string[];
  avoid_topics: string[];
  directives: { date: string; text: string; source: 'feedback' | 'manual' }[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbGoalCandidate {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  reasoning: string;
  supporting_observation_ids: string[];
  confidence_score: number;
  status: 'pending' | 'accepted' | 'rejected' | 'merged';
  accepted_as_goal_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbEpisodeFeedback {
  id: string;
  user_id: string;
  episode_id: string;
  feedback_text: string;
  rating: number | null;
  source: 'manual' | 'voice' | 'tap';
  processed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ============================================
// Voice personas (mirror Retrospect)
// ============================================
export type VoicePersona = 'thoughtful_friend' | 'wise_mentor' | 'energetic_host';

// ============================================
// Pipeline shapes
// ============================================

export interface OutlineV1 {
  theme: string;
  segments: OutlineV1Segment[];
  estimatedMinutes: number;
}

export interface OutlineV1Segment {
  title: string;
  type: string;
  insightIds: string[];
  goalIds: string[];
  observationIds?: string[];
  talkingPoints: string[];
  estimatedSeconds: number;
}

export interface OutlineV2 extends OutlineV1 {
  historicalConnections: HistoricalConnection[];
  notRealizedYet: NotRealizedHint[];
  researchFindings: ResearchFinding[];
  toolCallsSummary?: string;
}

export interface HistoricalConnection {
  description: string;
  insightIds?: string[];
  observationIds?: string[];
  previousEpisodeIds?: string[];
}

export type PatternType =
  | 'hidden_strength'
  | 'distortion_habit'
  | 'discounting_system'
  | 'thought_behavior_cycle'
  | 'progress_signal'
  | 'self_esteem_blocker';

export interface NotRealizedHint {
  patternType?: PatternType;
  pattern: string;
  evidenceObservationIds: string[];
  hintApproach: string;
}

export interface ResearchFinding {
  query: string;
  summary: string;
  citations: { source: string; url?: string }[];
}

export interface AgentToolCall {
  iteration: number;
  tool: string;
  arguments: Record<string, unknown>;
  result_preview: string;
  result_count?: number;
  duration_ms: number;
  ts: string;
}

/** Controlled predicate vocabulary for Fact candidates. Free predicates are
 *  allowed but make pattern grouping harder -- prefer this list.
 *  docs/second-brain/04 "Extraction". */
export type FactPredicate =
  | 'stated_goal'
  | 'quit_or_stopped'
  | 'skipped_or_avoided'
  | 'attended'
  | 'said_about_self'
  | 'mentioned_person'
  | 'felt'
  | 'health_metric'
  | 'scheduled'
  | 'communicated_with';

/** One checkable claim proposed by the extractor. Not yet a Fact: it becomes
 *  one only if its excerpt is verified against the source. */
export interface FactCandidate {
  /** "Self" or a person's name as written. */
  subject: string;
  predicate: FactPredicate | string;
  object: string;
  /** ISO date if the text states when it happened. */
  event_time?: string | null;
  /** MUST be copied verbatim from the source. Unverifiable excerpt = dropped. */
  excerpt: string;
  /** Index into the raw content array the excerpt came from. */
  source_index: number;
  severity_hint?: 'standard' | 'high' | 'extreme';
  /** The user naming their own loop ("I always start things and don't finish").
   *  Seeds a pattern candidate; never promotes one on its own. */
  names_own_loop?: boolean;
}

export interface IngestionResult {
  fact_candidates?: FactCandidate[];
  observations: {
    content: string;
    reason_why: string;
    confidence_score: number;
    goal_id: string | null;
    is_goal_candidate: boolean;
    raw_content_id?: string | null;
    supporting_raw_content_indexes?: number[];
  }[];
  insights: {
    title: string;
    content: string;
    evidence_summary: string;
    confidence_score: number;
    goal_id: string;
    supporting_observation_indexes: number[];
  }[];
  goal_candidates: {
    title: string;
    description: string;
    reasoning: string;
    confidence_score: number;
    supporting_observation_indexes: number[];
  }[];
  identity_inferences: IdentityInferenceDraft[];
  processingNotes?: string;
}

// ============================================
// Identity inferences — first-class output from ingestion
// (separate from observations; answer "who is this person?")
// ============================================

export type IdentityDomain =
  | 'self_concept'
  | 'emotional'
  | 'work_achievement'
  | 'relational'
  | 'physical'
  | 'cognitive'
  | 'emerging';

/** Shape returned by the ingestion LLM. References evidence by index into the run's arrays. */
export interface IdentityInferenceDraft {
  content: string;
  domain: IdentityDomain;
  /** Only required when domain === 'emerging' — names the new category. */
  domain_label?: string | null;
  confidence_score: number;
  is_provisional: boolean;
  evidence_summary?: string | null;
  supporting_raw_content_indexes?: number[];
  supporting_observation_indexes?: number[];
}

export interface DbIdentityInference {
  id: string;
  user_id: string;
  content: string;
  domain: IdentityDomain;
  domain_label: string | null;
  confidence_score: number;
  is_provisional: boolean;
  evidence_summary: string | null;
  supporting_raw_content_ids: string[];
  supporting_observation_ids: string[];
  superseded_by: string | null;
  corroborated_by: string[];
  retired_at: string | null;
  retirement_reason: string | null;
  embedding?: number[] | string | null;
  source_ingestion_run_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// Knowledge Graph (MVP) — first-class typed edges over existing nodes.
// Backed by graph_edges (105_graph_edges.sql). Nodes are existing rows
// referenced polymorphically by (type, id); no separate nodes table yet.
// ============================================

export type GraphNodeType =
  | 'observation'
  | 'insight'
  | 'identity_inference'
  | 'goal'
  | 'goal_candidate'
  | 'raw_content';

export type GraphEdgeType =
  | 'derived_from'
  | 'evidence_for'
  | 'relates_to_goal'
  | 'supports'
  | 'contradicts'
  | 'tension_with';

export interface DbGraphEdge {
  id: string;
  user_id: string;
  from_type: GraphNodeType;
  from_id: string;
  to_type: GraphNodeType;
  to_id: string;
  edge_type: GraphEdgeType;
  weight: number | null;
  metadata: Record<string, unknown>;
  source_run_id: string | null;
  superseded_by: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// User Understanding Document — bounded self-model produced by Cook 0
// ============================================

export interface UserUnderstandingDocument {
  identity_core: string;
  active_goals: {
    goal_id: string | null;
    title: string;
    what_its_really_about: string;
  }[];
  behavioral_patterns: string;
  emotional_baseline: string;
  live_tensions: string[];
  track_record: string;
  forward_focus: string;
  emerging_dimensions: {
    label: string;
    content: string;
    first_seen_at: string;
  }[];
}

export interface DbUserUnderstanding {
  id: string;
  user_id: string;
  version: number;
  document: UserUnderstandingDocument;
  inference_ids_at_version: string[];
  generation_notes: string | null;
  source_ingestion_run_id: string | null;
  model: string | null;
  created_at: string;
}

// ============================================
// Magic Moments — onboarding interpretation output
// ============================================

export type MagicMomentStructure =
  | 'transferred_capability'
  | 'defended_fear'
  | 'contradiction'
  | 'the_gap'
  | 'already_knowing'
  | 'the_condition';

export interface MagicMoment {
  structure: MagicMomentStructure;
  title: string;
  pattern: string;
  evidence: string;
  reframe: string;
  future_self_line: string | null;
  hypothesis: string;
  strength: number;
}

export interface MagicMomentsResult {
  moments: MagicMoment[];
  notes?: string;
}

/** Cook 0's output: the new document plus lifecycle decisions on inferences. */
export interface Cook0Result {
  document: UserUnderstandingDocument;
  generation_notes: string;
  promote_inference_ids: string[];
  retire_inferences: { id: string; reason: string; superseded_by?: string | null }[];
}

export interface CostBreakdown {
  openai_tokens_input: number;
  openai_tokens_output: number;
  anthropic_tokens_input: number;
  anthropic_tokens_output: number;
  embedding_tokens: number;
  perplexity_calls: number;
  elevenlabs_chars: number;
  est_usd: number;
}
