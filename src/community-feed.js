export const COMMUNITY_PAGE_SIZE = 500;
export const COMMUNITY_POLL_MS = 10000;

export async function loadCommunityWishes(fetcher, key, signal) {
  const wishes = [];
  let cursor = '';
  while (true) {
    const query = new URLSearchParams({
      select: 'id,wish', order: 'id.asc', limit: String(COMMUNITY_PAGE_SIZE),
    });
    if (cursor) query.set('id', `gt.${cursor}`);
    const response = await fetcher(`/api/supabase?__route=rest/v1/thadingyut_public_wishes&${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store', signal,
    });
    if (!response.ok) throw new Error(`Public wishes unavailable (${response.status})`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid public wishes response');
    for (const row of rows) {
      if (row && typeof row.id === 'string' && typeof row.wish?.text === 'string') {
        wishes.push({ ...row.wish, id: row.id });
      }
    }
    if (rows.length < COMMUNITY_PAGE_SIZE) break;
    const next = rows.at(-1)?.id;
    if (!next || next === cursor) throw new Error('Invalid public wishes cursor');
    cursor = next;
  }
  return wishes.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0) || a.id.localeCompare(b.id));
}

// Public reading is independent from anonymous login/private profile sync.
// A temporary auth failure must not hide the community from other visitors.
export function startCommunityFeed({ fetcher = window.fetch.bind(window), onWishes, onError = () => {} }) {
  let stopped = false;
  let pending = false;
  let key;
  let controller;
  let timer;
  const refresh = async () => {
    if (stopped || pending) return;
    pending = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      if (!key) {
        const config = await fetcher('/api/config', { cache: 'no-store', signal: controller.signal });
        if (!config.ok) throw new Error('Public wishes configuration unavailable');
        key = (await config.json()).supabaseKey;
        if (!key) throw new Error('Public wishes key unavailable');
      }
      const wishes = await loadCommunityWishes(fetcher, key, controller.signal);
      if (!stopped) onWishes(wishes);
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      clearTimeout(timeout);
      pending = false;
    }
  };
  const onVisible = () => { if (!document.hidden) void refresh(); };
  const onChange = () => { clearTimeout(timer); timer = setTimeout(refresh, 1500); };
  void refresh();
  const interval = setInterval(() => { if (!document.hidden) void refresh(); }, COMMUNITY_POLL_MS);
  window.addEventListener('thadingyut:data-change', onChange);
  window.addEventListener('online', onVisible);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    controller?.abort();
    clearInterval(interval);
    clearTimeout(timer);
    window.removeEventListener('thadingyut:data-change', onChange);
    window.removeEventListener('online', onVisible);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
