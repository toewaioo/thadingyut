import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleSupabaseRequest } from '../server/supabase-proxy.js';

const env = { SUPABASE_PUBLISHABLE_KEY: 'public-key' };
const route = 'https://app.test/api/supabase?__route=rest/v1/thadingyut_sky_wishes';
const neverForward = async () => assert.fail('invalid or closed route must not reach upstream');

test('sky proxy accepts only its fixed columns, sort, page limit and safe cursor', async () => {
  const cursor = 'a'.repeat(32);
  let upstreamUrl;
  const response = await handleSupabaseRequest(new Request(`${route}&id=gt.${cursor}&limit=20`), env, async url => {
    upstreamUrl = new URL(url);
    return new Response('[]');
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl.pathname, '/rest/v1/thadingyut_sky_wishes');
  assert.equal(upstreamUrl.searchParams.get('select'), 'id,wish');
  assert.equal(upstreamUrl.searchParams.get('order'), 'id.asc');
  assert.equal(upstreamUrl.searchParams.get('limit'), '20');
  assert.equal(upstreamUrl.searchParams.get('id'), `gt.${cursor}`);
  for (const query of [
    'select=*', 'select=owner_id', 'select=id,wish&select=*', 'order=created_at.desc',
    'limit=501', 'limit=0', 'limit=-1', 'limit=abc', 'offset=1',
    'id=eq.anything', 'id=gt.bad', 'or=(id.neq.x)',
  ]) {
    const invalid = await handleSupabaseRequest(new Request(`${route}&${query}`), env, neverForward);
    assert.equal(invalid.status, 400, query);
  }
});

test('archive endpoint remains closed and sky endpoint rejects writes', async () => {
  for (const path of [
    '/api/supabase?__route=rest/v1/thadingyut_public_wishes',
    '/api/supabase/rest/v1/thadingyut_public_wishes',
    '/rest/v1/thadingyut_public_wishes',
  ]) {
    const response = await handleSupabaseRequest(new Request(`https://app.test${path}`), env, neverForward);
    assert.equal(response.status, 404);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await handleSupabaseRequest(new Request(route, { method }), env, neverForward);
    assert.equal(response.status, 404);
  }
});

test('sky migration grants read only to an explicit projection without changing records or owner policies', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261019000200_sky_wishes_projection.sql', import.meta.url), 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '');
  assert.match(statements, /create or replace view public\.thadingyut_sky_wishes/i);
  assert.match(statements, /security_barrier\s*=\s*true/i);
  assert.match(statements, /jsonb_build_object/);
  assert.match(statements, /grant select on table public\.thadingyut_sky_wishes to anon, authenticated/i);
  assert.match(statements, /revoke all privileges on table public\.thadingyut_public_wishes from public, anon, authenticated/i);
  assert.doesNotMatch(statements, /grant\s+select[^;]*thadingyut_public_wishes/i);
  assert.doesNotMatch(statements, /select\s+\*|select\s+id\s*,\s*wish\s+from/i);
  assert.doesNotMatch(statements, /\b(insert|update|delete|truncate)\b|drop\s+(table|trigger)|alter\s+table\s+public\.thadingyut_profiles/i);
  for (const privateKey of ['owner_id', 'preferences', 'environment', 'streak']) {
    assert.equal(statements.includes(`'${privateKey}'`), false);
  }
});
