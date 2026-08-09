import { createHash } from 'crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function payloadHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
