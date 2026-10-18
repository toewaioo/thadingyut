import { resolve, sep } from 'node:path';
import { handleConfigRequest, handleSupabaseRequest } from './server/supabase-proxy.js';

const root = resolve(import.meta.dir, 'dist');
const port = Number(Bun.env.PORT ?? 4173);

Bun.serve({
  hostname: '0.0.0.0',
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/config') return handleConfigRequest(request, Bun.env);
    if (url.pathname.startsWith('/api/supabase/')) return handleSupabaseRequest(request, Bun.env);
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
  },
});

console.log(`Wish lantern app listening on 0.0.0.0:${port}`);
