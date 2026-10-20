import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = await readFile(path.join(root, 'supabase/migrations/20261020000100_wish_reports.sql'), 'utf8');
const docs = await readFile(path.join(root, 'MODERATION.md'), 'utf8');
const sql = migration.toLowerCase();

test('migration is transactional and declares only a separate private reports table', () => {
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/);
  assert.match(sql, /create table thadingyut_moderation\.thadingyut_wish_reports/);
  assert.match(sql, /reporter_id uuid not null references auth\.users\(id\)/);
  assert.match(sql, /unique \(reporter_id, wish_id\)/);
  assert.match(sql, /wish_text_snapshot text not null/);
  assert.match(sql, /wish_dedication_snapshot text/);
  assert.match(sql, /status text not null default 'pending'/);
  assert.match(sql, /reviewed_at timestamptz/);
  assert.match(sql, /reviewer_notes text/);
  assert.match(sql, /from public\.thadingyut_public_wishes w\s+where w\.id = p_wish_id/);
  assert.doesNotMatch(sql, /wish_id text not null references public\.thadingyut_public_wishes/);
});

test('submission RPC enforces authenticated canonical IDs, reasons, details, and atomic hourly cap', () => {
  assert.match(sql, /create or replace function public\.thadingyut_submit_wish_report\([\s\S]*p_wish_id text,[\s\S]*p_reason text,[\s\S]*p_details text default ''\s*\)[\s\S]*returns jsonb/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /v_reporter := auth\.uid\(\)/);
  assert.match(sql, /\^\[0-9a-f\]\{32\}\$/);
  for (const reason of ['spam', 'harassment', 'hate', 'sexual', 'violence', 'personal_info', 'other']) {
    assert.ok(sql.includes(`'${reason}'`), `missing accepted reason ${reason}`);
  }
  assert.match(sql, /char_length\(v_details\) > 1000/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /r\.created_at >= pg_catalog\.clock_timestamp\(\) - interval '1 hour'/);
  assert.match(sql, /v_recent_count >= 10/);
  assert.match(sql, /if exists \([\s\S]*reporter_id = v_reporter and r\.wish_id = p_wish_id[\s\S]*return pg_catalog\.jsonb_build_object\('accepted', true\)/);
  assert.match(sql, /grant execute on function public\.thadingyut_submit_wish_report\(text, text, text\) to authenticated/);
});

test('client roles cannot read or mutate private reports; privileged queue and review stay private', () => {
  assert.match(sql, /alter table thadingyut_moderation\.thadingyut_wish_reports enable row level security/);
  assert.match(sql, /revoke all privileges on table thadingyut_moderation\.thadingyut_wish_reports from public, anon, authenticated, service_role/);
  assert.match(sql, /create view thadingyut_moderation\.thadingyut_wish_report_queue/);
  assert.match(sql, /grant select on table thadingyut_moderation\.thadingyut_wish_report_queue to service_role/);
  assert.match(sql, /create or replace function thadingyut_moderation\.thadingyut_review_wish_report/);
  assert.match(sql, /grant execute on function thadingyut_moderation\.thadingyut_review_wish_report\(bigint, text, text, text\) to postgres, service_role/);
  assert.doesNotMatch(sql, /grant\s+[^;]*(?:on table thadingyut_moderation\.thadingyut_wish_reports|function public\.thadingyut_submit_wish_report)[^;]*\b(?:public|anon)\b/i);
});

test('migration has no wish content, archive, sky, or policy visibility side effects', () => {
  assert.doesNotMatch(sql, /\b(?:update|delete\s+from|truncate|drop)\s+(?:public\.)?(?:thadingyut_public_wishes|thadingyut_sky_wishes|thadingyut_profiles)\b/);
  assert.doesNotMatch(sql, /\b(?:create|drop|alter)\s+policy\b/);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update|delete\s+from)\s+public\.thadingyut_(?:public_wishes|sky_wishes|profiles)\b/);
  assert.match(docs, /not deletion/i);
  assert.match(docs, /not\*\* been deployed to a live database/i);
});

test('moderation instructions specify bounded private inspection and human review', () => {
  assert.match(docs, /limit 50 offset 0/i);
  assert.match(docs, /limit 25/i);
  assert.match(docs, /thadingyut_moderation\.thadingyut_review_wish_report/);
  assert.match(docs, /Sybil protection/i);
  assert.match(docs, /no public moderator UI/i);
});
