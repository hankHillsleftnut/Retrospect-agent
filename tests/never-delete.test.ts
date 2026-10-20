/**
 * F1.4: claims are invalidated, never deleted (P2, Graphiti-style bi-temporal).
 *
 * Scans the code and the latest definition of every database function for
 * deletes of claim tables. Each allowed delete is listed with its reason; a new
 * one fails this test until it is either changed to a retirement or argued for
 * here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLAIM_TABLES = ['assertions', 'assertion_evidence', 'behavior_patterns', 'behavior_pattern_facts',
  'behavior_pattern_whys', 'question_answers', 'answer_evidence'];

/** Deletes that are right: the person asked for their data to go. */
const ALLOWED: Array<{ where: string; table: string; why: string }> = [
  { where: 'delete_integration_connection_data', table: 'assertions', why: 'disconnecting a source removes what came from it (privacy, at the person\'s request)' },
];

/** Deletes that break the rule and are scheduled to become retirements. */
const KNOWN_VIOLATIONS: Array<{ where: string; table: string; fix: string }> = [];

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

/** The live body of each SQL function: the last migration that defines it wins. */
function latestFunctions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files('supabase/migrations', '.sql').sort()) {
    const sql = readFileSync(f, 'utf8');
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi;
    for (const m of sql.matchAll(re)) out.set(m[1]!, m[4]!);
  }
  return out;
}

function deletesIn(text: string): string[] {
  return CLAIM_TABLES.filter((t) => new RegExp(`DELETE\\s+FROM\\s+(?:public\\.)?${t}\\b`, 'i').test(text));
}

test('no database function deletes a claim except the listed ones', () => {
  const found: Array<{ where: string; table: string }> = [];
  for (const [fn, body] of latestFunctions()) for (const table of deletesIn(body)) found.push({ where: fn, table });
  const listed = (f: { where: string; table: string }) =>
    [...ALLOWED, ...KNOWN_VIOLATIONS].some((a) => a.where === f.where && a.table === f.table);
  assert.deepEqual(found.filter((f) => !listed(f)), [], 'a new delete of a claim: retire it instead, or add it to ALLOWED with the reason');
  for (const v of KNOWN_VIOLATIONS) assert.ok(found.some((f) => f.where === v.where && f.table === v.table), `${v.where} no longer deletes ${v.table}: remove it from KNOWN_VIOLATIONS`);
});

test('no application code deletes a claim', () => {
  const offenders: string[] = [];
  for (const f of files('src', '.ts')) {
    const src = readFileSync(f, 'utf8');
    for (const t of CLAIM_TABLES) {
      const constant = t.toUpperCase();
      if (new RegExp(`Tables\\.${constant}\\)[\\s\\S]{0,80}?\\.delete\\(`).test(src) || new RegExp(`from\\(['"]${t}['"]\\)[\\s\\S]{0,80}?\\.delete\\(`).test(src)) offenders.push(`${f}: ${t}`);
    }
  }
  assert.deepEqual(offenders, []);
});
