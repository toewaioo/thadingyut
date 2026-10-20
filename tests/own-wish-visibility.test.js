import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadOwnHiddenWishSources, legacyWishKey } from '../src/own-wish-visibility.js';
import { planSkyLanterns } from '../src/sky-policy.js';
import { handleSupabaseRequest } from '../server/supabase-proxy.js';

const id = n => n.toString(16).padStart(32, '0');

test('own visibility uses bounded canonical cursor pages and never sends an owner ID', async () => {
  const calls = [];
  const first = Array.from({ length: 500 }, (_, i) => ({ id: id(i + 1), source_id: `local-${i + 1}`, hidden: i === 2 }));
  const client = { async rpc(name, args) {
    calls.push([name, args]);
    return { data: calls.length === 1 ? first : [{ id: id(501), source_id: 'local-501', hidden: true }], error: null };
  } };
  assert.deepEqual(await loadOwnHiddenWishSources(client), { sourceIds: ['local-3', 'local-501'], legacyWishKeys: [] });
  assert.deepEqual(calls, [
    ['thadingyut_own_wish_visibility', { p_after: '', p_limit: 500 }],
    ['thadingyut_own_wish_visibility', { p_after: id(500), p_limit: 500 }],
  ]);
});

test('visibility loader rejects errors, malformed rows and nonadvancing cursors instead of clearing known state', async () => {
  for (const result of [
    { error: { message: 'failed' }, data: [] }, { data: null },
    { data: [{ id: id(1), source_id: 'local', hidden: 1 }] },
    { data: [{ id: id(1), source_id: null, hidden: true }] },
    { data: [{ id: 'bad', source_id: 'local', hidden: false }] },
    { data: [{ id: id(2), source_id: 'a', hidden: false }, { id: id(1), source_id: 'b', hidden: true }] },
    { data: Array.from({ length: 501 }, () => ({ id: id(1), source_id: 'a', hidden: false })) },
  ]) {
    await assert.rejects(loadOwnHiddenWishSources({ rpc: async () => result }));
  }
});

test('hidden local wishes do not reappear under 60 public rows, and are not deleted or mutated', () => {
  const local = [{ id: 'hidden', text: 'Keep this record', at: 2 }, { id: 'new', text: 'Not synced yet', at: 3 }];
  const snapshot = JSON.stringify(local);
  const hidden = planSkyLanterns({ databaseWishes: [], localWishes: local, hiddenLocalSourceIds: ['hidden'] });
  assert.equal(hidden.ambientCount, 60);
  assert.deepEqual(hidden.wishes.map(w => w.id), ['new']);
  assert.equal(JSON.stringify(local), snapshot);
  const restored = planSkyLanterns({ localWishes: local, hiddenLocalSourceIds: [] });
  assert.deepEqual(restored.wishes.map(w => w.id), ['new', 'hidden']);
});

test('public feed removal and reappearance work above 60 without changing the 100-lantern bound', () => {
  const database = Array.from({ length: 70 }, (_, i) => ({ id: id(i + 1), text: `Wish ${i}`, at: i }));
  const before = planSkyLanterns({ databaseWishes: database });
  assert.equal(before.wishes.length, 70);
  const after = planSkyLanterns({ databaseWishes: database.slice(1) });
  assert.equal(after.ambientCount, 0);
  assert.equal(after.wishes.length, 69);
  assert.equal(after.wishes.some(w => w.id === id(1)), false);
  assert.equal(planSkyLanterns({ databaseWishes: database }).wishes.length, 70);
});

test('owner visibility proxy passes bearer identity but denies GET, query tricks and private moderator functions', async () => {
  const base = 'https://app.test/api/supabase?__route=rest/v1/rpc/';
  const env = { SUPABASE_PUBLISHABLE_KEY: 'public-key' };
  let forwarded = 0;
  const upstream = async (url, init) => {
    forwarded++;
    assert.equal(new URL(url).pathname, '/rest/v1/rpc/thadingyut_own_wish_visibility');
    assert.equal(init.headers.get('authorization'), 'Bearer own-user-jwt');
    assert.equal(await new Response(init.body).text(), '{"p_after":"","p_limit":500}');
    return new Response('[]');
  };
  const response = await handleSupabaseRequest(new Request(base + 'thadingyut_own_wish_visibility', {
    method: 'POST', headers: { authorization: 'Bearer own-user-jwt' }, body: '{"p_after":"","p_limit":500}',
  }), env, upstream);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const [suffix, method, status] of [
    ['thadingyut_own_wish_visibility', 'GET', 404],
    ['thadingyut_own_wish_visibility&select=*', 'POST', 400],
    ['thadingyut_review_wish_report', 'POST', 404],
  ]) {
    const denied = await handleSupabaseRequest(new Request(base + suffix, { method }), env, () => assert.fail('must not forward'));
    assert.equal(denied.status, status);
  }
  assert.equal(forwarded, 1);
});

test('UI refreshes both public and private display state and closes stale cards without editing saved wishes', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const legacy = readFileSync(new URL('../src/legacy.js', import.meta.url), 'utf8');
  const reporting = readFileSync(new URL('../src/wish-reporting.js', import.meta.url), 'utf8');
  const feed = readFileSync(new URL('../src/community-feed.js', import.meta.url), 'utf8');
  assert.match(app, /await refreshOwnVisibility\(\)/);
  assert.match(app, /thadingyut:own-wish-visibility/);
  assert.match(legacy, /hiddenLocalSourceIds/);
  assert.match(legacy, /cameraFollow\.onComplete = null;\s+finishCameraFollow\(\)/);
  assert.match(legacy, /if \(currentLantern === lantern\)\{\s+closeCard\(\)/);
  assert.match(reporting, /dispatchEvent\(new Event\('thadingyut:report-submitted'\)\)/);
  assert.match(feed, /addEventListener\('thadingyut:report-submitted'/);
  assert.match(feed, /removeEventListener\('thadingyut:report-submitted'/);
});

test('ID-less legacy records returned by owner RPC stay hidden even when object key order differs', async () => {
  const local = { text: 'Legacy saved wish', at: 123, position: { z: 2, x: 1 }, shape: 'lotus' };
  const rpcCopy = { shape: 'lotus', position: { x: 1, z: 2 }, at: 123, text: 'Legacy saved wish' };
  const sibling = { ...local, shape: 'classic' };
  const snapshot = JSON.stringify([local, sibling]);
  const result = await loadOwnHiddenWishSources({ rpc: async () => ({ data: [
    { id: id(99), source_id: 'postgres-jsonb-derived-md5', hidden: true, local_wish: rpcCopy },
  ] }) });
  assert.equal(legacyWishKey(local), legacyWishKey(rpcCopy));
  const plan = planSkyLanterns({ localWishes: [local, sibling],
    hiddenLocalSourceIds: result.sourceIds, hiddenLocalWishKeys: result.legacyWishKeys });
  assert.equal(plan.wishes.length, 1);
  assert.equal(plan.wishes[0].shape, 'classic', 'same text/time but another stored record is not hidden');
  assert.equal(JSON.stringify([local, sibling]), snapshot);
  assert.equal(planSkyLanterns({ localWishes: [local] }).wishes.length, 1, 'dismissal can restore without a record write');
});
