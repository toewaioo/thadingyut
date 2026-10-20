import { createHash, randomBytes, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { renderAdminLogin, renderAdminPage } from './admin-ui.js';

const scrypt = promisify(rawScrypt);
const SESSION_MS = 8 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const COOKIE = '__Secure-thadingyut_admin';
const RPC = {
  wishes: 'thadingyut_admin_wishes', reports: 'thadingyut_admin_reports',
  review: 'thadingyut_admin_review_report', visibility: 'thadingyut_admin_set_wish_visibility',
};
const securityHeaders = {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, max-age=0',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  // no-referrer makes native navigation POSTs send Origin: null in browsers.
  // same-origin preserves their Origin while suppressing cross-origin referrers.
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
};
const digest = value => createHash('sha256').update(value).digest('hex');
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function output(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...securityHeaders, ...extra } });
}
function redirect(location, extra = {}) { return output('', 303, { location, ...extra }); }
function errorResponse(status, message) { return output(renderAdminLogin({ error: message }), status); }
function integer(value, fallback, max = 10000) {
  if (value == null || value === '') return fallback;
  if (!/^\d{1,5}$/.test(value) || Number(value) > max) throw new Error('Invalid request');
  return Number(value);
}
function canonical(value) { return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value); }
function cookieValue(request) {
  const raw = request.headers.get('cookie') || '';
  const matches = raw.split(';').map(x => x.trim()).filter(x => x.startsWith(COOKIE + '='));
  if (matches.length !== 1) return '';
  const token = matches[0].slice(COOKIE.length + 1);
  return /^[0-9a-f]{64}$/.test(token) ? token : '';
}
function sessionCookie(token, maxAge = SESSION_MS / 1000) {
  return `${COOKIE}=${token}; Path=/admin; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
async function readForm(request) {
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new Error('Invalid form');
  const limit = 16384;
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error('Form too large');
  const reader = request.body?.getReader();
  const chunks = []; let length = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error('Form too large'); }
      chunks.push(value);
    }
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new Error('Duplicate field');
  return params;
}
async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 512) return false;
  const match = /^scrypt-v1\$([A-Za-z0-9_-]{22})\$([0-9a-f]{128})$/.exec(encoded || '');
  if (!match) return false;
  const actual = await scrypt(password, Buffer.from(match[1], 'base64url'), 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}

/** Passwords and backend authority never leave this server-side module. */
export function createAdminHandler({ fetchImpl = globalThis.fetch, now = Date.now, verifyPasswordImpl = verifyPassword } = {}) {
  const sessions = new Map(); const attempts = new Map();
  let globalWindow = { started: now(), count: 0 };
  let activePasswordChecks = 0;
  function cleanup() {
    const time = now();
    for (const [key, session] of sessions) if (session.expires <= time) sessions.delete(key);
    for (const [key, value] of attempts) if (time - value.started >= WINDOW_MS) attempts.delete(key);
    if (time - globalWindow.started >= WINDOW_MS) globalWindow = { started: time, count: 0 };
  }
  function reserveAttempt(ip) {
    cleanup();
    if (globalWindow.count >= 60) return false;
    if (attempts.size >= 5000 && !attempts.has(ip)) return false;
    const bucket = attempts.get(ip) || { started: now(), count: 0 };
    if (bucket.count >= 5) return false;
    bucket.count++; globalWindow.count++; attempts.set(ip, bucket);
    return true;
  }
  async function rpc(env, name, args) {
    const base = new URL(env.SUPABASE_URL || '');
    const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
    if (base.protocol !== 'https:' || !key || !/^[0-9a-f]{64}$/.test(env.THADINGYUT_ADMIN_BACKEND_KEY || '')) throw new Error('Backend unavailable');
    const headers = { apikey: key, 'content-type': 'application/json' };
    if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
    const response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, base), {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ p_admin_key: env.THADINGYUT_ADMIN_BACKEND_KEY, ...args }),
    });
    if (!response.ok) throw new Error('Backend unavailable');
    return response.json();
  }
  return async function handleAdmin(request, env = {}, { clientIp = 'unknown' } = {}) {
    const url = new URL(request.url);
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return null;
    let origin;
    try {
      origin = new URL(env.THADINGYUT_PUBLIC_ORIGIN || '');
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw new Error();
    } catch { return errorResponse(503, 'Admin လုံခြုံရေး configuration မပြည့်စုံသေးပါ။'); }
    // Do not trust forwarding headers. This app serves its TLS listener directly.
    if (url.protocol !== 'https:') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(426, 'HTTPS လင့်ခ်မှသာ ဝင်ပါ။');
      return output('', 308, { location: `${origin.origin}/admin` });
    }
    if (url.origin !== origin.origin) return errorResponse(400, 'မှန်ကန်သော admin လင့်ခ်ကို သုံးပါ။');
    if (!env.THADINGYUT_ADMIN_PASSWORD_HASH || !env.THADINGYUT_ADMIN_BACKEND_KEY) return errorResponse(503, 'Admin လုံခြုံရေး configuration မပြည့်စုံသေးပါ။');
    if (request.method !== 'GET' && request.method !== 'POST') return output('', 405, { allow: 'GET, POST' });
    if (request.method === 'POST' && (request.headers.get('origin') !== origin.origin || request.headers.get('sec-fetch-site') === 'cross-site')) return errorResponse(403, 'ဤစာမျက်နှာမှသာ လုပ်ဆောင်ပါ။');
    cleanup();
    const token = cookieValue(request); const sessionId = token ? digest(token) : '';
    const session = sessions.get(sessionId);
    if (url.pathname === '/admin/login' && request.method === 'POST') {
      if (!reserveAttempt(clientIp)) return output(renderAdminLogin({ error: 'ဝင်ရောက်ရန် ကြိုးစားမှုများနေပါသည်။ ၁၅ မိနစ်ခန့်စောင့်ပြီး ပြန်ကြိုးစားပါ။' }), 429, { 'retry-after': '900' });
      let form;
      try { form = await readForm(request); }
      catch { return errorResponse(400, 'Form ကို ပြန်စစ်ပြီး ပို့ပါ။'); }
      if (activePasswordChecks >= 2) return output(renderAdminLogin({ error: 'ဝင်ရောက်မှုကို ခဏနေမှ ပြန်ကြိုးစားပါ။' }), 429, { 'retry-after': '2' });
      let valid = false;
      activePasswordChecks++;
      try { valid = await verifyPasswordImpl(form.get('password'), env.THADINGYUT_ADMIN_PASSWORD_HASH); }
      catch { return errorResponse(503, 'ယခု ဝင်ရောက်၍ မရသေးပါ။ ခဏနေမှ ပြန်ကြိုးစားပါ။'); }
      finally { activePasswordChecks--; }
      if (!valid) return errorResponse(401, 'စကားဝှက် မမှန်ပါ။');
      attempts.delete(clientIp);
      if (sessionId) sessions.delete(sessionId);
      while (sessions.size >= 512) sessions.delete(sessions.keys().next().value);
      const nextToken = randomBytes(32).toString('hex');
      sessions.set(digest(nextToken), { csrf: randomBytes(32).toString('hex'), expires: now() + SESSION_MS });
      return redirect('/admin', { 'set-cookie': sessionCookie(nextToken) });
    }
    if (!session) {
      if (request.method === 'POST') return errorResponse(401, 'Session ကုန်ဆုံးသွားပါပြီ။ ပြန်ဝင်ပါ။');
      return output(renderAdminLogin({}));
    }
    if (request.method === 'POST') {
      let form;
      try { form = await readForm(request); }
      catch { return errorResponse(400, 'Form ကို ပြန်စစ်ပြီး ပို့ပါ။'); }
      if (!equal(form.get('csrf'), session.csrf)) return errorResponse(403, 'စာမျက်နှာကို ပြန်ဖွင့်ပြီး လုပ်ဆောင်ပါ။');
      if (url.pathname === '/admin/logout') {
        sessions.delete(sessionId);
        return redirect('/admin', { 'set-cookie': sessionCookie('', 0) });
      }
      const notes = form.get('notes') || '';
      if (notes.length > 1000) return errorResponse(400, 'မှတ်ချက်သည် စာလုံး ၁၀၀၀ ထက် မကျော်ရပါ။');
      try {
        if (url.pathname === '/admin/review') {
          const reportId = form.get('report_id'); const status = form.get('status');
          if (!/^[1-9]\d{0,18}$/.test(reportId || '') || BigInt(reportId) > 9223372036854775807n || !['reviewed', 'dismissed'].includes(status)) return errorResponse(400, 'တိုင်ကြားချက်နှင့် status ကို ပြန်စစ်ပါ။');
          await rpc(env, RPC.review, { p_report_id: reportId, p_status: status, p_notes: notes });
          return redirect('/admin?tab=reports&notice=reviewed');
        }
        if (url.pathname === '/admin/visibility') {
          const wishId = form.get('wish_id'); const hidden = form.get('hidden');
          if (!canonical(wishId) || !['true', 'false'].includes(hidden)) return errorResponse(400, 'ဆုတောင်း ID ကို ပြန်စစ်ပါ။');
          await rpc(env, RPC.visibility, { p_wish_id: wishId, p_hidden: hidden === 'true', p_notes: notes });
          return redirect('/admin?notice=visibility');
        }
        return output('Not found', 404);
      } catch { return errorResponse(503, 'လုပ်ဆောင်မှု မအောင်မြင်ပါ။ အခြေအနေကို ပြန်စစ်ပြီးမှ ထပ်လုပ်ပါ။'); }
    }
    if (url.pathname !== '/admin' && url.pathname !== '/admin/') return output('Not found', 404);
    try {
      const tab = url.searchParams.get('tab') || 'wishes';
      if (!['wishes', 'reports'].includes(tab)) return errorResponse(400, 'စာမျက်နှာကို ပြန်စစ်ပါ။');
      const offset = integer(url.searchParams.get('offset'), 0);
      const limit = 25;
      const search = url.searchParams.get('search') || ''; const filter = url.searchParams.get('filter') || 'all';
      const wishId = url.searchParams.get('wish_id') || '';
      if (search.length > 200 || !['all', 'hidden', 'visible'].includes(filter) || (wishId && !canonical(wishId))) return errorResponse(400, 'ရှာဖွေမှုကို ပြန်စစ်ပါ။');
      const result = tab === 'reports'
        ? await rpc(env, RPC.reports, { p_wish_id: wishId, p_offset: offset, p_limit: limit })
        : await rpc(env, RPC.wishes, { p_offset: offset, p_limit: limit, p_search: search, p_filter: filter });
      if (!result || !Array.isArray(result.items) || result.items.length > limit || typeof result.has_more !== 'boolean') throw new Error('Invalid backend response');
      const notice = { reviewed: 'တိုင်ကြားချက် စိစစ်မှုကို မှတ်တမ်းတင်ပြီးပါပြီ။', visibility: 'ယာယီဖျောက်ထားမှုကို ပြောင်းပြီးပါပြီ။ မူလဆုတောင်းကို မဖျက်ထားပါ။' }[url.searchParams.get('notice')] || '';
      return output(renderAdminPage({ tab, items: result.items, offset, limit, hasMore: result.has_more, search, filter, wishId, csrf: session.csrf, notice }));
    } catch { return errorResponse(503, 'Admin စာရင်းကို ယခု ဖွင့်၍ မရသေးပါ။ ခဏနေမှ ပြန်ကြိုးစားပါ။'); }
  };
}
