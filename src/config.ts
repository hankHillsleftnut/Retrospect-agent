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
    embeddingModel: optional('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large'),
  },
  anthropic: {
    // Optional at boot — only Cook 0 calls Anthropic, and Cook 0 is wrapped in
    // try/catch in the ingest pipeline so an unset key degrades gracefully.
    apiKey: optional('ANTHROPIC_API_KEY'),
    cook0Model: optional('ANTHROPIC_COOK0_MODEL', 'claude-opus-4-7'),
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
} as const;

export type AppConfig = typeof config;
