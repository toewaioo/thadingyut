const DEFAULT_MANUAL_TIME = 18;
const FALLBACK_TIME_ZONE = 'Browser local time';
const UNSAFE_SAVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Build a fresh scene clock state from saved settings.
 * A persisted mode is deliberately never restored: each scene starts in auto,
 * while the preserved manualTime can be selected for preview this session.
 */
export function createSkyClockState(saved) {
  const state = {};

  if (saved !== null && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const key of Object.keys(saved)) {
      if (key === 'mode' || key === 'manualTime' || UNSAFE_SAVED_KEYS.has(key)) {
        continue;
      }

      // Copy only data properties; avoid invoking untrusted getters from settings.
      const descriptor = Object.getOwnPropertyDescriptor(saved, key);
      if (descriptor && Object.hasOwn(descriptor, 'value')) {
        state[key] = descriptor.value;
      }
    }
  }

  const manualTimeDescriptor =
    saved !== null && typeof saved === 'object' && !Array.isArray(saved)
      ? Object.getOwnPropertyDescriptor(saved, 'manualTime')
      : undefined;
  const savedManualTime =
    manualTimeDescriptor && Object.hasOwn(manualTimeDescriptor, 'value')
      ? manualTimeDescriptor.value
      : undefined;

  state.mode = 'auto';
  state.manualTime =
    typeof savedManualTime === 'number' &&
    Number.isFinite(savedManualTime) &&
    savedManualTime >= 0 &&
    savedManualTime <= 24
      ? savedManualTime
      : DEFAULT_MANUAL_TIME;

  return state;
}

/** Return fractional local clock hours, or the selected manual preview hour. */
export function getSkyHours(state, now = new Date()) {
  if (
    state !== null &&
    typeof state === 'object' &&
    !Array.isArray(state) &&
    state.mode === 'manual' &&
    typeof state.manualTime === 'number' &&
    Number.isFinite(state.manualTime)
  ) {
    return Math.min(24, Math.max(0, state.manualTime));
  }

  const date = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  return (
    date.getHours() +
    date.getMinutes() / 60 +
    date.getSeconds() / 3600 +
    date.getMilliseconds() / 3600000
  );
}

/** Return the IANA timezone used by this browser, if available. */
export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}
