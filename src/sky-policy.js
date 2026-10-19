export const DEFAULT_WISH_COUNT = 60;
export const MAX_LANTERNS = 100;
export const MAX_EXTRA_WISH_LANTERNS = MAX_LANTERNS - DEFAULT_WISH_COUNT;

function timeValue(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function databaseKey(wish) {
  if (wish?.source_id != null) return `id:${String(wish.source_id)}`;
  if (wish?.id != null) return `id:${String(wish.id)}`;
  return `text:${String(wish?.text || '')}\u0000${timeValue(wish?.at)}`;
}

function localKey(wish) {
  if (wish?.id != null) return `id:${String(wish.id)}`;
  return `text:${String(wish?.text || '')}\u0000${timeValue(wish?.at)}`;
}

function newestFirst(a, b) {
  return timeValue(b.at) - timeValue(a.at) || String(databaseKey(b)).localeCompare(String(databaseKey(a)));
}

/**
 * Plan the visible sky from a complete database feed and locally saved wishes.
 * More than 60 database rows switches to a database-only sky; the most recent
 * 100 are shown. Otherwise preserve 60 ambient lanterns and up to 40 wishes.
 */
export function planSkyLanterns({
  databaseWishes = [],
  localWishes = [],
  ambientCount = DEFAULT_WISH_COUNT,
  maxLanterns = MAX_LANTERNS
} = {}) {
  const completeDatabaseCount = Array.isArray(databaseWishes) ? databaseWishes.length : 0;
  const database = Array.isArray(databaseWishes)
    ? databaseWishes.filter(wish => wish && typeof wish.text === 'string' && wish.text.trim())
    : [];
  const local = Array.isArray(localWishes)
    ? localWishes.filter(wish => wish && typeof wish.text === 'string' && wish.text.trim())
    : [];
  const databaseOnly = completeDatabaseCount > DEFAULT_WISH_COUNT;
  const capacity = Math.max(0, Math.floor(maxLanterns));
  const localById = new Map(local.filter(wish => wish.id != null).map(wish => [String(wish.id), wish]));
  const dedupedDatabase = new Map();
  for (const wish of database) {
    const key = databaseKey(wish);
    const localMatch = wish.source_id != null
      ? localById.get(String(wish.source_id))
      : (wish.id != null ? localById.get(String(wish.id)) : null);
    dedupedDatabase.set(key, {
      ...(localMatch || {}),
      ...wish,
      _isCommunity: true,
      _skyKey: key
    });
  }

  let wishes;
  let ambient = 0;
  if (databaseOnly) {
    // The poll is complete: do not include local-only wishes or ambient/demo content.
    wishes = [...dedupedDatabase.values()].sort(newestFirst).slice(0, capacity);
  } else {
    ambient = Math.min(Math.max(0, Math.floor(ambientCount)), capacity);
    const combined = new Map();
    for (const wish of local) {
      const key = localKey(wish);
      combined.set(key, { ...wish, _isCommunity: false, _skyKey: key });
    }
    // Prefer the database representation when it matches a locally saved wish,
    // ensuring it becomes the canonical sky identity once sync catches up.
    for (const [key, wish] of dedupedDatabase) combined.set(key, wish);
    wishes = [...combined.values()].sort(newestFirst).slice(0, Math.max(0, capacity - ambient));
  }
  return { databaseOnly, ambientCount: ambient, wishes };
}
