import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPublicConfig,
  handleConfigRequest,
  handleSupabaseRequest,
} from '../server/supabase-proxy.js';

const env = {
  SUPABASE_URL: 'https://project-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key',
};

function makeRequest(path, { method = 'GET', headers = {}, body, origin = 'https://app.example' } = {}) {
  const requestHeaders = new Headers(headers);
  if (origin !== undefined) requestHeaders.set('origin', origin);
  return new Request(`https://app.example${path}`, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body } : {}),
  });
}

function upstreamJson(status = 200, data = { ok: true }, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('public config resolves approved URL and publishable-key aliases, with fixed URL fallback', () => {
  assert.deepEqual(getPublicConfig({ SUPABASE_PUBLISHABLE_KEY: 'public-key' }), {
    supabaseUrl: 'https://civxldsafwtsjzadxiwl.supabase.co',
    supabaseKey: 'public-key',
  });
  assert.deepEqual(getPublicConfig({ VITE_SUPABASE_URL: 'https://legacy.supabase.co', SUPABASE_ANON_KEY: 'anon' }), {
    supabaseUrl: 'https://legacy.supabase.co',
    supabaseKey: 'anon',
  });
  assert.equal(getPublicConfig({ SUPABASE_URL: 'https://primary.supabase.co', VITE_SUPABASE_URL: 'https://legacy.supabase.co' }).supabaseUrl,
    'https://primary.supabase.co');
});

test('service-role and secret keys and unsafe upstream URLs are rejected', () => {
  assert.throws(() => getPublicConfig({ SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do-not-expose' }));
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  assert.throws(() => getPublicConfig({ SUPABASE_ANON_KEY: `header.${payload}.signature` }));
  for (const SUPABASE_URL of ['http://project.supabase.co', 'https://localhost', 'https://example.com', 'https://project.supabase.co.attacker.test']) {
    assert.throws(() => getPublicConfig({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: 'public' }));
  }
});

test('anonymous signup is sent to the fixed configured project with apikey and safe headers only', async () => {
  let observed;
  const response = await handleSupabaseRequest(makeRequest('/api/supabase/auth/v1/signup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      cookie: 'session=must-not-forward',
      'x-evil-header': 'must-not-forward',
      'x-client-info': 'test-client',
    },
    body: JSON.stringify({ email: 'anon@example.test', password: 'not-a-real-password' }),
  }), env, async (url, init) => {
    observed = { url, init, body: await new Response(init.body).text() };
    return upstreamJson(200, { id: 'user-id' });
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'user-id' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(observed.url, 'https://project-test.supabase.co/auth/v1/signup');
  assert.equal(observed.init.method, 'POST');
  assert.equal(observed.init.redirect, 'error');
  assert.equal(observed.init.headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(observed.init.headers.get('content-type'), 'application/json');
  assert.equal(observed.init.headers.get('x-client-info'), 'test-client');
  assert.equal(observed.init.headers.get('cookie'), null);
  assert.equal(observed.init.headers.get('x-evil-header'), null);
  assert.equal(observed.init.headers.get('authorization'), null);
  assert.deepEqual(JSON.parse(observed.body), { email: 'anon@example.test', password: 'not-a-real-password' });
});

test('table queries preserve filters, ranges, and bearer authorization', async () => {
  let observed;
  const response = await handleSupabaseRequest(makeRequest('/api/supabase/rest/v1/thadingyut_profiles?owner_id=eq.user-42&select=id%2Cname&order=created_at.desc', {
    headers: { authorization: 'Bearer user-access-token', range: '0-24', prefer: 'count=exact' },
  }), env, async (url, init) => {
    observed = { url, init };
    return upstreamJson(200, [], { 'content-range': '0-0/0' });
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-range'), '0-0/0');
  assert.equal(observed.url, 'https://project-test.supabase.co/rest/v1/thadingyut_profiles?owner_id=eq.user-42&select=id%2Cname&order=created_at.desc');
  assert.equal(observed.init.headers.get('authorization'), 'Bearer user-access-token');
  assert.equal(observed.init.headers.get('range'), '0-24');
  assert.equal(observed.init.headers.get('prefer'), 'count=exact');
  assert.equal(observed.init.headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
});

test('public config responds with only upstream URL and publishable key and fails closed when absent', async () => {
  const response = await handleConfigRequest(new Request('https://app.example/api/config'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    supabaseUrl: 'https://project-test.supabase.co',
    supabaseKey: 'sb_publishable_test-key',
  });
  const missing = await handleConfigRequest(new Request('https://app.example/api/config'), { SUPABASE_URL: env.SUPABASE_URL });
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { error: 'Supabase is not configured' });
  const proxyMissing = await handleSupabaseRequest(makeRequest('/auth/v1/signup', { method: 'POST', body: '{}' }), {}, async () => {
    assert.fail('upstream must not be called without a key');
  });
  assert.equal(proxyMissing.status, 503);
});

test('only exact allowlisted paths and methods are accepted; supplied cross-origin Origin is rejected', async () => {
  for (const [path, method] of [
    ['/auth/v1/admin/users', 'GET'],
    ['/auth/v1/token/refresh', 'POST'],
    ['/rest/v1/other_table', 'GET'],
    ['/rest/v1/thadingyut_profiles', 'DELETE'],
    ['/auth/v1/signup', 'GET'],
  ]) {
    const response = await handleSupabaseRequest(makeRequest(path, { method }), env, async () => {
      assert.fail('forbidden request must not reach upstream');
    });
    assert.equal(response.status, 404, `${method} ${path}`);
  }
  const response = await handleSupabaseRequest(makeRequest('/auth/v1/signup', {
    method: 'POST', body: '{}', origin: 'https://attacker.example',
  }), env, async () => assert.fail('cross-origin request must not reach upstream'));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { error: 'Cross-origin request denied' });
});

test('OPTIONS is handled locally without cross-origin response headers', async () => {
  const response = await handleSupabaseRequest(makeRequest('/auth/v1/token', { method: 'OPTIONS' }), env, async () => {
    assert.fail('OPTIONS should not be forwarded');
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('oversized declared and streamed bodies are rejected at 256 KiB', async () => {
  const declared = await handleSupabaseRequest(makeRequest('/auth/v1/signup', {
    method: 'POST', headers: { 'content-length': String(256 * 1024 + 1) }, body: '{}',
  }), env, async () => assert.fail('oversized request must not reach upstream'));
  assert.equal(declared.status, 413);

  const largeBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(200 * 1024));
      controller.enqueue(new Uint8Array(60 * 1024));
      controller.close();
    },
  });
  const request = new Request('https://app.example/auth/v1/signup', {
    method: 'POST', headers: { origin: 'https://app.example' }, body: largeBody, duplex: 'half',
  });
  const streamed = await handleSupabaseRequest(request, env, async (_url, init) => {
    await new Response(init.body).arrayBuffer();
    return upstreamJson();
  });
  assert.equal(streamed.status, 413);
  assert.deepEqual(await streamed.json(), { error: 'Request body too large' });
});

test('upstream failures are sanitized and redirects/network errors are not followed or leaked', async () => {
  const upstreamError = await handleSupabaseRequest(makeRequest('/rest/v1/thadingyut_profiles'), env, async () =>
    new Response('database password and stack trace', { status: 500 }));
  assert.equal(upstreamError.status, 500);
  assert.deepEqual(await upstreamError.json(), { error: 'Supabase request failed' });
  assert.equal(upstreamError.headers.get('cache-control'), 'no-store');

  let options;
  const redirectFailure = await handleSupabaseRequest(makeRequest('/auth/v1/logout', {
    method: 'POST', headers: { authorization: 'Bearer user-token' },
  }), env, async (_url, init) => {
    options = init;
    throw new TypeError('internal redirect target details');
  });
  assert.equal(options.redirect, 'error');
  assert.equal(redirectFailure.status, 502);
  assert.deepEqual(await redirectFailure.json(), { error: 'Supabase request failed' });
});
