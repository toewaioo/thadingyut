import { resolve, sep } from 'node:path';
import { handleConfigRequest, handleSupabaseRequest } from './server/supabase-proxy.js';
import { handleWishCheck } from './server/wish-suitability.js';
import { createAdminHandler } from './server/admin.js';

const root = resolve(import.meta.dir, 'dist');
const port = Number(Bun.env.PORT ?? 4173);
const admin = createAdminHandler();

async function fetchRequest(request: Request, server: any) {
    const url = new URL(request.url);
    const adminResponse = await admin(request, Bun.env, { clientIp: server.requestIP(request)?.address || 'unknown' });
    if (adminResponse) return adminResponse;
    if (url.pathname.startsWith('/.well-known/acme-challenge/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      const token = url.pathname.slice('/.well-known/acme-challenge/'.length);
      const webroot = Bun.env.THADINGYUT_ACME_WEBROOT;
      if (!webroot || !/^[A-Za-z0-9_-]{8,200}$/.test(token)) return new Response('Not found', { status: 404 });
      const challenge = Bun.file(resolve(webroot, '.well-known/acme-challenge', token));
      if (!(await challenge.exists())) return new Response('Not found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : challenge, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/api/config') return handleConfigRequest(request, Bun.env);
    if (url.pathname === '/api/wish-check') return handleWishCheck(request);
    if (url.pathname === '/api/supabase' || url.pathname.startsWith('/api/supabase/')) return handleSupabaseRequest(request, Bun.env);
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    if (url.pathname === '/healthz') {
      return new Response('ok\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const requested = resolve(root, `.${pathname}`);
    if (requested !== root && !requested.startsWith(root + sep)) {
      return new Response('Not found', { status: 404 });
    }

    let file = Bun.file(requested);
    if (!(await file.exists()) || pathname.endsWith('/')) {
      file = Bun.file(resolve(root, 'index.html'));
    }
    if (!(await file.exists())) return new Response('Build not found', { status: 503 });

    const headers = new Headers();
    if (pathname === '/' || pathname.endsWith('.html')) {
      headers.set('cache-control', 'no-cache');
    } else {
      headers.set('cache-control', 'public, max-age=31536000, immutable');
    }
    return new Response(file, { headers });
}

const cert = Bun.env.THADINGYUT_TLS_CERT;
const key = Bun.env.THADINGYUT_TLS_KEY;
if (Boolean(cert) !== Boolean(key)) throw new Error('TLS configuration incomplete');
const adminEnabled = Boolean(Bun.env.THADINGYUT_ADMIN_PASSWORD_HASH || Bun.env.THADINGYUT_ADMIN_BACKEND_KEY);
if (adminEnabled && !cert && Bun.env.THADINGYUT_ADMIN_BOOTSTRAP_HTTP !== 'true') throw new Error('Admin requires TLS configuration');
const tlsPort = Number(Bun.env.THADINGYUT_TLS_PORT || 443);
if (cert && tlsPort !== Number(new URL(Bun.env.THADINGYUT_PUBLIC_ORIGIN || 'https://localhost').port || 443)) throw new Error('Admin TLS port does not match its public origin');
// HTTP sky users keep their current origin/storage; admin is HTTPS-only.
if (cert && key) Bun.serve({ hostname: '0.0.0.0', port: tlsPort, tls: { cert: Bun.file(cert), key: Bun.file(key) }, fetch: fetchRequest });
Bun.serve({ hostname: '0.0.0.0', port, fetch: fetchRequest });
console.log(`Wish lantern app listening on HTTP port ${port}${cert ? ' with HTTPS enabled' : ''}`);
