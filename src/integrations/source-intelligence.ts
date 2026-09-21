import type { IntegrationSourceItemInput } from '../types';

export type SourceEvidenceStrength = 'explicit' | 'strong' | 'medium' | 'weak' | 'context';

export interface SourceIntelligenceProfile {
  providerId: string;
  label: string;
  collectionPreference: 'device_sync' | 'continuous_oauth' | 'sign_in_portability' | 'optional_file_import';
  defaultOnboarding: boolean;
  generalPurpose: string;
  specialPurpose: string;
  signalTypes: string[];
  typicalClaimTypes: string[];
  defaultEvidenceStrength: SourceEvidenceStrength;
  interpretationGuidance: string[];
  claimBoundaries: string[];
}

type PublicSourceIntelligenceProfile = Omit<SourceIntelligenceProfile, 'interpretationGuidance'> & {
  guidance: string[];
  profileVersion: string;
};

const PROFILE_VERSION = 'source-intelligence-v1';

export const SOURCE_INTELLIGENCE_PROFILES: Record<string, SourceIntelligenceProfile> = {
  healthkit: {
    providerId: 'healthkit',
    label: 'Apple Health',
    collectionPreference: 'device_sync',
    defaultOnboarding: true,
    generalPurpose: 'physiological state, recovery, sleep, movement, and routine evidence',
    specialPurpose: 'body-state context that can explain capacity, consistency, and recovery when it deviates from baseline',
    signalTypes: ['sleep', 'activity', 'workouts', 'heart-rate-context', 'symptoms', 'recovery'],
    typicalClaimTypes: ['observation', 'capacity_signal', 'routine_signal', 'hypothesis'],
    defaultEvidenceStrength: 'medium',
    interpretationGuidance: [
      'Treat normal biometric data as context, not identity evidence.',
      'Create hypotheses only when there is a deviation, repeated pattern, or cross-source correlation.',
    ],
    claimBoundaries: [
      'Never infer medical diagnoses.',
      'Use "may suggest" for stress, burnout, or motivation claims unless the user explicitly confirms them.',
    ],
  },
  screen_time: {
    providerId: 'screen_time',
    label: 'Screen Time',
    collectionPreference: 'device_sync',
    defaultOnboarding: true,
    generalPurpose: 'attention allocation, app habits, pickups, notifications, and daily digital rhythm',
    specialPurpose: 'alignment or tension between stated goals and actual attention patterns',
    signalTypes: ['attention', 'habit-loop', 'goal-alignment', 'friction', 'restoration'],
    typicalClaimTypes: ['observation', 'attention_signal', 'tension_hypothesis', 'habit_hypothesis'],
    defaultEvidenceStrength: 'weak',
    interpretationGuidance: [
      'Classify usage as advancing, undermining, restorative, or orthogonal to known goals.',
      'Look for timing and repetition before making a behavioral hypothesis.',
    ],
    claimBoundaries: [
      'High usage is not automatically avoidance or addiction.',
      'Keep confidence modest unless repeated and cross-referenced with goals, calendar, sleep, or self-report.',
    ],
  },
  calendar: {
    providerId: 'calendar',
    label: 'Calendar',
    collectionPreference: 'device_sync',
    defaultOnboarding: true,
    generalPurpose: 'commitments, schedule shape, people, organizations, routines, and temporal context',
    specialPurpose: 'the shape of the user’s actual life: what time is protected, crowded out, repeated, or relationally important',
    signalTypes: ['time-use', 'commitment', 'routine', 'relationship-context', 'organization-context'],
    typicalClaimTypes: ['fact', 'observation', 'routine_signal', 'relationship_signal', 'capacity_hypothesis'],
    defaultEvidenceStrength: 'strong',
    interpretationGuidance: [
      'Use events as factual evidence that time was scheduled or protected.',
      'Cross-reference with Gmail, Contacts, Health, and Screen Time before making identity or stress claims.',
    ],
    claimBoundaries: [
      'Scheduled time does not prove attendance or emotional importance by itself.',
      'Attendee presence is relationship context, not relationship quality.',
    ],
  },
  contacts: {
    providerId: 'contacts',
    label: 'Contacts',
    collectionPreference: 'device_sync',
    defaultOnboarding: true,
    generalPurpose: 'identity resolution for people, organizations, aliases, emails, phones, and relationship clues',
    specialPurpose: 'the address book that helps merge people across calendar, Gmail, photos, and social sources',
    signalTypes: ['person-identity', 'organization', 'relationship-label', 'alias-resolution'],
    typicalClaimTypes: ['fact', 'entity_resolution', 'relationship_context'],
    defaultEvidenceStrength: 'explicit',
    interpretationGuidance: [
      'Use contacts primarily for entity resolution and relationship context.',
      'Prefer contact facts over semantic guesses when merging people.',
    ],
    claimBoundaries: [
      'A saved contact does not prove closeness.',
      'Never infer relationship quality without behavioral or user-confirmed evidence.',
    ],
  },
  google_docs: {
    providerId: 'google_docs',
    label: 'Google Docs',
    collectionPreference: 'continuous_oauth',
    defaultOnboarding: true,
    generalPurpose: 'user-authored writing, projects, goals, decisions, drafts, and long-form thinking',
    specialPurpose: 'the clearest source for stated beliefs, self-authored plans, questions, and project trajectories',
    signalTypes: ['writing', 'project', 'goal', 'belief', 'question', 'decision'],
    typicalClaimTypes: ['fact', 'observation', 'explicit_goal', 'identity_signal', 'insight'],
    defaultEvidenceStrength: 'strong',
    interpretationGuidance: [
      'Weight explicit user-authored statements highly.',
      'Preserve document title, section context, and modification time when interpreting intent.',
    ],
    claimBoundaries: [
      'Drafts can be exploratory; do not treat every written idea as a durable belief.',
      'Use "may suggest" for implications that are not directly stated.',
    ],
  },
  gmail: {
    providerId: 'gmail',
    label: 'Gmail',
    collectionPreference: 'continuous_oauth',
    defaultOnboarding: true,
    generalPurpose: 'communication, commitments, relationship cadence, work context, and attachments',
    specialPurpose: 'the social and operational layer: who the user coordinates with, what promises exist, and what work keeps recurring',
    signalTypes: ['communication', 'commitment', 'relationship-cadence', 'project', 'organization'],
    typicalClaimTypes: ['fact', 'observation', 'commitment_signal', 'relationship_signal', 'work_hypothesis'],
    defaultEvidenceStrength: 'strong',
    interpretationGuidance: [
      'Use participants, thread timing, labels, and explicit commitments as structured evidence.',
      'Cross-reference with Calendar and Contacts before strengthening relationship or work-life hypotheses.',
    ],
    claimBoundaries: [
      'Email tone is not enough to infer emotional state.',
      'Do not expose sensitive message details in user-facing output unless needed and grounded.',
    ],
  },
  spotify: {
    providerId: 'spotify',
    label: 'Spotify',
    collectionPreference: 'continuous_oauth',
    defaultOnboarding: true,
    generalPurpose: 'music taste, mood context, repetition, playlists, saved tracks, and followed artists',
    specialPurpose: 'auditory taste and mood regulation signals, especially when repeated over time or mirrored in Apple Music',
    signalTypes: ['music-taste', 'mood-context', 'repetition', 'playlist-theme', 'artist-affinity'],
    typicalClaimTypes: ['observation', 'taste_signal', 'mood_hypothesis', 'identity_trait_candidate'],
    defaultEvidenceStrength: 'weak',
    interpretationGuidance: [
      'Repeated saves, playlists, and followed artists are stronger than one-off plays.',
      'Cross-reference with Apple Music before treating music taste as stable identity.',
    ],
    claimBoundaries: [
      'A song play does not prove mood.',
      'Use cautious language for emotional inferences from music.',
    ],
  },
  apple_music: {
    providerId: 'apple_music',
    label: 'Apple Music',
    collectionPreference: 'device_sync',
    defaultOnboarding: true,
    generalPurpose: 'music library, playlists, favorites, listening context, and local taste',
    specialPurpose: 'owned or intentionally saved music taste, useful as a durable counterpart to Spotify behavior',
    signalTypes: ['music-taste', 'library', 'playlist-theme', 'favorite', 'artist-affinity'],
    typicalClaimTypes: ['observation', 'taste_signal', 'mood_hypothesis', 'identity_trait_candidate'],
    defaultEvidenceStrength: 'medium',
    interpretationGuidance: [
      'Treat library/favorites as more intentional than transient plays.',
      'Use overlap with Spotify as stronger taste evidence.',
    ],
    claimBoundaries: [
      'Do not infer emotional state from music without timing or cross-source support.',
    ],
  },
  photos: {
    providerId: 'photos',
    label: 'Photos',
    collectionPreference: 'device_sync',
    defaultOnboarding: true,
    generalPurpose: 'memories, places, activity, people context, media metadata, and visual life patterns',
    specialPurpose: 'where the user physically goes, what they preserve, and the visual shape of their life',
    signalTypes: ['memory', 'place', 'visual-context', 'people-context', 'activity-pattern'],
    typicalClaimTypes: ['fact', 'observation', 'place_signal', 'relationship_context', 'taste_signal'],
    defaultEvidenceStrength: 'medium',
    interpretationGuidance: [
      'Metadata can support place, timing, recurrence, and memory patterns.',
      'Image-content interpretation should be separate from metadata and clearly labeled if used.',
    ],
    claimBoundaries: [
      'A photo does not prove importance by itself.',
      'Do not infer identity from faces/scenes without repeated evidence or user confirmation.',
    ],
  },
  reddit: {
    providerId: 'reddit',
    label: 'Reddit',
    collectionPreference: 'continuous_oauth',
    defaultOnboarding: true,
    generalPurpose: 'communities, saved content, comments, posts, questions, interests, and opinions',
    specialPurpose: 'community-shaped curiosity and candid written interests, often less polished than public professional identity',
    signalTypes: ['community', 'written-interest', 'question', 'opinion', 'saved-reference'],
    typicalClaimTypes: ['observation', 'interest_signal', 'opinion_signal', 'community_signal', 'identity_trait_candidate'],
    defaultEvidenceStrength: 'medium',
    interpretationGuidance: [
      'Distinguish authored comments/posts from saved/subscribed content.',
      'Repeated communities and authored opinions are stronger than one saved post.',
    ],
    claimBoundaries: [
      'A subreddit subscription does not prove endorsement.',
      'Use cautious language for ideology/personality claims.',
    ],
  },
  youtube: {
    providerId: 'youtube',
    label: 'YouTube',
    collectionPreference: 'continuous_oauth',
    defaultOnboarding: true,
    generalPurpose: 'subscriptions, playlists, liked videos, channels, and visible long-form media interests',
    specialPurpose: 'long-form curiosity, learning appetite, creators the user trusts, and topics worth sustained attention',
    signalTypes: ['long-form-interest', 'learning', 'creator-affinity', 'playlist-theme', 'media-taste'],
    typicalClaimTypes: ['observation', 'interest_signal', 'learning_signal', 'taste_signal', 'identity_trait_candidate'],
    defaultEvidenceStrength: 'medium',
    interpretationGuidance: [
      'Treat subscriptions/playlists/likes as visible interest evidence, not complete watch history.',
      'Channels and playlists can imply learning arcs when repeated and thematically coherent.',
    ],
    claimBoundaries: [
      'Do not claim the user watched a video unless watch-history evidence exists.',
      'Use "may suggest" for identity claims from likes or subscriptions.',
    ],
  },
  pinterest: {
    providerId: 'pinterest',
    label: 'Pinterest',
    collectionPreference: 'continuous_oauth',
    defaultOnboarding: true,
    generalPurpose: 'boards, pins, saved ideas, aesthetics, interests, taste, and future-self imagery',
    specialPurpose: 'a snapshot of visual taste, aspiration, style, and the kind of worlds the user is collecting toward',
    signalTypes: ['visual-taste', 'aspiration', 'style', 'future-self', 'saved-idea'],
    typicalClaimTypes: ['observation', 'taste_signal', 'aspiration_signal', 'goal_candidate', 'identity_trait_candidate'],
    defaultEvidenceStrength: 'medium',
    interpretationGuidance: [
      'Boards are stronger than isolated pins because they reveal named categories and intent.',
      'Look for recurring aesthetics, projects, homes, bodies, places, careers, and future-self themes.',
    ],
    claimBoundaries: [
      'Visual taste is not the same as a concrete goal.',
      'A pin is weak evidence until repeated or named by the user.',
    ],
  },
  tiktok: {
    providerId: 'tiktok',
    label: 'TikTok',
    collectionPreference: 'sign_in_portability',
    defaultOnboarding: true,
    generalPurpose: 'approved profile, creator/content affinity, short-form media interests, and attention loops',
    specialPurpose: 'fast emotional/attention taste: what lightly or intensely catches the user in short-form form',
    signalTypes: ['short-form-interest', 'creator-affinity', 'humor', 'attention-loop', 'taste'],
    typicalClaimTypes: ['observation', 'interest_signal', 'taste_signal', 'attention_hypothesis'],
    defaultEvidenceStrength: 'weak',
    interpretationGuidance: [
      'Treat TikTok as exposure and attraction evidence, not endorsement.',
      'Repeated creators/topics/categories are much stronger than individual items.',
    ],
    claimBoundaries: [
      'Do not overread identity from short-form engagement.',
      'Use "may suggest" unless patterns repeat or appear across sources.',
    ],
  },
  linkedin: {
    providerId: 'linkedin',
    label: 'LinkedIn',
    collectionPreference: 'continuous_oauth',
    defaultOnboarding: true,
    generalPurpose: 'professional identity, organizations, role, public career narrative, and network context',
    specialPurpose: 'the work-life self: how the user presents competence, ambition, status, and professional belonging',
    signalTypes: ['career-identity', 'organization', 'role', 'professional-network', 'status-language'],
    typicalClaimTypes: ['fact', 'professional_identity_signal', 'organization_context', 'identity_trait_candidate'],
    defaultEvidenceStrength: 'strong',
    interpretationGuidance: [
      'Treat profile fields as explicit professional self-presentation.',
      'Use richer activity only if provider approval grants it.',
    ],
    claimBoundaries: [
      'LinkedIn profile is curated public identity, not the full person.',
      'Do not imply private work behavior from limited profile access.',
    ],
  },
  x: {
    providerId: 'x',
    label: 'X',
    collectionPreference: 'continuous_oauth',
    defaultOnboarding: true,
    generalPurpose: 'authored posts, bookmarks, likes, follows, written interests, opinions, news attention, and public identity',
    specialPurpose: 'written obsessions and public/private written attention: what the user keeps returning to in words',
    signalTypes: ['written-interest', 'opinion', 'news-attention', 'public-identity', 'community'],
    typicalClaimTypes: ['observation', 'interest_signal', 'opinion_signal', 'identity_trait_candidate', 'contradiction_candidate'],
    defaultEvidenceStrength: 'medium',
    interpretationGuidance: [
      'Separate authored posts from likes/bookmarks/follows.',
      'Repeated authored themes are stronger identity evidence than passive engagement.',
    ],
    claimBoundaries: [
      'A like or follow is not endorsement.',
      'Use cautious language for ideology, personality, and emotional-state claims.',
    ],
  },
  netflix: {
    providerId: 'netflix',
    label: 'Netflix',
    collectionPreference: 'optional_file_import',
    defaultOnboarding: false,
    generalPurpose: 'long-form entertainment history and viewing routine, when the user provides files',
    specialPurpose: 'long-form narrative taste and restorative habits, if available',
    signalTypes: ['long-form-media', 'taste', 'routine', 'restoration'],
    typicalClaimTypes: ['observation', 'taste_signal', 'routine_signal'],
    defaultEvidenceStrength: 'weak',
    interpretationGuidance: [
      'Treat viewing as taste and routine context, not productivity evidence.',
    ],
    claimBoundaries: [
      'Do not default this source into onboarding without official low-friction access.',
      'Viewing a show does not imply identity or values by itself.',
    ],
  },
  chatgpt: {
    providerId: 'chatgpt',
    label: 'ChatGPT',
    collectionPreference: 'optional_file_import',
    defaultOnboarding: false,
    generalPurpose: 'user questions, projects, reasoning, drafts, and assistant-aided thinking when the user provides files',
    specialPurpose: 'high-intent questions and project scaffolding, carefully separated from assistant-generated content',
    signalTypes: ['question', 'project', 'reasoning', 'draft', 'goal'],
    typicalClaimTypes: ['observation', 'explicit_goal', 'thinking_signal', 'identity_trait_candidate'],
    defaultEvidenceStrength: 'strong',
    interpretationGuidance: [
      'Separate user-authored messages from assistant output.',
      'Treat user questions as high-intent curiosity evidence.',
    ],
    claimBoundaries: [
      'Assistant-generated text is context, not evidence about the user.',
      'Keep this as optional import unless official low-friction access exists.',
    ],
  },
  claude: {
    providerId: 'claude',
    label: 'Claude',
    collectionPreference: 'optional_file_import',
    defaultOnboarding: false,
    generalPurpose: 'user questions, projects, reasoning, drafts, and assistant-aided thinking when the user provides files',
    specialPurpose: 'high-intent thinking and project development, separated from assistant-generated content',
    signalTypes: ['question', 'project', 'reasoning', 'draft', 'goal'],
    typicalClaimTypes: ['observation', 'explicit_goal', 'thinking_signal', 'identity_trait_candidate'],
    defaultEvidenceStrength: 'strong',
    interpretationGuidance: [
      'Separate user-authored messages from assistant output.',
      'Treat repeated project questions as possible goal evidence.',
    ],
    claimBoundaries: [
      'Assistant-generated text is context, not evidence about the user.',
      'Keep this as optional import unless official low-friction access exists.',
    ],
  },
  grok: {
    providerId: 'grok',
    label: 'Grok',
    collectionPreference: 'optional_file_import',
    defaultOnboarding: false,
    generalPurpose: 'user questions and reasoning if user-provided files exist',
    specialPurpose: 'AI-assisted curiosity and projects, separate from X social data',
    signalTypes: ['question', 'project', 'reasoning', 'draft'],
    typicalClaimTypes: ['observation', 'thinking_signal', 'identity_trait_candidate'],
    defaultEvidenceStrength: 'medium',
    interpretationGuidance: [
      'Do not merge Grok with X social data.',
      'Separate user-authored content from assistant output.',
    ],
    claimBoundaries: [
      'Do not build a default connect button until an official consumer-history API exists.',
    ],
  },
};

const fallbackProfile = (providerId: string): SourceIntelligenceProfile => ({
  providerId,
  label: providerId,
  collectionPreference: 'continuous_oauth',
  defaultOnboarding: false,
  generalPurpose: 'provider evidence for personal context',
  specialPurpose: 'unknown until a provider-specific intelligence profile is defined',
  signalTypes: ['context'],
  typicalClaimTypes: ['observation'],
  defaultEvidenceStrength: 'context',
  interpretationGuidance: [
    'Treat this source conservatively until a provider-specific profile exists.',
  ],
  claimBoundaries: [
    'Do not make identity claims from this source without cross-source evidence.',
  ],
});

export function getSourceIntelligenceProfile(providerId: string): SourceIntelligenceProfile {
  return SOURCE_INTELLIGENCE_PROFILES[providerId] ?? fallbackProfile(providerId);
}

export function publicSourceIntelligenceProfile(providerId: string): PublicSourceIntelligenceProfile {
  const profile = getSourceIntelligenceProfile(providerId);
  return {
    providerId: profile.providerId,
    label: profile.label,
    collectionPreference: profile.collectionPreference,
    defaultOnboarding: profile.defaultOnboarding,
    generalPurpose: profile.generalPurpose,
    specialPurpose: profile.specialPurpose,
    signalTypes: profile.signalTypes,
    typicalClaimTypes: profile.typicalClaimTypes,
    defaultEvidenceStrength: profile.defaultEvidenceStrength,
    claimBoundaries: profile.claimBoundaries,
    guidance: profile.interpretationGuidance,
    profileVersion: PROFILE_VERSION,
  };
}

export function decorateWithSourceIntelligence(
  providerId: string,
  item: IntegrationSourceItemInput
): IntegrationSourceItemInput {
  const sourceIntelligence = publicSourceIntelligenceProfile(providerId);
  return {
    ...item,
    normalizedData: {
      ...item.normalizedData,
      source_intelligence: sourceIntelligence,
    },
    metadata: {
      ...item.metadata,
      source_intelligence: sourceIntelligence,
    },
  };
}

export const INGESTION_SOURCE_LENS_GUIDANCE = `
== SOURCE INTELLIGENCE LENSES ==

Use source_intelligence metadata when it is present on raw content. It tells you what the
source is unusually good evidence for and what it cannot prove by itself.

Important source lenses:
- YouTube / Netflix: long-form media preference, learning appetite, creator trust, and sustained attention. YouTube API-visible data is not watch history unless explicitly labeled as watch history.
- X: written interests, authored opinions, news attention, public identity, and recurring written obsessions. Likes/follows/bookmarks may suggest interest; they are not endorsement.
- Pinterest: visual taste, aspiration, style, and future-self imagery. A board is stronger evidence than one pin.
- TikTok: short-form attention and taste, fast emotional hooks, creator affinity, humor, and mild-to-intense interest. Treat as exposure/attraction evidence, not identity proof.
- LinkedIn: work-life identity, professional self-presentation, organizations, role, skills, ambition, and career network. It is curated professional identity, not the whole person.
- Reddit: community-shaped curiosity, candid questions, comments, saved references, and interest clusters.
- Google Docs / AI conversation imports: intentional user-authored thinking, projects, explicit goals, drafts, and questions. Separate user-authored text from assistant-generated text.
- Gmail / Calendar / Contacts: commitments, people, organizations, relationship cadence, project context, and time structure.
- Spotify / Apple Music: music taste, mood context, repetition, playlist themes, and artist affinity. Do not infer mood from one play.
- Photos: places, visual memory, life activity, people context, and taste when image/content analysis is explicitly available.
- Screen Time: attention allocation, digital routines, friction, restoration, or goal tension. High usage is not automatically avoidance.
- Apple Health: recovery, sleep, activity, and body-state context. Never infer diagnoses.

When a source is a weak or medium signal, write conclusions as "this may suggest" until
there is stronger evidence, repeated behavior, cross-source support, or user confirmation.
Prefer cross-source hypotheses: "Pinterest boards plus Google Docs plus YouTube likes may
suggest..." over one-source certainty.
`;
