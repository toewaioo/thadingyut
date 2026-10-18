import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { toCloudProxyInput } from '../src/cloud-route.js';
import { handleSupabaseRequest } from '../server/supabase-proxy.js';

const owner = '11111111-1111-4111-8111-111111111111';
const env = {
  SUPABASE_URL: 'https://civxldsafwtsjzadxiwl.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

test('real Supabase SDK uses proxy for anonymous signup, table load/save and token refresh', async () => {
  const upstreamCalls = [];
  const proxyCalls = [];
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: owner, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
  const session = {
    access_token: jwt, refresh_token: 'refresh-test', token_type: 'bearer', expires_in: 3600,
    user: { id: owner, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  const upstream = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    upstreamCalls.push({ path: url.pathname, query: url.search, method: request.method, auth: request.headers.get('authorization') });
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(request.headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
    if (url.pathname === '/auth/v1/signup' || url.pathname === '/auth/v1/token') {
      return Response.json(session);
    }
    if (url.pathname === '/rest/v1/thadingyut_profiles') {
      assert.equal(request.headers.get('authorization'), `Bearer ${jwt}`);
      if (request.method === 'GET') return Response.json([]);
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected upstream ${request.url}`);
  };
  const client = createClient('https://app.example/api/supabase', env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-civxldsafwtsjzadxiwl-auth-token' },
    global: { fetch: async (input, init) => {
      const routedInput = toCloudProxyInput(input, 'https://app.example');
      const request = new Request(routedInput, init);
      const url = new URL(request.url);
      proxyCalls.push({ path: url.pathname, route: url.searchParams.get('__route') });
      assert.equal(url.pathname, '/api/supabase');
      assert.ok(url.searchParams.has('__route'));
      return handleSupabaseRequest(request, env, upstream);
    } },
  });
  const signup = await client.auth.signInAnonymously();
  assert.equal(signup.error, null);
  assert.equal(signup.data.user.id, owner);
  const load = await client.from('thadingyut_profiles').select('preferences, environment, wishes, streak').eq('owner_id', owner).maybeSingle();
  assert.equal(load.error, null);
  assert.equal(load.data, null);
  const save = await client.from('thadingyut_profiles').upsert({ owner_id: owner, wishes: [] }, { onConflict: 'owner_id' });
  assert.equal(save.error, null);
  const refresh = await client.auth.refreshSession();
  assert.equal(refresh.error, null);
  assert.deepEqual(upstreamCalls.map(({ path, method }) => [path, method]), [
    ['/auth/v1/signup', 'POST'], ['/rest/v1/thadingyut_profiles', 'GET'],
    ['/rest/v1/thadingyut_profiles', 'POST'], ['/auth/v1/token', 'POST'],
  ]);
  assert.deepEqual(proxyCalls.map(({ path, route }) => [path, route]), [
    ['/api/supabase', 'auth/v1/signup'],
    ['/api/supabase', 'rest/v1/thadingyut_profiles'],
    ['/api/supabase', 'rest/v1/thadingyut_profiles'],
    ['/api/supabase', 'auth/v1/token'],
  ]);
  assert.match(upstreamCalls[1].query, /owner_id=eq\./);
});
