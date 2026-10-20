import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  server: {
    port: parseInt(optional('PORT', '3001'), 10),
    nodeEnv: optional('NODE_ENV', 'development'),
    isProduction: optional('NODE_ENV') === 'production',
    adminSecret: optional('ADMIN_SECRET', 'change-me'),
  },
  supabase: {
    url: required('SUPABASE_URL'),
    serviceKey: required('SUPABASE_SERVICE_KEY'),
    anonKey: optional('SUPABASE_ANON_KEY'),
  },
  openai: {
    apiKey: required('OPENAI_API_KEY'),
    chatModel: optional('OPENAI_CHAT_MODEL', 'gpt-4o'),
    cookAModel: optional('OPENAI_COOK_A_MODEL', 'gpt-4o-mini'),
    embeddingModel: optional('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large'),
  },
  anthropic: {
    apiKey: optional('ANTHROPIC_API_KEY'),
    cook0Model: optional('ANTHROPIC_COOK0_MODEL', 'claude-sonnet-4-6'),
    cookBModel: optional('ANTHROPIC_COOK_B_MODEL', 'claude-sonnet-4-6'),
    cookCModel: optional('ANTHROPIC_COOK_C_MODEL', 'claude-sonnet-4-6'),
    // Answers the canonical questions (first pass and researcher). Judgement
    // about a person from their own words, so a strong model by default.
    // Sonnet 5.5 chosen 18 October 2026 (decision-record.md #19): ~9% cheaper
    // than 4.6 on this task, comparable quality.
    questionsModel: optional('ANTHROPIC_QUESTIONS_MODEL', 'claude-sonnet-5-5'),
    // Places calendar events the declared rules couldn't (W3.5b): a short,
    // closed-choice label per title, so the smallest model is enough.
    timeCategoryModel: optional('ANTHROPIC_TIME_CATEGORY_MODEL', 'claude-haiku-5-5'),
  },
  extraction: {
    // 'facts' (default): the facts-only extractor (agents/fact-extractor.ts).
    // 'legacy': the original five-output extractor, unchanged -- the off switch.
    // Decided 18 October 2026 on measured recall (decision-record.md #18).
    mode: optional('EXTRACTOR', 'facts') as 'facts' | 'legacy',
    model: optional('EXTRACTION_MODEL', 'claude-sonnet-5-5'),
  },
  perplexity: {
    apiKey: optional('PERPLEXITY_API_KEY'),
    model: optional('PERPLEXITY_MODEL', 'sonar-pro'),
  },
  elevenlabs: {
    apiKey: optional('ELEVENLABS_API_KEY'),
    defaultVoiceId: optional('ELEVENLABS_VOICE_ID', ''),
    modelId: optional('ELEVENLABS_MODEL_ID', 'eleven_v3'),
  },
  pipeline: {
    ingestDaysBack: 30,
    podcastDaysBack: 14,
    agentMaxIterations: 6,
  },
  integrations: {
    kmsKeyId: optional('INTEGRATION_KMS_KEY_ID'),
    kmsRegion: optional('AWS_REGION', 'us-west-2'),
    localEncryptionKey: optional('INTEGRATION_LOCAL_ENCRYPTION_KEY'),
    googleClientId: optional('GOOGLE_OAUTH_CLIENT_ID'),
    googleClientSecret: optional('GOOGLE_OAUTH_CLIENT_SECRET'),
    spotifyClientId: optional('SPOTIFY_CLIENT_ID'),
    spotifyClientSecret: optional('SPOTIFY_CLIENT_SECRET'),
    redditClientId: optional('REDDIT_CLIENT_ID'),
    redditClientSecret: optional('REDDIT_CLIENT_SECRET'),
    pinterestClientId: optional('PINTEREST_CLIENT_ID'),
    pinterestClientSecret: optional('PINTEREST_CLIENT_SECRET'),
    tiktokClientKey: optional('TIKTOK_CLIENT_KEY'),
    tiktokClientSecret: optional('TIKTOK_CLIENT_SECRET'),
    linkedinClientId: optional('LINKEDIN_CLIENT_ID'),
    linkedinClientSecret: optional('LINKEDIN_CLIENT_SECRET'),
    xClientId: optional('X_CLIENT_ID'),
    xClientSecret: optional('X_CLIENT_SECRET'),
  },
} as const;

export type AppConfig = typeof config;
