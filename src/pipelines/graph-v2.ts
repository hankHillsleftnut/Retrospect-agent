import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { publicSourceIntelligenceProfile } from '../integrations/source-intelligence';

interface SourceRecord {
  id: string;
  provider_object_type: string;
  provider_object_id: string;
  canonical_type: string;
  canonical_text: string | null;
  normalized_data: Record<string, unknown>;
  occurred_at: string | null;
  normalizer_version: string;
  integration_connections: { provider_id: string } | { provider_id: string }[];
  analysis_units: { id: string }[];
}

interface AssertionEvidenceRow {
  user_id: string;
  assertion_id: string;
  analysis_unit_id: string | null;
  source_item_id: string | null;
  raw_content_id: string | null;
  evidence_role: 'supports' | 'contradicts' | 'context';
  weight: number;
  excerpt: string | null;
  char_start?: number | null;
  char_end?: number | null;
}

interface EntityAliasInput {
  namespace: string;
  alias: string;
  confidence?: number;
}

function text(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function sourceIntelligence(record: SourceRecord, providerId: string): Record<string, unknown> {
  const embedded = record.normalized_data.source_intelligence;
  if (embedded && typeof embedded === 'object' && !Array.isArray(embedded)) {
    return embedded as Record<string, unknown>;
  }
  return publicSourceIntelligenceProfile(providerId);
}

async function resolveEntity(options: {
  userId: string;
  entityType: string;
  canonicalName: string;
  aliases: EntityAliasInput[];
  sourceItemId?: string;
  attributes?: Record<string, unknown>;
}): Promise<string> {
  const aliases = options.aliases
    .map((entry) => ({ ...entry, alias: entry.alias.trim() }))
    .filter((entry) => entry.alias);
  if (aliases.length === 0) throw new Error('Graph entity requires at least one stable alias');

  const existingIds: string[] = [];
  for (const alias of aliases) {
    const { data: existing, error } = await supabase
      .from(Tables.ENTITY_ALIASES)
      .select('entity_id')
      .eq('user_id', options.userId)
      .eq('namespace', alias.namespace)
      .eq('alias', alias.alias)
      .maybeSingle();
    if (error) throw new Error(`Resolve entity alias failed: ${error.message}`);
    if (existing?.entity_id && !existingIds.includes(existing.entity_id)) existingIds.push(existing.entity_id);
  }

  let winnerId = existingIds[0];
  if (!winnerId) {
    const { data: entity, error } = await supabase
      .from(Tables.ENTITIES)
      .insert({
        user_id: options.userId,
        entity_type: options.entityType,
        canonical_name: options.canonicalName,
        attributes: options.attributes ?? {},
        confidence: 1,
      })
      .select('id')
      .single();
    if (error || !entity) throw new Error(`Create graph entity failed: ${error?.message ?? 'no row'}`);
    winnerId = entity.id;
  }

  for (const conflictingId of existingIds.slice(1)) {
    const [left, right] = [winnerId, conflictingId].sort();
    const { error } = await supabase.from(Tables.ENTITY_RESOLUTION_CANDIDATES).upsert({
      user_id: options.userId,
      left_entity_id: left,
      right_entity_id: right,
      confidence: 0.95,
      signals: aliases.map((alias) => ({ namespace: alias.namespace, alias: alias.alias })),
      status: 'pending',
      resolver_version: 'exact-alias-v1',
    }, { onConflict: 'left_entity_id,right_entity_id', ignoreDuplicates: true });
    if (error) throw new Error(`Write entity resolution candidate failed: ${error.message}`);
  }

  const rows = aliases.map((alias) => ({
    user_id: options.userId,
    entity_id: winnerId,
    namespace: alias.namespace,
    alias: alias.alias,
    source_item_id: options.sourceItemId ?? null,
    confidence: alias.confidence ?? 1,
  }));
  const { error: aliasError } = await supabase.from(Tables.ENTITY_ALIASES)
    .upsert(rows, { onConflict: 'user_id,namespace,alias', ignoreDuplicates: true });
  if (aliasError) throw new Error(`Create entity aliases failed: ${aliasError.message}`);
  return winnerId;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}

function extractEmails(value: unknown): string[] {
  const matches = JSON.stringify(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

function aliasesForRecord(record: SourceRecord, providerId: string): EntityAliasInput[] {
  const data = record.normalized_data ?? {};
  const aliases: EntityAliasInput[] = [{
    namespace: providerId,
    alias: `${record.provider_object_type}:${record.provider_object_id}`,
  }];
  if (['contact', 'person_contact', 'person_record'].includes(record.canonical_type)) {
    aliases.push(...stringArray(data.email_addresses).map((email) => ({ namespace: 'email', alias: email.toLowerCase() })));
    aliases.push(...stringArray(data.phone_numbers).map((phone) => ({ namespace: 'phone', alias: phone.replace(/\D/g, '') })).filter((entry) => entry.alias));
    const social = Array.isArray(data.social_profiles) ? data.social_profiles : [];
    for (const profile of social) {
      const value = profile && typeof profile === 'object' ? profile as Record<string, unknown> : {};
      if (typeof value.url === 'string' && value.url) aliases.push({ namespace: 'social_url', alias: value.url.toLowerCase() });
    }
  }
  return aliases;
}

// ---------------------------------------------------------------------------
// writeFact — the single write path for every Fact in the system.
//
// Source-agnostic on purpose: journals (raw_content), integrations
// (source_items / analysis_units) and any future source all land here, so
// there is exactly one place that owns idempotency, evidence and (later)
// supersession. See docs/second-brain/04 "Shared write function" and 05 D3.
//
// `originKey` is REQUIRED and is the retry lock: the same logical claim from
// the same source must always produce the same key, so re-running ingest
// upserts instead of duplicating.
// ---------------------------------------------------------------------------

export interface FactEvidenceInput {
  analysisUnitId?: string | null;
  sourceItemId?: string | null;
  rawContentId?: string | null;
  excerpt?: string | null;
  charStart?: number | null;
  charEnd?: number | null;
  role?: 'supports' | 'contradicts' | 'context';
  weight?: number;
}

export interface WriteFactOptions {
  userId: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId?: string | null;
  objectValue?: Record<string, unknown> | null;
  /** Required. Deterministic per logical claim per source. */
  originKey: string;
  kind?: 'observed' | 'inferred';
  confidence?: number;
  eventTime?: string | null;
  normalizerVersion?: string | null;
  modelVersion?: string | null;
  /** Links the row to the pipeline run that produced it, for lineage. */
  sourceRunId?: string | null;
  metadata?: Record<string, unknown>;
  evidence: FactEvidenceInput[];
}

/** Minimal surface of the Supabase client that writeFact needs, so tests can inject a fake. */
export type FactDb = Pick<typeof supabase, 'from'>;

export async function writeFact(
  options: WriteFactOptions,
  db: FactDb = supabase
): Promise<string> {
  if (!options.originKey) throw new Error('writeFact: originKey is required');
  if (!options.objectEntityId && !options.objectValue) {
    throw new Error('writeFact: one of objectEntityId or objectValue is required');
  }

  const { data: assertion, error } = await db.from(Tables.ASSERTIONS).upsert({
    user_id: options.userId,
    subject_entity_id: options.subjectEntityId,
    predicate: options.predicate,
    object_entity_id: options.objectEntityId ?? null,
    object_value: options.objectValue ?? null,
    assertion_kind: options.kind ?? 'observed',
    confidence: options.confidence ?? 1,
    event_time: options.eventTime ?? null,
    observed_at: new Date().toISOString(),
    normalizer_version: options.normalizerVersion ?? null,
    model_version: options.modelVersion ?? null,
    source_run_id: options.sourceRunId ?? null,
    origin_key: options.originKey,
    metadata: options.metadata ?? {},
  }, { onConflict: 'user_id,origin_key' }).select('id').single();
  if (error || !assertion) throw new Error(`Write graph assertion failed: ${error?.message ?? 'no row'}`);

  if (options.evidence.length > 0) {
    const evidence: AssertionEvidenceRow[] = options.evidence.map((entry) => ({
      user_id: options.userId,
      assertion_id: assertion.id,
      analysis_unit_id: entry.analysisUnitId ?? null,
      source_item_id: entry.sourceItemId ?? null,
      raw_content_id: entry.rawContentId ?? null,
      evidence_role: entry.role ?? 'supports',
      weight: entry.weight ?? 1,
      excerpt: entry.excerpt ?? null,
      char_start: entry.charStart ?? null,
      char_end: entry.charEnd ?? null,
    }));
    const { error: evidenceError } = await db.from(Tables.ASSERTION_EVIDENCE)
      .upsert(evidence, { onConflict: 'assertion_id,analysis_unit_id,source_item_id,raw_content_id,evidence_role' });
    if (evidenceError) throw new Error(`Write assertion evidence failed: ${evidenceError.message}`);
  }

  return assertion.id;
}

/**
 * Integration mapper over writeFact. Signature unchanged from before the
 * extraction, so every existing call site behaves identically.
 */
export async function writeObservedAssertion(options: {
  userId: string;
  record: SourceRecord;
  providerId: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId: string;
  objectValue?: Record<string, unknown>;
  originSuffix?: string;
}, db: FactDb = supabase): Promise<string> {
  const units = options.record.analysis_units ?? [];
  const excerpt = options.record.canonical_text?.slice(0, 1000) ?? null;
  const evidence: FactEvidenceInput[] = units.length > 0
    ? units.map((unit) => ({
        analysisUnitId: unit.id,
        sourceItemId: options.record.id,
        excerpt,
      }))
    : [{ analysisUnitId: null, sourceItemId: options.record.id, excerpt }];

  return writeFact({
    userId: options.userId,
    subjectEntityId: options.subjectEntityId,
    predicate: options.predicate,
    objectEntityId: options.objectEntityId,
    objectValue: options.objectValue,
    originKey: `source_item:${options.record.id}:${options.predicate}:${options.originSuffix ?? 'primary'}`,
    kind: 'observed',
    confidence: 1,
    eventTime: options.record.occurred_at,
    normalizerVersion: options.record.normalizer_version,
    metadata: {
      source_item_id: options.record.id,
      provider_id: options.providerId,
      source_intelligence: sourceIntelligence(options.record, options.providerId),
    },
    evidence,
  }, db);
}

function graphMapping(record: SourceRecord): {
  entityType: string;
  name: string;
  predicate: string;
  objectValue?: Record<string, unknown>;
} | null {
  const data = record.normalized_data ?? {};
  switch (record.canonical_type) {
    case 'calendar_event':
      return { entityType: 'event', name: text(data, 'title') ?? 'Calendar event', predicate: 'scheduled_or_attended' };
    case 'contact':
    case 'person_contact':
    case 'person_record':
      return { entityType: 'person', name: text(data, 'display_name', 'name') ?? record.canonical_text ?? 'Contact', predicate: 'knows' };
    case 'document_section':
      return { entityType: 'project', name: text(data, 'title') ?? 'Document', predicate: 'authored_or_edited' };
    case 'professional_profile':
      return { entityType: 'organization', name: text(data, 'company', 'organization', 'headline') ?? text(data, 'title', 'name') ?? 'Professional profile', predicate: 'presented_professional_identity', objectValue: data };
    case 'professional_activity':
      return { entityType: 'topic', name: text(data, 'title', 'headline') ?? record.canonical_text?.slice(0, 200) ?? 'Professional activity', predicate: 'expressed_professional_interest' };
    case 'music_preference':
      return { entityType: 'topic', name: [text(data, 'title'), text(data, 'artist')].filter(Boolean).join(' by ') || 'Music', predicate: 'listened_to' };
    case 'health_daily_summary':
      return { entityType: 'event', name: `Health summary ${text(data, 'day') ?? record.occurred_at ?? ''}`.trim(), predicate: 'had_health_summary', objectValue: data };
    case 'screen_time_summary':
    case 'attention_day':
    case 'photo_activity_day':
      return { entityType: 'event', name: `${record.canonical_type} ${text(data, 'day') ?? record.occurred_at ?? ''}`.trim(), predicate: record.canonical_type, objectValue: data };
    case 'photo_asset':
      return { entityType: 'event', name: `Photo asset ${record.occurred_at ?? ''}`.trim(), predicate: 'captured_photo_context', objectValue: data };
    case 'communication':
      return { entityType: 'event', name: text(data, 'subject') ?? 'Communication', predicate: 'communicated', objectValue: data };
    case 'saved_interest':
    case 'media_interest':
      return { entityType: 'topic', name: text(data, 'title') ?? record.canonical_text?.slice(0, 200) ?? 'Interest', predicate: 'expressed_interest_in' };
    case 'visual_interest':
      return { entityType: 'topic', name: text(data, 'title', 'name') ?? record.canonical_text?.slice(0, 200) ?? 'Visual interest', predicate: 'saved_visual_interest' };
    case 'written_interest':
    case 'social_post':
      return { entityType: 'topic', name: text(data, 'title', 'topic') ?? record.canonical_text?.slice(0, 200) ?? 'Written interest', predicate: 'expressed_written_interest' };
    case 'short_form_media_interest':
      return { entityType: 'topic', name: text(data, 'title', 'creator', 'topic') ?? record.canonical_text?.slice(0, 200) ?? 'Short-form media interest', predicate: 'engaged_with_short_form_media' };
    case 'search_query':
      return { entityType: 'topic', name: text(data, 'query') ?? record.canonical_text?.slice(0, 200) ?? 'Search query', predicate: 'searched_for' };
    case 'viewing_preference':
      return { entityType: 'topic', name: text(data, 'title', 'series') ?? record.canonical_text?.slice(0, 200) ?? 'Viewing preference', predicate: 'watched_or_saved_media' };
    default:
      return null;
  }
}

export async function materializeGraphV2(userId: string, sourceItemIds: string[]): Promise<number> {
  if (sourceItemIds.length === 0) return 0;
  const { data, error } = await supabase
    .from(Tables.SOURCE_ITEMS)
    .select('id,provider_object_type,provider_object_id,canonical_type,canonical_text,normalized_data,occurred_at,normalizer_version,integration_connections(provider_id),analysis_units(id)')
    .eq('user_id', userId)
    .in('id', sourceItemIds);
  if (error) throw new Error(`Load graph source records failed: ${error.message}`);

  const selfId = await resolveEntity({
    userId,
    entityType: 'identity',
    canonicalName: 'Self',
    aliases: [{ namespace: 'retrospect:user', alias: userId }],
  });
  let count = 0;

  for (const record of (data ?? []) as unknown as SourceRecord[]) {
    const mapping = graphMapping(record);
    if (!mapping) continue;
    const connection = Array.isArray(record.integration_connections)
      ? record.integration_connections[0]
      : record.integration_connections;
    const providerId = connection?.provider_id ?? 'unknown';
    const objectEntityId = await resolveEntity({
      userId,
      entityType: mapping.entityType,
      canonicalName: mapping.name,
      aliases: aliasesForRecord(record, providerId),
      sourceItemId: record.id,
      attributes: record.normalized_data,
    });
    await writeObservedAssertion({
      userId,
      record,
      providerId,
      subjectEntityId: selfId,
      predicate: mapping.predicate,
      objectEntityId,
      objectValue: mapping.objectValue,
    });
    count++;

    if (record.canonical_type === 'communication') {
      for (const email of extractEmails(record.normalized_data)) {
        const personId = await resolveEntity({
          userId,
          entityType: 'person',
          canonicalName: email,
          aliases: [{ namespace: 'email', alias: email }],
          sourceItemId: record.id,
          attributes: { email },
        });
        await writeObservedAssertion({
          userId,
          record,
          providerId,
          subjectEntityId: selfId,
          predicate: 'communicated_with',
          objectEntityId: personId,
          objectValue: { communication_entity_id: objectEntityId },
          originSuffix: `participant:${email}`,
        });
        count++;
      }
    }

    if (record.canonical_type === 'calendar_event' && Array.isArray(record.normalized_data.attendees)) {
      for (const rawAttendee of record.normalized_data.attendees) {
        const attendee = rawAttendee && typeof rawAttendee === 'object' ? rawAttendee as Record<string, unknown> : {};
        const emails = extractEmails(attendee);
        const name = text(attendee, 'name') ?? emails[0] ?? 'Calendar participant';
        const aliases: EntityAliasInput[] = emails.map((email) => ({ namespace: 'email', alias: email }));
        if (typeof attendee.identifier === 'string' && attendee.identifier) {
          aliases.push({ namespace: 'calendar_participant', alias: attendee.identifier.toLowerCase() });
        }
        if (aliases.length === 0) continue;
        const personId = await resolveEntity({
          userId,
          entityType: 'person',
          canonicalName: name,
          aliases,
          sourceItemId: record.id,
          attributes: attendee,
        });
        await writeObservedAssertion({
          userId,
          record,
          providerId,
          subjectEntityId: objectEntityId,
          predicate: 'has_participant',
          objectEntityId: personId,
          objectValue: attendee,
          originSuffix: `participant:${aliases[0].namespace}:${aliases[0].alias}`,
        });
        count++;
      }
    }
  }
  return count;
}

export async function materializeIdentityHypothesis(options: {
  userId: string;
  inferenceId: string;
  content: string;
  domain?: string;
  confidence: number;
  rawContentIds: string[];
}): Promise<string> {
  const selfId = await resolveEntity({
    userId: options.userId,
    entityType: 'identity',
    canonicalName: 'Self',
    aliases: [{ namespace: 'retrospect:user', alias: options.userId }],
  });
  const { data: assertion, error } = await supabase
    .from(Tables.ASSERTIONS)
    .upsert({
      user_id: options.userId,
      subject_entity_id: selfId,
      predicate: 'identity_hypothesis',
      object_value: { content: options.content, domain: options.domain ?? 'unknown', identity_inference_id: options.inferenceId },
      assertion_kind: 'inferred',
      confidence: options.confidence,
      observed_at: new Date().toISOString(),
      model_version: 'identity-inference-v1',
      origin_key: `identity_inference:${options.inferenceId}`,
      metadata: { identity_inference_id: options.inferenceId },
    }, { onConflict: 'user_id,origin_key' })
    .select('id')
    .single();
  if (error || !assertion) throw new Error(`Write identity hypothesis assertion failed: ${error?.message ?? 'no row'}`);

  if (options.rawContentIds.length > 0) {
    const { data: raw } = await supabase.from(Tables.RAW_CONTENT)
      .select('id,source_item_id').eq('user_id', options.userId).in('id', options.rawContentIds);
    const sourceItemIds = [...new Set((raw ?? []).map((row) => row.source_item_id).filter(Boolean))] as string[];
    const sourceItemByRawId = new Map((raw ?? []).map((row) => [row.id, row.source_item_id as string | null]));
    if (sourceItemIds.length > 0) {
      const { data: units } = await supabase.from(Tables.ANALYSIS_UNITS)
        .select('id,source_item_id,content').eq('user_id', options.userId).in('source_item_id', sourceItemIds);
      const unitsBySourceItem = new Map<string, { id: string; content: string | null }[]>();
      for (const unit of units ?? []) {
        unitsBySourceItem.set(unit.source_item_id, [
          ...(unitsBySourceItem.get(unit.source_item_id) ?? []),
          { id: unit.id, content: unit.content },
        ]);
      }
      const rows: AssertionEvidenceRow[] = (raw ?? []).flatMap<AssertionEvidenceRow>((rawRow) => {
        const sourceItemId = sourceItemByRawId.get(rawRow.id) ?? null;
        const matchingUnits = sourceItemId ? unitsBySourceItem.get(sourceItemId) ?? [] : [];
        if (matchingUnits.length === 0) {
          return [{
            user_id: options.userId,
            assertion_id: assertion.id,
            analysis_unit_id: null,
            source_item_id: sourceItemId,
            raw_content_id: rawRow.id,
            evidence_role: 'supports',
            weight: options.confidence,
            excerpt: null,
          }];
        }
        return matchingUnits.map((unit) => ({
          user_id: options.userId,
          assertion_id: assertion.id,
          analysis_unit_id: unit.id,
          source_item_id: sourceItemId,
          raw_content_id: rawRow.id,
          evidence_role: 'supports',
          weight: options.confidence,
          excerpt: unit.content?.slice(0, 1000) ?? null,
        }));
      });
      if (rows.length > 0) {
        const { error: evidenceError } = await supabase.from(Tables.ASSERTION_EVIDENCE)
          .upsert(rows, { onConflict: 'assertion_id,analysis_unit_id,source_item_id,raw_content_id,evidence_role' });
        if (evidenceError) throw new Error(`Write hypothesis evidence failed: ${evidenceError.message}`);
      }
    } else {
      const rows: AssertionEvidenceRow[] = options.rawContentIds.map((rawContentId) => ({
        user_id: options.userId,
        assertion_id: assertion.id,
        analysis_unit_id: null,
        source_item_id: null,
        raw_content_id: rawContentId,
        evidence_role: 'supports',
        weight: options.confidence,
        excerpt: null,
      }));
      const { error: evidenceError } = await supabase.from(Tables.ASSERTION_EVIDENCE)
        .upsert(rows, { onConflict: 'assertion_id,analysis_unit_id,source_item_id,raw_content_id,evidence_role' });
      if (evidenceError) throw new Error(`Write raw hypothesis evidence failed: ${evidenceError.message}`);
    }
  }
  return assertion.id;
}
