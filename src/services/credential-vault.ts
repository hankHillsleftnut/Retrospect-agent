import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { config } from '../config';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

interface Envelope {
  iv: string;
  tag: string;
  ciphertext: string;
}

const kms = new KMSClient({ region: config.integrations.kmsRegion || undefined });

function localKey(): Buffer | null {
  if (!config.integrations.localEncryptionKey) return null;
  const key = Buffer.from(config.integrations.localEncryptionKey, 'base64');
  if (key.byteLength !== 32) throw new Error('INTEGRATION_LOCAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}

async function dataKeyForWrite(): Promise<{ plaintext: Buffer; encrypted: string | null; keyId: string }> {
  const fallback = localKey();
  if (fallback) return { plaintext: fallback, encrypted: null, keyId: 'local-development-key' };
  if (!config.integrations.kmsKeyId) throw new Error('INTEGRATION_KMS_KEY_ID is required for credential storage');
  const result = await kms.send(new GenerateDataKeyCommand({
    KeyId: config.integrations.kmsKeyId,
    KeySpec: 'AES_256',
  }));
  if (!result.Plaintext || !result.CiphertextBlob) throw new Error('KMS did not return a complete data key');
  return {
    plaintext: Buffer.from(result.Plaintext),
    encrypted: Buffer.from(result.CiphertextBlob).toString('base64'),
    keyId: config.integrations.kmsKeyId,
  };
}

async function dataKeyForRead(encryptedDataKey: string | null, keyId: string | null): Promise<Buffer> {
  if (keyId === 'local-development-key') {
    const fallback = localKey();
    if (!fallback) throw new Error('Local integration encryption key is unavailable');
    return fallback;
  }
  if (!encryptedDataKey) throw new Error('Credential record is missing its encrypted data key');
  const result = await kms.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(encryptedDataKey, 'base64'),
    KeyId: keyId ?? undefined,
  }));
  if (!result.Plaintext) throw new Error('KMS could not decrypt the data key');
  return Buffer.from(result.Plaintext);
}

function seal(value: Record<string, unknown>, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const envelope: Envelope = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

function open(value: string, key: Buffer): Record<string, unknown> {
  const envelope = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Envelope;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(cleartext.toString('utf8')) as Record<string, unknown>;
}

export async function storeIntegrationCredentials(options: {
  userId: string;
  connectionId: string;
  credentials: Record<string, unknown>;
  expiresAt?: string;
  refreshAfter?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const dataKey = await dataKeyForWrite();
  const encrypted = seal(options.credentials, dataKey.plaintext);
  dataKey.plaintext.fill(0);
  const { error } = await supabase.from(Tables.INTEGRATION_CREDENTIALS).upsert({
    user_id: options.userId,
    connection_id: options.connectionId,
    encryption_scheme: 'aes-256-gcm-envelope-v1',
    encrypted_credentials: encrypted,
    encrypted_data_key: dataKey.encrypted,
    key_id: dataKey.keyId,
    expires_at: options.expiresAt ?? null,
    refresh_after: options.refreshAfter ?? null,
    metadata: options.metadata ?? {},
  }, { onConflict: 'connection_id' });
  if (error) throw new Error(`Store integration credentials failed: ${error.message}`);
}

export async function loadIntegrationCredentials(userId: string, connectionId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from(Tables.INTEGRATION_CREDENTIALS)
    .select('encrypted_credentials,encrypted_data_key,key_id')
    .eq('user_id', userId)
    .eq('connection_id', connectionId)
    .single();
  if (error || !data) throw new Error(`Load integration credentials failed: ${error?.message ?? 'no row'}`);
  const key = await dataKeyForRead(data.encrypted_data_key, data.key_id);
  try {
    return open(data.encrypted_credentials, key);
  } finally {
    key.fill(0);
  }
}
