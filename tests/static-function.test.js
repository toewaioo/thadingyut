import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../api/supabase.js';

test('static Vercel function receives signup over HTTP and strips transport query before upstream', async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = 'https://civxldsafwtsjzadxiwl.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    assert.equal(url.href, 'https://civxldsafwtsjzadxiwl.supabase.co/auth/v1/signup');
    assert.equal(req.method, 'POST');
    assert.deepEqual(await req.json(), { data: {} });
    assert.equal(req.headers.get('apikey'), 'sb_publishable_test');
    calls++;
    return Response.json({ user: { id: 'test-user' } });
  };
  const server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await originalFetch(`${origin}/api/supabase?__route=auth%2Fv1%2Fsignup`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ data: {} }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: { id: 'test-user' } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(calls, 1);
    for (const query of ['', '?__route=https%3A%2F%2Fevil.example', '?__route=auth%2Fv1%2Fsignup&__route=rest%2Fv1%2Fthadingyut_profiles']) {
      const rejected = await originalFetch(`${origin}/api/supabase${query}`, { method: 'POST', body: '{}' });
      assert.equal(rejected.status, 404);
      assert.equal((await rejected.json()).error, 'Route not allowed');
    }
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
    await new Promise(resolve => server.close(resolve));
  }
});
