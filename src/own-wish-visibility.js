const PAGE_SIZE = 500;
const ARCHIVE_ID = /^[a-f0-9]{32}$/;

// JSONB ignores object key order; compare the owner-returned legacy record with
// its local display copy without implementing PostgreSQL's MD5 text formatting.
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  }
  return value;
}
export function legacyWishKey(wish) {
  return JSON.stringify(canonicalJson(wish));
}

// Owner-scoped in PostgreSQL; never accepts a caller-selected owner. The matching
// payload exists only for that owner's ID-less legacy records, not other users.
export async function loadOwnHiddenWishSources(client) {
  const hidden = new Set();
  const legacy = new Set();
  let cursor = '';
  while (true) {
    const { data, error } = await client.rpc('thadingyut_own_wish_visibility', {
      p_after: cursor, p_limit: PAGE_SIZE,
    });
    if (error || !Array.isArray(data) || data.length > PAGE_SIZE) {
      throw new Error('Own wish visibility unavailable');
    }
    let previous = cursor;
    for (const row of data) {
      if (!ARCHIVE_ID.test(row?.id || '') || row.id <= previous ||
          typeof row.source_id !== 'string' || typeof row.hidden !== 'boolean' ||
          (row.local_wish != null && (typeof row.local_wish !== 'object' || Array.isArray(row.local_wish)))) {
        throw new Error('Invalid own wish visibility');
      }
      previous = row.id;
      if (row.hidden) {
        hidden.add(row.source_id);
        if (row.local_wish != null) legacy.add(legacyWishKey(row.local_wish));
      }
    }
    if (data.length < PAGE_SIZE) return { sourceIds: [...hidden], legacyWishKeys: [...legacy] };
    cursor = previous;
  }
}
