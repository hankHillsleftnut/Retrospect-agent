import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import type { IntegrationSourceItemInput } from '../types';

interface ImportRow {
  id: string;
  user_id: string;
  connection_id: string;
  storage_path: string;
  original_filename: string;
  parser_version: string | null;
}

interface ArchiveDocument {
  name: string;
  value: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}

function timestamp(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function stableId(prefix: string, payload: unknown): string {
  return `${prefix}:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function boundedText(value: string, max = 30_000): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n\n[Content truncated for analysis; raw payload retained]`;
}

function genericRecords(providerId: string, value: unknown, sourceName: string): IntegrationSourceItemInput[] {
  const rows = Array.isArray(value) ? value : [value];
  return rows.map((row) => {
    const payload = asRecord(row);
    const id = String(payload.id ?? payload.uuid ?? payload.conversation_id ?? stableId(sourceName, payload));
    const occurredAt = [payload.created_at, payload.create_time, payload.timestamp, payload.date, payload.Date]
      .map(timestamp)
      .find(Boolean);
    const readable = Object.entries(payload)
      .filter(([, candidate]) => ['string', 'number', 'boolean'].includes(typeof candidate))
      .slice(0, 80)
      .map(([key, candidate]) => `${key}: ${String(candidate)}`)
      .join('\n');
    return {
      providerObjectType: 'archive_record',
      providerObjectId: `${sourceName}:${id}`,
      payload,
      canonicalType: `${providerId}_archive_record`,
      canonicalText: boundedText(readable || JSON.stringify(payload)),
      normalizedData: payload,
      ...(occurredAt ? { occurredAt } : {}),
      parserVersion: `${providerId}-archive-v2`,
      normalizerVersion: 'generic-archive-record-v2',
      contentType: providerId,
      metadata: { source: `${providerId}_archive`, archive_entry: sourceName },
    };
  });
}

function chatGptRecords(value: unknown, sourceName: string): IntegrationSourceItemInput[] | null {
  const conversations = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value).conversations) ? asRecord(value).conversations as unknown[] : null;
  if (!conversations) return null;
  const items: IntegrationSourceItemInput[] = [];
  for (const candidate of conversations) {
    const conversation = asRecord(candidate);
    const mapping = asRecord(conversation.mapping);
    const conversationId = String(conversation.id ?? conversation.conversation_id ?? stableId('chatgpt-conversation', conversation));
    const title = typeof conversation.title === 'string' ? conversation.title : 'ChatGPT conversation';
    for (const [nodeId, rawNode] of Object.entries(mapping)) {
      const message = asRecord(asRecord(rawNode).message);
      if (!message || !Object.keys(message).length) continue;
      const content = asRecord(message.content);
      const parts = Array.isArray(content.parts) ? content.parts.filter((part) => typeof part === 'string') as string[] : [];
      const text = parts.join('\n').trim();
      if (!text) continue;
      const author = asRecord(message.author);
      const role = typeof author.role === 'string' ? author.role : 'unknown';
      const occurredAt = timestamp(message.create_time);
      const payload = { ...message, conversation_id: conversationId, conversation_title: title, node_id: nodeId };
      items.push({
        providerObjectType: 'conversation_message',
        providerObjectId: `${conversationId}:${String(message.id ?? nodeId)}`,
        payload,
        canonicalType: 'communication',
        canonicalText: boundedText(`${title}\n${role}: ${text}`),
        normalizedData: { conversation_id: conversationId, title, role, text, node_id: nodeId },
        ...(occurredAt ? { occurredAt } : {}),
        parserVersion: 'chatgpt-export-v2',
        normalizerVersion: 'conversation-message-v1',
        contentType: 'chatgpt',
        metadata: { source: 'chatgpt_archive', archive_entry: sourceName, conversation_id: conversationId, role },
      });
    }
  }
  return items.length ? items : null;
}

function claudeRecords(value: unknown, sourceName: string): IntegrationSourceItemInput[] | null {
  const root = asRecord(value);
  const conversations = Array.isArray(value)
    ? value
    : Array.isArray(root.conversations) ? root.conversations as unknown[] : null;
  if (!conversations) return null;
  const items: IntegrationSourceItemInput[] = [];
  for (const candidate of conversations) {
    const conversation = asRecord(candidate);
    const messages = Array.isArray(conversation.chat_messages)
      ? conversation.chat_messages as unknown[]
      : Array.isArray(conversation.messages) ? conversation.messages as unknown[] : [];
    if (!messages.length) continue;
    const conversationId = String(conversation.uuid ?? conversation.id ?? stableId('claude-conversation', conversation));
    const title = typeof conversation.name === 'string' ? conversation.name : 'Claude conversation';
    for (const candidateMessage of messages) {
      const message = asRecord(candidateMessage);
      const text = typeof message.text === 'string'
        ? message.text
        : typeof message.content === 'string' ? message.content : '';
      if (!text.trim()) continue;
      const role = String(message.sender ?? message.role ?? 'unknown');
      const messageId = String(message.uuid ?? message.id ?? stableId(conversationId, message));
      const occurredAt = timestamp(message.created_at ?? message.createdAt);
      const payload = { ...message, conversation_id: conversationId, conversation_title: title };
      items.push({
        providerObjectType: 'conversation_message',
        providerObjectId: `${conversationId}:${messageId}`,
        payload,
        canonicalType: 'communication',
        canonicalText: boundedText(`${title}\n${role}: ${text}`),
        normalizedData: { conversation_id: conversationId, title, role, text },
        ...(occurredAt ? { occurredAt } : {}),
        parserVersion: 'claude-export-v2',
        normalizerVersion: 'conversation-message-v1',
        contentType: 'claude',
        metadata: { source: 'claude_archive', archive_entry: sourceName, conversation_id: conversationId, role },
      });
    }
  }
  return items.length ? items : null;
}

function netflixRecords(value: unknown, sourceName: string): IntegrationSourceItemInput[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.flatMap((candidate) => {
    const row = asRecord(candidate);
    const title = typeof row.Title === 'string' ? row.Title : typeof row.title === 'string' ? row.title : '';
    const occurredAt = timestamp(row.Date ?? row.date ?? row['Start Time']);
    if (!title) return [];
    const payload = { ...row, title };
    return [{
      providerObjectType: 'viewing_event',
      providerObjectId: stableId('netflix-view', payload),
      payload,
      canonicalType: 'media_interest',
      canonicalText: `Watched ${title}${occurredAt ? ` on ${occurredAt}` : ''}.`,
      normalizedData: payload,
      ...(occurredAt ? { occurredAt } : {}),
      parserVersion: 'netflix-export-v1',
      normalizerVersion: 'viewing-event-v1',
      contentType: 'netflix',
      metadata: { source: 'netflix_archive', archive_entry: sourceName },
    } satisfies IntegrationSourceItemInput];
  });
  return items.length ? items : null;
}

export function normalizeArchiveDocument(providerId: string, document: ArchiveDocument): IntegrationSourceItemInput[] {
  if (providerId === 'chatgpt') return chatGptRecords(document.value, document.name) ?? genericRecords(providerId, document.value, document.name);
  if (providerId === 'claude') return claudeRecords(document.value, document.name) ?? genericRecords(providerId, document.value, document.name);
  if (providerId === 'netflix') return netflixRecords(document.value, document.name) ?? genericRecords(providerId, document.value, document.name);
  const root = asRecord(document.value);
  const likelyRecords = root.history ?? root.items ?? root.records ?? root.tweets ?? root.likes ?? document.value;
  return genericRecords(providerId, likelyRecords, document.name);
}

function parseDocument(name: string, bytes: Buffer): unknown {
  const lower = name.toLowerCase();
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (lower.endsWith('.json')) return JSON.parse(text);
  if (lower.endsWith('.csv')) return parse(bytes, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
  if (lower.endsWith('.js')) {
    const assignment = text.indexOf('=');
    if (assignment < 0) return [];
    return JSON.parse(text.slice(assignment + 1).trim().replace(/;$/, ''));
  }
  return [];
}

export async function parseArchiveImport(importId: string): Promise<{
  importRow: ImportRow;
  items: IntegrationSourceItemInput[];
}> {
  const { data: importRow, error: importError } = await supabase
    .from(Tables.INTEGRATION_IMPORTS)
    .select('id,user_id,connection_id,storage_path,original_filename,parser_version')
    .eq('id', importId)
    .single();
  if (importError || !importRow) throw new Error(`Archive import not found: ${importError?.message ?? importId}`);

  const { data: connection, error: connectionError } = await supabase
    .from(Tables.INTEGRATION_CONNECTIONS)
    .select('provider_id')
    .eq('id', importRow.connection_id)
    .single();
  if (connectionError || !connection) throw new Error(`Archive connection not found: ${connectionError?.message ?? importRow.connection_id}`);

  const { data: object, error: storageError } = await supabase.storage
    .from('integration-imports')
    .download(importRow.storage_path);
  if (storageError || !object) throw new Error(`Download archive failed: ${storageError?.message ?? importRow.storage_path}`);

  const bytes = Buffer.from(await object.arrayBuffer());
  if (bytes.byteLength > 1024 * 1024 * 1024) throw new Error('Archive exceeds the 1 GB processing limit');
  const parsed: ArchiveDocument[] = [];
  try {
    if (importRow.original_filename.toLowerCase().endsWith('.zip')) {
      const zip = new AdmZip(bytes);
      const entries = zip.getEntries()
        .filter((entry) => !entry.isDirectory && /\.(json|csv|js)$/i.test(entry.entryName))
        .slice(0, 2_000);
      let totalBytes = 0;
      for (const entry of entries) {
        totalBytes += entry.header.size;
        if (totalBytes > 2 * 1024 * 1024 * 1024) throw new Error('Archive expands beyond the 2 GB safety limit');
        parsed.push({ name: entry.entryName, value: parseDocument(entry.entryName, entry.getData()) });
      }
    } else {
      parsed.push({ name: importRow.original_filename, value: parseDocument(importRow.original_filename, bytes) });
    }
  } catch {
    throw new Error('Archive JSON, CSV, JS, or ZIP contents could not be parsed');
  }
  const items = parsed.flatMap((document) => normalizeArchiveDocument(connection.provider_id, document));
  return { importRow: importRow as ImportRow, items };
}
