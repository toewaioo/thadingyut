import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'supabase/migrations/20261020000400_private_admin.sql');
const integrationPath = path.join(root, 'tests/admin-database.sql');
const migration = await readFile(migrationPath, 'utf8');
const integration = await readFile(integrationPath, 'utf8');
const sql = migration.toLowerCase();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

test('private admin migration satisfies the key, visibility, wrapper and non-destructive contracts', () => {
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/);
  assert.match(sql, /create table thadingyut_moderation\.thadingyut_admin_access\s*\(\s*id boolean primary key[^;]*key_hash bytea not null check \(pg_catalog\.octet_length\(key_hash\) = 32\)/);
  assert.match(sql, /alter table thadingyut_moderation\.thadingyut_admin_access enable row level security/);
  assert.match(sql, /revoke all privileges on table thadingyut_moderation\.thadingyut_admin_access from public, anon, authenticated, service_role/);
  assert.match(sql, /create or replace function thadingyut_moderation\._require_admin_key\(p_admin_key text\)/);
  assert.match(sql, /p_admin_key !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /pg_catalog\.sha256\(pg_catalog\.convert_to\(p_admin_key, 'utf8'\)\)/);
  assert.match(sql, /revoke all privileges on function thadingyut_moderation\._require_admin_key\(text\) from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /insert\s+into\s+thadingyut_moderation\.thadingyut_admin_access/);

  assert.match(sql, /create table thadingyut_moderation\.thadingyut_wish_visibility_overrides/);
  assert.match(sql, /wish_id text primary key check \(wish_id ~ '\^\[0-9a-f\]\{32\}\$'/);
  assert.match(sql, /notes text not null default '' check \(pg_catalog\.char_length\(notes\) <= 1000\)/);
  assert.match(sql, /reviewer text not null default 'admin' check \(reviewer = 'admin'\)/);
  assert.match(sql, /alter table thadingyut_moderation\.thadingyut_wish_visibility_overrides enable row level security/);
  assert.match(sql, /grant select on table public\.thadingyut_sky_wishes to anon, authenticated/);
  assert.match(sql, /having pg_catalog\.count\(distinct r\.reporter_id\) >= 3/);
  assert.match(sql, /o\.wish_id = w\.id and o\.hidden is true/);
  assert.match(sql, /create or replace function public\.thadingyut_own_wish_visibility\(/);
  assert.match(sql, /select own_wishes\.wish_id,[\s\S]*own_wishes\.legacy_wish\s+from own_wishes/);

  for (const [name, signature] of [
    ['thadingyut_admin_wishes', 'text, integer, integer, text, text'],
    ['thadingyut_admin_reports', 'text, text, integer, integer'],
    ['thadingyut_admin_review_report', 'text, bigint, text, text'],
    ['thadingyut_admin_set_wish_visibility', 'text, text, boolean, text'],
  ]) {
    const index = sql.indexOf(`create or replace function public.${name}(`);
    assert.notEqual(index, -1, `missing ${name}`);
    const end = sql.indexOf('\n$$;', index);
    const body = sql.slice(index, end < 0 ? undefined : end);
    const firstStatement = body.slice(body.indexOf('begin\n') + 'begin\n'.length).trimStart();
    assert.ok(firstStatement.startsWith('perform thadingyut_moderation._require_admin_key(p_admin_key);'), `${name} does not call key guard first`);
    assert.match(sql.slice(index), new RegExp(`revoke all privileges on function public\\.${name}\\(${signature.replaceAll(', ', ',\\s*')}\\) from public, authenticated;`));
    assert.match(sql.slice(index), new RegExp(`grant execute on function public\\.${name}\\(${signature.replaceAll(', ', ',\\s*')}\\) to anon, authenticated;`));
  }
  assert.match(sql, /'active_report_count', numbered\.report_count/);
  assert.match(sql, /'report_count', numbered\.total_report_count/);
  assert.match(sql, /'id', numbered\.id::text/);
  assert.match(sql, /thadingyut_review_wish_report\(p_report_id, p_status, 'admin'/);
  assert.match(sql, /on conflict \(wish_id\) do update/);
  assert.doesNotMatch(sql, /\b(?:delete\s+from|truncate|drop)\s+(?:public\.)?(?:thadingyut_public_wishes|thadingyut_profiles|thadingyut_wish_reports)/);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update)\s+(?:public\.)?(?:thadingyut_public_wishes|thadingyut_profiles|thadingyut_wish_reports)\b/);
});

test('admin integration SQL covers authorization, private data, visibility, reviews, and preservation', () => {
  assert.match(integration, /\\ir reporting-database\.sql/);
  assert.match(integration, /\\ir three-report-database\.sql/);
  assert.match(integration, /\\ir \.\.\/supabase\/migrations\/20261020000400_private_admin\.sql/);
  for (const coverage of [
    'empty secret store', 'Wrong admin key accepted', 'Private key guard execution was granted',
    'Oversize wish page accepted', 'Admin reports contract/privacy/pagination failed',
    'Owner visibility RPC did not report manual hide', 'Clearing manual flag overrode three active reports',
    'Review dismissal did not restore threshold-hidden wish', 'Profile/archive JSON changed',
    'Unrelated sentinel changed', 'Admin operations deleted a report',
  ]) assert.ok(integration.includes(coverage), `integration coverage missing: ${coverage}`);
});

test('admin database integration runs only in a new disposable local *_test database', { timeout: 120_000 }, (t) => {
  if (process.env.ADMIN_DATABASE_TEST === '0') return t.skip('local database integration disabled by environment');
  const available = run('sudo', ['-n', '-u', 'postgres', 'psql', '-X', '-Atqc', 'select 1']);
  if (available.status !== 0) return t.skip('local PostgreSQL superuser access is unavailable');

  const database = `thadingyut_admin_${process.pid}_${Date.now()}_test`;
  const created = run('sudo', ['-n', '-u', 'postgres', 'createdb', database]);
  assert.equal(created.status, 0, `could not create disposable database: ${created.stderr}`);
  const readableRoot = mkdtempSync(path.join(os.tmpdir(), 'thadingyut-admin-sql-'));
  const readableTests = path.join(readableRoot, 'tests');
  const readableMigrations = path.join(readableRoot, 'supabase', 'migrations');
  mkdirSync(readableTests, { recursive: true, mode: 0o755 });
  mkdirSync(readableMigrations, { recursive: true, mode: 0o755 });
  chmodSync(readableRoot, 0o755);
  const testFiles = ['admin-database.sql', 'reporting-database.sql', 'three-report-database.sql'];
  const migrationFiles = [
    '20261015000000_thadingyut_profiles.sql',
    '20261018000100_public_wishes.sql',
    '20261019000100_revoke_public_wishes_read.sql',
    '20261019000200_sky_wishes_projection.sql',
    '20261020000100_wish_reports.sql',
    '20261020000200_three_report_visibility.sql',
    '20261020000300_wish_suitability.sql',
    '20261020000400_private_admin.sql',
  ];
  for (const file of testFiles) {
    copyFileSync(path.join(root, 'tests', file), path.join(readableTests, file));
    chmodSync(path.join(readableTests, file), 0o644);
  }
  for (const file of migrationFiles) {
    copyFileSync(path.join(root, 'supabase/migrations', file), path.join(readableMigrations, file));
    chmodSync(path.join(readableMigrations, file), 0o644);
  }
  const readableIntegration = path.join(readableTests, 'admin-database.sql');
  let output;
  try {
    output = run('sudo', ['-n', '-u', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', database, '-f', readableIntegration]);
    assert.equal(output.status, 0, `admin SQL integration failed:\n${output.stdout}\n${output.stderr}`);
    assert.match(output.stdout, /PASS: admin key guard, private storage, bounded identity-free inspection/);
  } finally {
    const dropped = run('sudo', ['-n', '-u', 'postgres', 'dropdb', '--if-exists', database]);
    assert.equal(dropped.status, 0, `could not clean up disposable database: ${dropped.stderr}`);
    rmSync(readableRoot, { recursive: true, force: true });
  }
});
