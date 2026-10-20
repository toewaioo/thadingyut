const MAX_LANTERNS = 100;
const MIN_WAVE_PAUSE = 0.95;
const RANDOM_WAVE_PAUSE = 0.25;
const MAX_WITHIN_WAVE_JITTER = 0.18;
const MIN_SEPARATION = 22;
const MAX_X = 170;
const MAX_Z = 150;
const CAMERA_X = 0;
const CAMERA_Z = -70;
const CAMERA_CLEARANCE = 62;
const DEFAULT_VIEW_X = 44;
const DEFAULT_VIEW_Z = 152;
const DEFAULT_VIEW_CLEARANCE = 48;

function boundedRandom(random) {
  let value;
  try {
    value = random();
  } catch {
    value = 0.5;
  }
  return Number.isFinite(value) ? Math.min(1 - Number.EPSILON, Math.max(0, value)) : 0.5;
}

function validOccupied(occupied) {
  if (!Array.isArray(occupied)) return [];
  return occupied.filter((point) => point &&
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
}

function distance3D(x, y, z, point) {
  return Math.hypot(x - point.x, y - point.y, z - point.z);
}

function isCameraClear(x, z) {
  return Math.hypot(x - CAMERA_X, z - CAMERA_Z) >= CAMERA_CLEARANCE &&
    Math.hypot(x - DEFAULT_VIEW_X, z - DEFAULT_VIEW_Z) >= DEFAULT_VIEW_CLEARANCE;
}

function choosePosition(y, occupied, random) {
  let best = null;
  let bestDistance = -1;

  const consider = (x, z) => {
    const nearest = occupied.reduce((distance, point) =>
      Math.min(distance, distance3D(x, y, z, point)), Infinity);
    if (nearest > bestDistance) {
      best = { x, z };
      bestDistance = nearest;
    }
    return nearest >= MIN_SEPARATION;
  };

  // Random rejection keeps ordinary placements naturally spread while ensuring
  // a deterministic, bounded fallback for adversarial/constant random sources.
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const x = (boundedRandom(random) * 2 - 1) * MAX_X;
    const z = (boundedRandom(random) * 2 - 1) * MAX_Z;
    if (isCameraClear(x, z) && consider(x, z)) return { position: { x, z }, nearest: bestDistance };
  }

  // Scan a broad fixed lattice to avoid getting stuck when the random source
  // repeats one point or random candidates happen to collide with occupied ones.
  for (let ix = 0; ix <= 24; ix += 1) {
    const x = -MAX_X + (2 * MAX_X * ix) / 24;
    for (let iz = 0; iz <= 24; iz += 1) {
      const z = -MAX_Z + (2 * MAX_Z * iz) / 24;
      if (isCameraClear(x, z) && consider(x, z) && bestDistance >= MIN_SEPARATION) {
        return { position: { x, z }, nearest: bestDistance };
      }
    }
  }

  // If a caller supplies an unrealistically dense occupied set, maintain finite
  // bounded output and return the best separated candidate available.
  return { position: best ?? { x: MAX_X, z: MAX_Z }, nearest: bestDistance };
}

/**
 * Make a display-only schedule of lantern releases in small immediate waves.
 * `random` is injectable so tests and previews can reproduce a complete plan;
 * the default is natural runtime randomness. At most 100 lanterns are planned.
 */
export function createLanternArrivalPlanner({ random = Math.random } = {}) {
  if (typeof random !== 'function') random = Math.random;
  let planned = 0;
  let waveSize = 0;
  let inWave = 0;
  let waveStartDelay = 0;

  return {
    next({ occupied = [], wishKey = '', ambient = false } = {}) {
      // These values are intentionally local display/physics inputs only; no
      // wish record or supplied occupancy object is modified.
      void wishKey;
      const index = Math.min(planned, MAX_LANTERNS - 1);
      const beyondCap = planned >= MAX_LANTERNS;
      if (!beyondCap) planned += 1;
      const r = () => boundedRandom(random);

      if (!beyondCap && inWave >= waveSize) {
        if (index > 0) waveStartDelay += MIN_WAVE_PAUSE + r() * RANDOM_WAVE_PAUSE;
        const remaining = MAX_LANTERNS - index;
        const preferredSize = 6 + Math.floor(r() * 2);
        waveSize = remaining > preferredSize && remaining - preferredSize < 4
          ? remaining - 4
          : Math.min(preferredSize, remaining);
        inWave = 0;
      }
      const releaseDelay = index === 0
        ? 0
        : waveStartDelay + r() * MAX_WITHIN_WAVE_JITTER;
      if (!beyondCap) inWave += 1;

      // Existing sky wishes appear at varied heights, not a flat ground-level
      // launch wall. Brand-new manual launches keep their separate launch path.
      const alreadyAloft = index < 3;
      const startY = 14 + r() * 145;
      const age = alreadyAloft ? 0.65 + r() * 1.15 : 0;
      const positionChoice = choosePosition(startY, validOccupied(occupied), r);
      const maxSpeed = ambient ? 2.4 + r() * 1.8 : 4.2 + r() * 2.6;

      return {
        position: positionChoice.position,
        startY,
        age,
        maxSpeed,
        releaseDelay,
      };
    },
  };
}

/**
 * Consume at most 80 ms of a physics step while honoring a pending release.
 * Returns only the part of `dt` that occurs after the lantern is released.
 */
export function consumeLanternReleaseDelay(state, dt) {
  const step = Number.isFinite(dt) ? Math.min(0.08, Math.max(0, dt)) : 0;
  if (!state || typeof state !== 'object') return step;

  const delay = Number.isFinite(state.releaseDelay) ? Math.max(0, state.releaseDelay) : 0;
  const waiting = Math.min(delay, step);
  state.releaseDelay = Math.max(0, delay - step);
  return Math.max(0, step - waiting);
}
