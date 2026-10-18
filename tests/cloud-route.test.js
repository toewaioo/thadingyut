import test from 'node:test';
import assert from 'node:assert/strict';
import { toCloudProxyInput } from '../src/cloud-route.js';

const origin = 'https://app.example';

test('leaves unrelated local and external inputs unchanged', () => {
  const configPath = `${origin}/api/config?theme=dark`;
  const external = 'https://other.example/api/supabase/auth/v1/signup?x=1';

  assert.equal(toCloudProxyInput(configPath, origin), configPath);
  assert.equal(toCloudProxyInput(external, origin), external);
});

test('maps nested proxy paths onto the static endpoint while preserving filters', () => {
  const input = `${origin}/api/supabase/rest/v1/thadingyut_profiles?select=id%2Cwishes&owner_id=eq.abc&limit=1`;
  const mapped = new URL(toCloudProxyInput(input, origin));

  assert.equal(mapped.pathname, '/api/supabase');
  assert.equal(mapped.searchParams.get('__route'), 'rest/v1/thadingyut_profiles');
  assert.equal(mapped.searchParams.get('select'), 'id,wishes');
  assert.equal(mapped.searchParams.get('owner_id'), 'eq.abc');
  assert.equal(mapped.searchParams.get('limit'), '1');
});

test('replaces injected reserved route parameters with the path-derived route', () => {
  const input = `${origin}/api/supabase/auth/v1/signup?__route=auth%2Fv1%2Flogout&next=1&__route=evil`;
  const mapped = new URL(toCloudProxyInput(input, origin));

  assert.equal(mapped.pathname, '/api/supabase');
  assert.deepEqual(mapped.searchParams.getAll('__route'), ['auth/v1/signup']);
  assert.equal(mapped.searchParams.get('next'), '1');
});

test('preserves Request method, body, and headers when routing to the static endpoint', async () => {
  const request = new Request(`${origin}/api/supabase/auth/v1/signup?__route=evil&mode=anon`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token', 'x-client-info': 'test-client' },
    body: JSON.stringify({ data: { source: 'test' } }),
  });
  const mapped = toCloudProxyInput(request, origin);

  assert.ok(mapped instanceof Request);
  const mappedUrl = new URL(mapped.url);
  assert.equal(mappedUrl.pathname, '/api/supabase');
  assert.equal(mappedUrl.searchParams.get('__route'), 'auth/v1/signup');
  assert.equal(mappedUrl.searchParams.get('mode'), 'anon');
  assert.equal(mapped.method, 'POST');
  assert.equal(mapped.headers.get('content-type'), 'application/json');
  assert.equal(mapped.headers.get('authorization'), 'Bearer test-token');
  assert.equal(mapped.headers.get('x-client-info'), 'test-client');
  assert.deepEqual(await mapped.json(), { data: { source: 'test' } });
});
