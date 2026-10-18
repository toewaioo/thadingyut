import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommunityWishes, COMMUNITY_PAGE_SIZE } from '../src/community-feed.js';
import { handleSupabaseRequest } from '../server/supabase-proxy.js';

test('public feed loads ALL pages, uses cursor and anon key, sorts by wish time', async () => {
  const calls = [];
  const fetcher = async (path, options) => {
    calls.push(path);
    assert.equal(options.headers.apikey, 'anon-key');
    assert.equal(options.cache, 'no-store');
    const url = new URL(path, 'https://app.test');
    assert.equal(url.searchParams.get('__route'), 'rest/v1/thadingyut_public_wishes');
    assert.equal(url.searchParams.get('select'), 'id,wish');
    assert.equal(url.searchParams.get('limit'), String(COMMUNITY_PAGE_SIZE));
    const rows = calls.length === 1
      ? Array.from({ length: COMMUNITY_PAGE_SIZE }, (_, i) => ({ id: String(i).padStart(5, '0'), wish: { text: `wish ${i}`, at: 1000 + i, source_id: `w_${i}` } }))
      : [{ id: '99999', wish: { text: 'oldest wish', at: 1 } }];
    if (calls.length === 2) assert.equal(url.searchParams.get('id'), 'gt.00499');
    return new Response(JSON.stringify(rows));
  };
  const wishes = await loadCommunityWishes(fetcher, 'anon-key');
  assert.equal(wishes.length, COMMUNITY_PAGE_SIZE + 1);
  assert.equal(wishes[0].text, 'oldest wish');
  assert.equal(wishes[1].source_id, 'w_0');
  assert.equal(calls.length, 2);
});

test('public feed rejects failed or invalid responses rather than erasing last feed', async () => {
  await assert.rejects(loadCommunityWishes(async () => new Response('{}', { status: 503 }), 'key'), /503/);
  await assert.rejects(loadCommunityWishes(async () => new Response('{}'), 'key'), /Invalid/);
});

test('public route allows GET only, strips routing param before forwarding', async () => {
  const env = { SUPABASE_PUBLISHABLE_KEY: 'public-key' };
  let url;
  const response = await handleSupabaseRequest(new Request('https://app.test/api/supabase?__route=rest/v1/thadingyut_public_wishes&select=id,wish&limit=500'), env, async (input) => {
    url = input;
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  });
  assert.equal(response.status, 200);
  assert.equal(new URL(url).pathname, '/rest/v1/thadingyut_public_wishes');
  assert.equal(new URL(url).searchParams.get('select'), 'id,wish');
  assert.equal(new URL(url).searchParams.has('__route'), false);
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const denied = await handleSupabaseRequest(new Request('https://app.test/api/supabase?__route=rest/v1/thadingyut_public_wishes', { method }), env, async () => assert.fail('must not forward'));
    assert.equal(denied.status, 404);
  }
});
