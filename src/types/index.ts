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
  created_at: string;
  metadata?: Record<string, unknown>;
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

export interface NotRealizedHint {
  pattern: string;
  evidenceObservationIds: string[];
  hintApproach: string; // how to bring this up without giving the answer
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

export interface IngestionResult {
  observations: {
    content: string;
    reason_why: string;
    confidence_score: number;
    goal_id: string | null;
    is_goal_candidate: boolean;
    raw_content_id?: string | null;
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
  processingNotes?: string;
}

export interface CostBreakdown {
  openai_tokens_input: number;
  openai_tokens_output: number;
  embedding_tokens: number;
  perplexity_calls: number;
  elevenlabs_chars: number;
  est_usd: number;
}
