import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWishCheck } from '../server/wish-suitability.js';
import { handleSupabaseRequest } from '../server/supabase-proxy.js';
import { SUITABILITY_MESSAGE } from '../src/wish-suitability.js';

const proxyEnv = {
  SUPABASE_URL: 'https://project-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key',
};

function request(method, body, { origin = 'https://app.example', headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (origin !== undefined) requestHeaders.set('origin', origin);
  return new Request('https://app.example/api/wish-check', {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body } : {}),
  });
}

test('POST preflight accepts safe wishes and returns a non-cacheable compact response', async () => {
  const response = await handleWishCheck(request('POST', JSON.stringify({ text: 'May our family be happy', dedication: 'Family' })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { allowed: true });
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('pragma'), 'no-cache');
});

test('unsuitable and policy-validation failures consistently return the Burmese 422 contract', async () => {
  for (const payload of [
    { text: 'မအေလိုး' },
    { text: '😀'.repeat(81) },
    { text: 'safe wish', dedication: '😀'.repeat(21) },
    { dedication: 'Missing text' },
  ]) {
    const response = await handleWishCheck(request('POST', JSON.stringify(payload)));
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      allowed: false,
      code: 'WISH_UNSUITABLE',
      message: SUITABILITY_MESSAGE,
    });
  }
});

test('preflight rejects cross-origin, non-POST and malformed JSON and enforces actual 8 KiB body size', async () => {
  assert.equal((await handleWishCheck(request('POST', '{}', { origin: 'https://evil.example' }))).status, 403);
  const get = await handleWishCheck(request('GET'));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), null);
  assert.equal((await handleWishCheck(request('POST', '{'))).status, 400);

  const declared = await handleWishCheck(request('POST', '{}', { headers: { 'content-length': '8193' } }));
  assert.equal(declared.status, 413);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5000));
      controller.enqueue(new Uint8Array(4000));
      controller.close();
    },
  });
  const actual = await handleWishCheck(new Request('https://app.example/api/wish-check', {
    method: 'POST', headers: { origin: 'https://app.example' }, body: stream, duplex: 'half',
  }));
  assert.equal(actual.status, 413);
});

test('proxy translates only a recognizable suitability rejection from profile POST', async () => {
  const profile = await handleSupabaseRequest(new Request('https://app.example/api/supabase/rest/v1/thadingyut_profiles', {
    method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json' }, body: '{}',
  }), proxyEnv, async () => new Response(JSON.stringify({ code: 'P0001', message: 'WISH_UNSUITABLE' }), {
    status: 400, headers: { 'content-type': 'application/json' },
  }));
  assert.equal(profile.status, 422);
  assert.deepEqual(await profile.json(), {
    allowed: false, code: 'WISH_UNSUITABLE', message: SUITABILITY_MESSAGE,
  });

  const otherEndpoint = await handleSupabaseRequest(new Request('https://app.example/api/supabase/auth/v1/signup', {
    method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json' }, body: '{}',
  }), proxyEnv, async () => new Response(JSON.stringify({ code: 'P0001', message: 'WISH_UNSUITABLE' }), { status: 400 }));
  assert.equal(otherEndpoint.status, 400);
  assert.deepEqual(await otherEndpoint.json(), { error: 'Supabase request failed' });

  const unrelatedProfileError = await handleSupabaseRequest(new Request('https://app.example/api/supabase/rest/v1/thadingyut_profiles', {
    method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json' }, body: '{}',
  }), proxyEnv, async () => new Response(JSON.stringify({ code: '23505', message: 'duplicate key' }), { status: 409 }));
  assert.equal(unrelatedProfileError.status, 409);
  assert.deepEqual(await unrelatedProfileError.json(), { error: 'Supabase request failed' });
});
