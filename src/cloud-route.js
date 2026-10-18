// Vite on Vercel does not provide Next.js-style catch-all API routing.
// The SDK can keep its normal URL layout; transport uses one real function.
export function toCloudProxyInput(input, origin) {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, origin);
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/api/supabase/')) return input;
  const route = url.pathname.slice('/api/supabase/'.length);
  url.pathname = '/api/supabase';
  url.searchParams.delete('__route');
  url.searchParams.set('__route', route);
  return input instanceof Request ? new Request(url, input) : url.href;
}
