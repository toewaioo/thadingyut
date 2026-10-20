import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { submitWishReport, isReportableWishId, bindWishReporting } from '../src/wish-reporting.js';
import { handleSupabaseRequest } from '../server/supabase-proxy.js';

const WISH_ID = '0123456789abcdef0123456789abcdef';
const OTHER_ID = 'fedcba9876543210fedcba9876543210';
const proxyEnv = {
  SUPABASE_URL: 'https://projectref.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'public-anon-key',
};

function rpcClient(result) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(...args) {
        calls.push(args);
        if (typeof result === 'function') return result(...args);
        return result;
      },
    },
  };
}

class FakeElement {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
    this.focused = false;
  }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  async trigger(type, event = {}) {
    const listeners = [...(this.listeners.get(type) || [])];
    return Promise.all(listeners.map(listener => listener({ preventDefault() {}, ...event })));
  }
  dispatchEvent(event) { void this.trigger(event.type, event); return true; }
  focus() { this.focused = true; }
  reset() {
    this.reason.value = '';
    this.details.value = '';
  }
}

function fakeReportingDom() {
  const ids = ['cardReport', 'wishReportForm', 'wishReportReason', 'wishReportDetails', 'wishReportSend', 'wishReportCancel', 'wishReportStatus'];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement()]));
  elements.wishReportForm.reason = elements.wishReportReason;
  elements.wishReportForm.details = elements.wishReportDetails;
  const root = { getElementById: id => elements[id] };
  const events = new FakeElement();
  return { elements, root, events };
}

function reportCard(events, wishId) {
  return events.trigger('thadingyut:wish-card', { detail: { wishId } });
}

async function proxyCall(url, { method = 'POST', body, origin = 'https://app.example', headers = {} } = {}, upstreamFetch = async () => new Response('{}', { status: 200 })) {
  const request = new Request(`https://app.example${url}`, {
    method,
    headers: { ...(origin === null ? {} : { origin }), ...headers },
    ...(body === undefined ? {} : { body }),
  });
  return handleSupabaseRequest(request, proxyEnv, upstreamFetch);
}

test('submitWishReport accepts canonical IDs and sends the exact RPC payload, trimming details', async () => {
  assert.equal(isReportableWishId(WISH_ID), true);
  const { client, calls } = rpcClient({ data: { accepted: true, report_id: 'opaque' }, error: null });
  const result = await submitWishReport(client, { wishId: WISH_ID, reason: 'other', details: '  context  ' });
  assert.deepEqual(calls, [['thadingyut_submit_wish_report', {
    p_wish_id: WISH_ID, p_reason: 'other', p_details: 'context',
  }]]);
  assert.deepEqual(result, { accepted: true, report_id: 'opaque' });
});

test('submitWishReport validates canonical ID, reason, and details length/type before RPC', async () => {
  const { client, calls } = rpcClient({ data: { accepted: true }, error: null });
  for (const wishId of ['', 'a'.repeat(31), 'g'.repeat(32), 123, null]) {
    await assert.rejects(submitWishReport(client, { wishId, reason: 'spam' }), /Invalid wish ID/);
  }
  await assert.rejects(submitWishReport(client, { wishId: WISH_ID, reason: 'unknown' }), /Invalid report reason/);
  await assert.rejects(submitWishReport(client, { wishId: WISH_ID, reason: 'spam', details: 42 }), /Invalid report details/);
  await assert.rejects(submitWishReport(client, { wishId: WISH_ID, reason: 'spam', details: 'x'.repeat(1001) }), /Invalid report details/);
  await submitWishReport(client, { wishId: WISH_ID, reason: 'spam', details: '😀'.repeat(1000) });
  assert.equal(calls.length, 1, 'only the valid request reaches RPC');
});

test('submitWishReport rejects a missing client without attempting RPC', async () => {
  await assert.rejects(submitWishReport(null, { wishId: WISH_ID, reason: 'spam' }), /active cloud connection/);
});

test('submitWishReport sanitizes RPC errors and never retries', async () => {
  const backendMessage = 'sensitive postgres constraint detail';
  const { client, calls } = rpcClient({ data: null, error: new Error(backendMessage) });
  await assert.rejects(submitWishReport(client, { wishId: WISH_ID, reason: 'spam' }), error => {
    assert.equal(error.message, 'Report was not confirmed');
    assert.equal(error.message.includes(backendMessage), false);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('submitWishReport requires accepted to be exactly true', async () => {
  for (const data of [null, {}, { accepted: false }, { accepted: 1 }, { accepted: 'true' }]) {
    const { client, calls } = rpcClient({ data, error: null });
    await assert.rejects(submitWishReport(client, { wishId: WISH_ID, reason: 'spam' }), /Report was not confirmed/);
    assert.equal(calls.length, 1);
  }
  const { client } = rpcClient({ data: { accepted: true }, error: null });
  assert.deepEqual(await submitWishReport(client, { wishId: WISH_ID, reason: 'spam' }), { accepted: true });
});

test('report proxy POST forwards only the exact allowed RPC path, body, and user bearer JWT', async () => {
  let forwarded;
  const body = JSON.stringify({ p_wish_id: WISH_ID, p_reason: 'spam', p_details: '' });
  const response = await proxyCall('/api/supabase/rest/v1/rpc/thadingyut_submit_wish_report', {
    body,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer user.jwt.token',
      'x-forwarded-for': 'untrusted',
    },
  }, async (url, init) => {
    forwarded = { url, init, body: await new Response(init.body).text() };
    return new Response('{"accepted":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, 'https://projectref.supabase.co/rest/v1/rpc/thadingyut_submit_wish_report');
  assert.equal(forwarded.init.method, 'POST');
  assert.equal(forwarded.body, body);
  assert.equal(forwarded.init.headers.get('authorization'), 'Bearer user.jwt.token');
  assert.equal(forwarded.init.headers.get('apikey'), 'public-anon-key');
  assert.equal(forwarded.init.headers.has('x-forwarded-for'), false);
});

test('report proxy denies GET, PATCH, other RPCs, and private report-table paths', async () => {
  let forwarded = 0;
  const upstream = async () => { forwarded++; return new Response('{}'); };
  const denied = [
    ['/rest/v1/rpc/thadingyut_submit_wish_report', 'GET'],
    ['/rest/v1/rpc/thadingyut_submit_wish_report', 'PATCH'],
    ['/rest/v1/rpc/other_function', 'POST'],
    ['/rest/v1/thadingyut_wish_reports', 'GET'],
    ['/rest/v1/thadingyut_wish_reports', 'POST'],
    ['/rest/v1/wish_reports', 'GET'],
    ['/rest/v1/private_wish_reports', 'PATCH'],
  ];
  for (const [path, method] of denied) {
    const response = await proxyCall(path, { method, ...(method === 'POST' || method === 'PATCH' ? { body: '{}' } : {}) }, upstream);
    assert.equal(response.status, 404, `${method} ${path}`);
  }
  assert.equal(forwarded, 0);
});

test('report proxy rejects all query modifiers on the RPC route', async () => {
  let forwarded = 0;
  for (const query of ['?select=*', '?on_conflict=id', '?limit=1']) {
    const response = await proxyCall(`/rest/v1/rpc/thadingyut_submit_wish_report${query}`, { body: '{}' }, async () => {
      forwarded++;
      return new Response('{}');
    });
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: 'Invalid report query' });
  }
  assert.equal(forwarded, 0);
});

test('report proxy blocks cross-origin report submission before forwarding', async () => {
  let forwarded = 0;
  const response = await proxyCall('/rest/v1/rpc/thadingyut_submit_wish_report', {
    body: '{}', origin: 'https://attacker.example',
  }, async () => { forwarded++; return new Response('{}'); });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Cross-origin request denied' });
  assert.equal(forwarded, 0);
});

test('archive reporting integration uses canonical wish.id on spawn and reconciliation, and visibly explains unavailable ambient cards', async () => {
  const [legacy, app, markup] = await Promise.all([
    readFile(new URL('../src/legacy.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/legacy-ui.html', import.meta.url), 'utf8'),
  ]);
  const spawn = legacy.slice(legacy.indexOf('function spawnPolicyWish('), legacy.indexOf('function reconcileSkyWishes('));
  const reconcile = legacy.slice(legacy.indexOf('function reconcileSkyWishes('), legacy.indexOf('// Initial composition'));
  assert.match(spawn, /lantern\.archiveWishId\s*=\s*wish\._isCommunity\s*\?\s*wish\.id\s*:\s*null/);
  assert.doesNotMatch(spawn, /archiveWishId\s*=\s*wish\.source_id/);
  assert.match(reconcile, /lantern\.archiveWishId\s*=\s*wish\.id/);
  assert.doesNotMatch(reconcile, /archiveWishId\s*=\s*wish\.source_id/);
  assert.match(legacy, /wishId:\s*lantern\.archiveWishId\s*\|\|\s*null/);
  const ambientSpawns = [...legacy.matchAll(/spawnLantern\(wish,\s*\{\s*isAmbient:\s*true[\s\S]*?\}\)/g)];
  assert.ok(ambientSpawns.length >= 2, 'ambient lanterns are spawned in both reconciliation and initial composition');
  assert.match(app, /bindWishReporting\(\{\s*getClient:\s*\(\)\s*=>\s*cloudActive\s*\?\s*client\s*:\s*null\s*\}\)/);
  assert.match(app, /stopWishReporting\(\)/, 'React cleanup unregisters report listeners');
  assert.match(markup, /id="cardReport"[^>]*disabled/);
  assert.doesNotMatch(markup, /id="cardReport"[^>]*hidden/);
  assert.ok(markup.indexOf('id="cardReport"') < markup.indexOf('id="cardText"'));
});

test('fake DOM: state allows one in-flight report, confirms once, and blocks duplicate submission', async () => {
  const dom = fakeReportingDom();
  let resolveRpc;
  let calls = 0;
  const stop = bindWishReporting({
    getClient: () => ({ rpc: () => { calls++; return new Promise(resolve => { resolveRpc = resolve; }); } }),
    root: dom.root, events: dom.events,
  });
  const { cardReport, wishReportForm: form, wishReportReason: reason, wishReportSend: send, wishReportStatus: status } = dom.elements;
  await reportCard(dom.events, WISH_ID);
  assert.equal(cardReport.hidden, false);
  await cardReport.trigger('click');
  reason.value = 'spam';
  const first = form.trigger('submit');
  const duplicate = form.trigger('submit');
  assert.equal(calls, 1);
  assert.equal(send.disabled, true);
  resolveRpc({ data: { accepted: true }, error: null });
  await Promise.all([first, duplicate]);
  assert.match(status.textContent, /ပေးပို့ပြီးပါပြီ/);
  assert.equal(form.hidden, true);
  assert.equal(cardReport.disabled, true);
  await cardReport.trigger('click');
  assert.equal(calls, 1, 'confirmed report cannot be submitted again');
  stop();
});

test('fake DOM: failure text is safe, retry works, cancel closes form, and cleanup unregisters listeners', async () => {
  const dom = fakeReportingDom();
  let calls = 0;
  const stop = bindWishReporting({
    getClient: () => ({ rpc: async () => {
      calls++;
      if (calls === 1) return { data: null, error: new Error('secret SQL detail') };
      return { data: { accepted: true }, error: null };
    } }),
    root: dom.root, events: dom.events,
  });
  const { cardReport, wishReportForm: form, wishReportReason: reason, wishReportSend: send, wishReportCancel: cancel, wishReportStatus: status } = dom.elements;
  await reportCard(dom.events, WISH_ID);
  await cardReport.trigger('click');
  reason.value = 'harassment';
  await form.trigger('submit');
  assert.match(status.textContent, /မအောင်မြင်ပါ/);
  assert.doesNotMatch(status.textContent, /secret SQL detail/);
  assert.equal(send.disabled, false, 'failed request remains retryable');
  await form.trigger('submit');
  assert.equal(calls, 2);
  assert.equal(cardReport.disabled, true);
  await reportCard(dom.events, OTHER_ID);
  await cardReport.trigger('click');
  assert.equal(form.hidden, false);
  await cancel.trigger('click');
  assert.equal(form.hidden, true);
  stop();
  assert.equal((dom.events.listeners.get('thadingyut:wish-card') || new Set()).size, 0);
  assert.equal((cardReport.listeners.get('click') || new Set()).size, 0);
  assert.equal((form.listeners.get('submit') || new Set()).size, 0);
});

test('fake DOM: switching cards during an in-flight request cannot update the new card status', async () => {
  const dom = fakeReportingDom();
  let resolveRpc;
  const stop = bindWishReporting({
    getClient: () => ({ rpc: () => new Promise(resolve => { resolveRpc = resolve; }) }),
    root: dom.root, events: dom.events,
  });
  const { cardReport, wishReportForm: form, wishReportReason: reason, wishReportStatus: status, wishReportSend: send } = dom.elements;
  await reportCard(dom.events, WISH_ID);
  await cardReport.trigger('click');
  reason.value = 'other';
  const pending = form.trigger('submit');
  assert.equal(status.textContent, 'ပေးပို့နေသည်…');
  await reportCard(dom.events, OTHER_ID);
  assert.equal(status.textContent, '', 'selection reset status for the different card');
  assert.equal(cardReport.disabled, false);
  resolveRpc({ data: null, error: new Error('private backend detail') });
  await pending;
  assert.equal(status.textContent, '', 'old completion must not publish status for current selection');
  assert.equal(send.disabled, false);
  stop();
});

test('fake DOM: disposal during a request suppresses late UI updates', async () => {
  const dom = fakeReportingDom();
  let resolveRpc;
  const stop = bindWishReporting({
    getClient: () => ({ rpc: () => new Promise(resolve => { resolveRpc = resolve; }) }),
    root: dom.root, events: dom.events,
  });
  await reportCard(dom.events, WISH_ID);
  await dom.elements.cardReport.trigger('click');
  dom.elements.wishReportReason.value = 'spam';
  const pending = dom.elements.wishReportForm.trigger('submit');
  stop();
  dom.elements.wishReportStatus.textContent = 'sentinel';
  resolveRpc({ data: null, error: new Error('failure') });
  await pending;
  assert.equal(dom.elements.wishReportStatus.textContent, 'sentinel');
});


test('unreportable sample/local wishes show a disabled action and explanation without any RPC', async () => {
  const dom = fakeReportingDom(); let calls = 0;
  const stop = bindWishReporting({ getClient: () => ({ rpc: async () => { calls++; return {data:{accepted:true}}; } }), root:dom.root, events:dom.events });
  for (const kind of ['sample','local']) {
    await dom.events.trigger('thadingyut:wish-card', {detail:{wishId:null,kind}});
    assert.equal(dom.elements.cardReport.hidden, false);
    assert.equal(dom.elements.cardReport.disabled, true);
    assert.ok(dom.elements.wishReportStatus.textContent.length > 10);
    assert.equal(dom.elements.wishReportStatus.textContent.includes(kind==='local' ? 'Cloud' : 'နမူနာ'),true);
    await dom.elements.cardReport.trigger('click');
    await dom.elements.wishReportForm.trigger('submit');
    assert.equal(dom.elements.wishReportForm.hidden,true);
  }
  assert.equal(calls,0);
  await reportCard(dom.events,WISH_ID);
  assert.equal(dom.elements.cardReport.disabled,false);
  assert.equal(dom.elements.wishReportStatus.textContent,'');
  await dom.elements.cardReport.trigger('click');
  assert.equal(dom.elements.wishReportForm.hidden,false);
  assert.equal(dom.elements.cardReport['aria-expanded'],'true');
  await dom.elements.wishReportCancel.trigger('click');
  assert.equal(dom.elements.cardReport['aria-expanded'],'false');
  stop();
});
