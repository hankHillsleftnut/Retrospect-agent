import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INGESTION_SOURCE_LENS_GUIDANCE,
  decorateWithSourceIntelligence,
  getSourceIntelligenceProfile,
  publicSourceIntelligenceProfile,
  SOURCE_INTELLIGENCE_PROFILES,
} from '../src/integrations/source-intelligence';
import { INGESTION_SYSTEM_PROMPT } from '../src/prompts/ingestion';
import type { IntegrationSourceItemInput } from '../src/types';

test('default onboarding sources avoid archive-first interaction where official collection exists', () => {
  const archiveFirstDefaults = Object.values(SOURCE_INTELLIGENCE_PROFILES)
    .filter((profile) => profile.defaultOnboarding && profile.collectionPreference === 'optional_file_import')
    .map((profile) => profile.providerId);

  assert.deepEqual(archiveFirstDefaults, []);
});

test('high-personality sources have explicit special-purpose lenses and boundaries', () => {
  const expected = {
    youtube: ['long-form', 'learning'],
    x: ['written', 'interest'],
    pinterest: ['visual', 'taste'],
    tiktok: ['short-form', 'attention'],
    linkedin: ['professional', 'identity'],
  };

  for (const [providerId, terms] of Object.entries(expected)) {
    const profile = getSourceIntelligenceProfile(providerId);
    const searchable = [
      profile.generalPurpose,
      profile.specialPurpose,
      ...profile.signalTypes,
      ...profile.claimBoundaries,
    ].join(' ').toLowerCase();

    for (const term of terms) {
      assert.match(searchable, new RegExp(term));
    }
    assert.ok(profile.claimBoundaries.length > 0, `${providerId} must define claim boundaries`);
  }
});

test('source intelligence decorates normalized data and metadata for database propagation', () => {
  const item: IntegrationSourceItemInput = {
    providerObjectType: 'board',
    providerObjectId: 'board-1',
    payload: { id: 'board-1' },
    canonicalType: 'visual_interest',
    canonicalText: 'Pinterest board: Homes',
    normalizedData: { name: 'Homes' },
    parserVersion: 'test-parser',
    normalizerVersion: 'test-normalizer',
    contentType: 'pinterest',
    metadata: { source: 'test' },
  };

  const decorated = decorateWithSourceIntelligence('pinterest', item);
  assert.equal(
    (decorated.normalizedData.source_intelligence as { specialPurpose: string }).specialPurpose,
    publicSourceIntelligenceProfile('pinterest').specialPurpose
  );
  assert.equal(
    (decorated.metadata.source_intelligence as { defaultEvidenceStrength: string }).defaultEvidenceStrength,
    'medium'
  );
});

test('ingestion prompt contains source-lens guidance and cautious wording requirement', () => {
  assert.match(INGESTION_SOURCE_LENS_GUIDANCE, /Pinterest: visual taste/);
  assert.match(INGESTION_SOURCE_LENS_GUIDANCE, /X: written interests/);
  assert.match(INGESTION_SOURCE_LENS_GUIDANCE, /this may suggest/);
  assert.match(INGESTION_SYSTEM_PROMPT, /SOURCE INTELLIGENCE LENSES/);
});

test('tap-to-sign-in OAuth providers have worker connectors and source lenses', async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'service-key';
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'openai-key';

  const { continuousConnectorProviderIds } = await import('../src/connectors/registry.js');
  const expectedOAuthProviders = [
    'gmail',
    'google_docs',
    'linkedin',
    'pinterest',
    'reddit',
    'spotify',
    'tiktok',
    'x',
    'youtube',
  ];

  assert.deepEqual(continuousConnectorProviderIds, expectedOAuthProviders);
  for (const providerId of expectedOAuthProviders) {
    const profile = getSourceIntelligenceProfile(providerId);
    assert.equal(profile.providerId, providerId);
    assert.notEqual(profile.collectionPreference, 'optional_file_import');
    assert.ok(profile.specialPurpose.length > 0, `${providerId} must have a source-specific interpretation lens`);
  }
});
