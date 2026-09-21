import { Router } from 'express';
import { z } from 'zod';
import { processIntegrationBatch } from '../pipelines/integration-sync';
import { runIntegrationTests } from '../pipelines/integration-tests';
import { enqueueIntegrationJob, ensureConnection } from '../services/integration-queue';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { storeIntegrationCredentials } from '../services/credential-vault';

export const integrationsRouter = Router();

const sourceItemSchema = z.object({
  providerObjectType: z.string().min(1).max(200),
  providerObjectId: z.string().min(1).max(1000),
  payload: z.record(z.unknown()),
  canonicalType: z.string().min(1).max(200),
  canonicalText: z.string().min(1),
  normalizedData: z.record(z.unknown()).default({}),
  occurredAt: z.string().datetime().optional(),
  analysisEligible: z.boolean().default(true),
  providerCreatedAt: z.string().datetime().optional(),
  providerUpdatedAt: z.string().datetime().optional(),
  parserVersion: z.string().min(1).max(100),
  normalizerVersion: z.string().min(1).max(100),
  contentType: z.string().min(1).max(200),
  metadata: z.record(z.unknown()).default({}),
});

const processBatchSchema = z.object({
  userId: z.string().uuid(),
  providerId: z.string().min(1).max(200),
  collectionMode: z.enum(['native_ios', 'oauth_api', 'data_export']),
  runType: z.enum(['initial_backfill', 'incremental_sync', 'webhook_recovery', 'replay', 'export_import']),
  cursorBefore: z.record(z.unknown()).default({}),
  cursorAfter: z.record(z.unknown()).default({}),
  items: z.array(sourceItemSchema).min(1).max(100),
});

const enqueueBatchSchema = processBatchSchema.extend({
  idempotencyKey: z.string().min(8).max(500),
});

const queueImportSchema = z.object({
  userId: z.string().uuid(),
  providerId: z.string().min(1).max(200),
  importId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(500),
});

const credentialsSchema = z.object({
  userId: z.string().uuid(),
  credentials: z.record(z.unknown()),
  expiresAt: z.string().datetime().optional(),
  refreshAfter: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

integrationsRouter.post('/process', async (req, res) => {
  const parsed = processBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid integration batch', details: parsed.error.errors });
  }

  try {
    const result = await processIntegrationBatch(parsed.data);
    return res.status(result.itemsFailed === result.itemsSeen ? 500 : 200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

integrationsRouter.post('/enqueue-device-batch', async (req, res) => {
  const parsed = enqueueBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid integration batch', details: parsed.error.errors });
  }
  try {
    const { idempotencyKey, ...batch } = parsed.data;
    const connection = await ensureConnection({
      userId: batch.userId,
      providerId: batch.providerId,
      collectionMode: batch.collectionMode,
    });
    const job = await enqueueIntegrationJob({
      userId: batch.userId,
      connectionId: connection.id,
      jobType: 'device_batch',
      idempotencyKey,
      payload: batch,
      maxAttempts: 7,
    });
    await supabase.from(Tables.INTEGRATION_AUDIT_EVENTS).insert({
      user_id: batch.userId,
      connection_id: connection.id,
      actor_type: 'system',
      event_type: 'device_batch_queued',
      event_data: { job_id: job.id, provider_id: batch.providerId, item_count: batch.items.length },
    });
    return res.status(202).json({ jobId: job.id, status: job.status });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.post('/queue-import', async (req, res) => {
  const parsed = queueImportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid import job', details: parsed.error.errors });
  try {
    const connection = await ensureConnection({
      userId: parsed.data.userId,
      providerId: parsed.data.providerId,
      collectionMode: 'data_export',
    });
    const job = await enqueueIntegrationJob({
      userId: parsed.data.userId,
      connectionId: connection.id,
      jobType: 'archive_parse',
      idempotencyKey: parsed.data.idempotencyKey,
      payload: { importId: parsed.data.importId },
      maxAttempts: 3,
    });
    await supabase.from(Tables.INTEGRATION_IMPORTS).update({ status: 'queued' }).eq('id', parsed.data.importId);
    return res.status(202).json({ jobId: job.id, status: job.status });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.post('/connections/:connectionId/sync', async (req, res) => {
  const userId = z.string().uuid().safeParse(req.body?.userId);
  if (!userId.success) return res.status(400).json({ error: 'invalid userId' });
  try {
    const { data: connection, error } = await supabase
      .from(Tables.INTEGRATION_CONNECTIONS)
      .select('id,user_id')
      .eq('id', req.params.connectionId)
      .eq('user_id', userId.data)
      .single();
    if (error || !connection) return res.status(404).json({ error: 'connection not found' });
    const bucket = Math.floor(Date.now() / 60_000);
    const job = await enqueueIntegrationJob({
      userId: userId.data,
      connectionId: connection.id,
      jobType: 'oauth_sync',
      idempotencyKey: `manual:${bucket}`,
      payload: { requestedAt: new Date().toISOString() },
      priority: 20,
    });
    return res.status(202).json({ jobId: job.id, status: job.status });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.post('/connections/:connectionId/delete-data', async (req, res) => {
  const userId = z.string().uuid().safeParse(req.body?.userId);
  if (!userId.success) return res.status(400).json({ error: 'invalid userId' });
  try {
    const job = await enqueueIntegrationJob({
      userId: userId.data,
      connectionId: req.params.connectionId,
      jobType: 'delete_connection_data',
      idempotencyKey: `delete:${req.params.connectionId}`,
      payload: {},
      priority: 1,
      maxAttempts: 10,
    });
    return res.status(202).json({ jobId: job.id, status: job.status });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.put('/connections/:connectionId/credentials', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid credentials payload', details: parsed.error.errors });
  try {
    const { data: connection, error } = await supabase
      .from(Tables.INTEGRATION_CONNECTIONS)
      .select('id,user_id')
      .eq('id', req.params.connectionId)
      .eq('user_id', parsed.data.userId)
      .single();
    if (error || !connection) return res.status(404).json({ error: 'connection not found' });
    await storeIntegrationCredentials({
      userId: parsed.data.userId,
      connectionId: connection.id,
      credentials: parsed.data.credentials,
      expiresAt: parsed.data.expiresAt,
      refreshAfter: parsed.data.refreshAfter,
      metadata: parsed.data.metadata,
    });
    await supabase.from(Tables.INTEGRATION_AUDIT_EVENTS).insert({
      user_id: parsed.data.userId,
      connection_id: connection.id,
      actor_type: 'system',
      event_type: 'credentials_stored',
      event_data: { expires_at: parsed.data.expiresAt ?? null },
    });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.post('/test/:connectionId', async (req, res) => {
  try {
    const result = await runIntegrationTests(req.params.connectionId);
    return res.status(result.status === 'failed' ? 500 : 200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
