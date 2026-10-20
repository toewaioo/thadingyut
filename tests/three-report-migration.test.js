import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = await readFile(path.join(root, 'supabase/migrations/20261020000200_three_report_visibility.sql'), 'utf8');
const integration = await readFile(path.join(root, 'tests/three-report-database.sql'), 'utf8');
const sql = migration.toLowerCase();

test('migration is transactional and replaces only the explicit sky projection', () => {
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/);
  assert.match(sql, /create or replace view public\.thadingyut_sky_wishes\s+with \(security_barrier = true, security_invoker = false\)/);
  for (const field of ['source_id', 'text', 'dedication', 'hue', 'shape', 'position', 'blessings', 'at']) {
    assert.match(sql, new RegExp(`'${field}'\\s*,\\s*w\\.wish -> '${field}'`));
  }
  assert.match(sql, /select w\.id,[\s\S]*\) as wish\s+from public\.thadingyut_public_wishes w/);
  assert.match(sql, /revoke all privileges on table public\.thadingyut_sky_wishes from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.thadingyut_sky_wishes to anon, authenticated/);
  assert.match(sql, /count\(distinct r\.reporter_id\) >= 3/);
  assert.match(sql, /r\.status in \('pending', 'reviewed'\)/);
  assert.doesNotMatch(sql, /status\s*(?:<>|!=)\s*'dismissed'/);
});

test('owner visibility RPC derives identity, enforces bounded canonical keyset paging, and returns no report metadata', () => {
  assert.match(sql, /create or replace function public\.thadingyut_own_wish_visibility\(\s*p_after text default '',\s*p_limit integer default 500\s*\) returns table\(id text, source_id text, hidden boolean, local_wish jsonb\)/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /v_owner uuid := auth\.uid\(\)/);
  assert.match(sql, /if v_owner is null/);
  assert.match(sql, /p_after !~ '\^\[0-9a-f\]\{32\}\$'/);
  assert.match(sql, /p_limit < 1 or p_limit > 500/);
  assert.match(sql, /public\.thadingyut_extract_public_wishes\(v_owner, pg_catalog\.jsonb_build_array\(entries\.item\)\)/);
  assert.match(sql, /where p\.owner_id = v_owner/);
  assert.match(sql, /extracted\.id > p_after/);
  assert.match(sql, /order by extracted\.id\s+limit p_limit/);
  assert.match(sql, /join public\.thadingyut_public_wishes archived on archived\.id = own_wishes\.wish_id/);
  assert.match(sql, /revoke all privileges on function public\.thadingyut_own_wish_visibility\(text, integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.thadingyut_own_wish_visibility\(text, integer\) to authenticated/);
  assert.doesNotMatch(sql, /returns table\([^)]*(?:count|reporter|report_id|reason)/);
});

test('migration introduces no destructive/report side effects or unrelated database changes', () => {
  assert.match(sql, /create index if not exists thadingyut_wish_reports_visibility_idx\s+on thadingyut_moderation\.thadingyut_wish_reports \(wish_id, status, reporter_id\)/);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update|delete\s+from|truncate|drop)\s+(?:public\.)?(?:thadingyut_public_wishes|thadingyut_sky_wishes|thadingyut_profiles|thadingyut_moderation\.thadingyut_wish_reports)\b/);
  assert.doesNotMatch(sql, /\b(?:create|drop|alter)\s+policy\b|\bcreate\s+trigger\b/);
  assert.doesNotMatch(sql, /(?:owner_id|preferences|environment|streak)\s*,\s*\*/);
});

test('SQL integration test exercises report thresholds, privacy, owner isolation, and reversible review states', () => {
  assert.match(integration, /\\ir \.\.\/supabase\/migrations\/20261020000200_three_report_visibility\.sql/);
  for (const assertion of [
    'one distinct reporter', 'two distinct reporters', 'three distinct active reporters',
    'Anonymous role read private queue', 'Anonymous role executed owner visibility RPC',
    'Owner B could inspect owner A wish', 'Reviewing alone should leave wish hidden',
    'Dismissal should restore wish below threshold', 'Fourth active reporter did not re-hide wish',
    'Profile/archive resync improperly unhid wish', 'Sky view select grants changed'
  ]) assert.ok(integration.includes(assertion), `integration coverage missing: ${assertion}`);
});
