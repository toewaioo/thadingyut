import { Readable } from 'node:stream';

const DEFAULT_SUPABASE_URL = 'https://civxldsafwtsjzadxiwl.supabase.co';
const MAX_BODY_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;

const ROUTES = new Map([
  ['/auth/v1/signup', new Set(['POST'])],
  ['/auth/v1/token', new Set(['POST'])],
  ['/auth/v1/user', new Set(['GET', 'PUT'])],
  ['/auth/v1/logout', new Set(['POST'])],
  ['/rest/v1/thadingyut_profiles', new Set(['GET', 'POST'])],
  ['/rest/v1/thadingyut_public_wishes', new Set(['GET'])],
]);

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function validateSupabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid Supabase URL configuration');
  }
  // Only a project host over HTTPS may be used; this prevents the proxy from
  // becoming a general-purpose URL forwarder or reaching local/private hosts.
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.supabase\.co$/.test(url.hostname) ||
    (url.port && url.port !== '443') ||
    url.username || url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search || url.hash
  ) {
    throw new Error('Invalid Supabase URL configuration');
  }
  return url.origin;
}

function isServiceRoleKey(key) {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length < 2) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export function getPublicConfig(env = process.env) {
  const supabaseUrl = validateSupabaseUrl(
    env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  );
  const rawKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const supabaseKey = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (supabaseKey && (/[\r\n]/.test(supabaseKey) || supabaseKey.length > 8192 || isServiceRoleKey(supabaseKey))) {
    throw new Error('Invalid public Supabase key configuration');
  }
  return { supabaseUrl, supabaseKey: supabaseKey || undefined };
}

function configOrError(env) {
  try {
    const config = getPublicConfig(env);
    if (!config.supabaseKey) return { error: jsonResponse(503, { error: 'Supabase is not configured' }) };
    return { config };
  } catch {
    return { error: jsonResponse(503, { error: 'Supabase is not configured' }) };
  }
}

function isSameOrigin(requestUrl, originHeader) {
  if (originHeader === null) return true;
  // Origin is a serialized origin, not a URL with a path or credentials.
  try {
    const origin = new URL(originHeader);
    return originHeader === origin.origin && origin.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

function allowedRoute(pathname, method) {
  const methods = ROUTES.get(pathname);
  return methods?.has(method) ? 'proxy' : methods && method === 'OPTIONS' ? 'options' : null;
}

function limitedBody(body, onLimit) {
  if (!body) return null;
  let received = 0;
  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_BODY_BYTES) {
        onLimit();
        controller.error(new Error('Request body exceeds limit'));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}

export async function handleSupabaseRequest(request, env = process.env, upstreamFetch = fetch) {
  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return jsonResponse(400, { error: 'Invalid request' });
  }
  if (!isSameOrigin(requestUrl, request.headers.get('origin'))) {
    return jsonResponse(403, { error: 'Cross-origin request denied' });
  }

  const method = request.method.toUpperCase();
  // A plain Vite deployment has no Next.js catch-all API routing. All
  // production SDK calls target the real /api/supabase function instead.
  let routedPathname;
  if (requestUrl.pathname === '/api/supabase') {
    const routes = requestUrl.searchParams.getAll('__route');
    if (routes.length !== 1 || !routes[0] || routes[0].startsWith('/')) {
      return jsonResponse(404, { error: 'Route not allowed' });
    }
    routedPathname = `/${routes[0]}`;
    requestUrl.searchParams.delete('__route');
  } else {
    routedPathname = requestUrl.pathname.startsWith('/api/supabase/')
      ? requestUrl.pathname.slice('/api/supabase'.length)
      : requestUrl.pathname;
  }
  const routePermission = allowedRoute(routedPathname, method);
  if (!routePermission) return jsonResponse(404, { error: 'Route not allowed' });
  if (routePermission === 'options') {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  const { config, error } = configOrError(env);
  if (error) return error;

  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return jsonResponse(413, { error: 'Request body too large' });
  }

  let body = null;
  let bodyExceededLimit = false;
  if (request.body) {
    if (!['POST', 'PUT', 'PATCH'].includes(method)) {
      return jsonResponse(400, { error: 'Request body not allowed' });
    }
    body = limitedBody(request.body, () => { bodyExceededLimit = true; });
  }

  const headers = new Headers({ apikey: config.supabaseKey });
  for (const name of ['content-type', 'accept', 'prefer', 'x-client-info', 'range']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const authorization = request.headers.get('authorization');
  if (authorization && /^Bearer\s+\S+$/i.test(authorization) && authorization.length <= 8192) {
    headers.set('authorization', authorization);
  }

  // routedPathname is already constrained to an exact allowlisted route;
  // only its query is carried to the fixed configured project origin.
  const upstreamUrl = `${config.supabaseUrl}${routedPathname}${requestUrl.search}`;
  const init = {
    method,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  };
  if (body) {
    init.body = body;
    init.duplex = 'half';
  }

  try {
    const upstream = await upstreamFetch(upstreamUrl, init);
    if (!upstream.ok) {
      const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
      return jsonResponse(status, { error: 'Supabase request failed' });
    }
    const responseHeaders = new Headers({ 'cache-control': 'no-store' });
    for (const name of ['content-type', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value !== null) responseHeaders.set(name, value);
    }
    const responseBody = [204, 205, 304].includes(upstream.status) ? null : upstream.body;
    return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    if (bodyExceededLimit) return jsonResponse(413, { error: 'Request body too large' });
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return jsonResponse(504, { error: 'Supabase request timed out' });
    }
    return jsonResponse(502, { error: 'Supabase request failed' });
  }
}

export async function handleConfigRequest(_request, env = process.env) {
  const { config, error } = configOrError(env);
  if (error) return error;
  return jsonResponse(200, { supabaseUrl: config.supabaseUrl, supabaseKey: config.supabaseKey });
}

/** Convert a Vercel-style Node request/response pair to and from Web APIs. */
export async function nodeRequestToResponse(req, res, handler, { pathPrefix = '' } = {}) {
  const sendJsonError = (status, message) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: message }));
  };

  try {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const proto = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
    const host = forwardedHost || req.headers.host;
    if (!host || !['http', 'https'].includes(proto)) return sendJsonError(400, 'Invalid request');
    let rawUrl = req.url || '/';
    if (pathPrefix && rawUrl.startsWith(pathPrefix) && (rawUrl.length === pathPrefix.length || rawUrl[pathPrefix.length] === '/' || rawUrl[pathPrefix.length] === '?')) {
      rawUrl = rawUrl.slice(pathPrefix.length) || '/';
    }
    const requestUrl = new URL(rawUrl, `${proto}://${host}`);
    const method = String(req.method || 'GET').toUpperCase();
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(', '));
      else if (typeof value === 'string') headers.set(name, value);
    }

    let body;
    if (!['GET', 'HEAD'].includes(method)) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY_BYTES) return sendJsonError(413, 'Request body too large');
        chunks.push(buffer);
      }
      if (size) body = Buffer.concat(chunks, size);
    }
    const request = new Request(requestUrl, { method, headers, ...(body ? { body } : {}) });
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (!response.body) return res.end();
    const stream = Readable.fromWeb(response.body);
    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      res.on('error', reject);
      res.on('finish', resolve);
      stream.pipe(res);
    });
  } catch {
    if (!res.headersSent) sendJsonError(400, 'Invalid request');
    else res.destroy();
  }
}
