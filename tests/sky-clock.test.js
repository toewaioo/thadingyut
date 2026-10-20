import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createSkyClockState, getBrowserTimeZone, getSkyHours } from '../src/sky-clock.js';

const modulePath = fileURLToPath(new URL('../src/sky-clock.js', import.meta.url));
const fixedInstant = '2026-06-15T12:34:56.500Z';
const expectedSummerHours = 12 + 34 / 60 + 56 / 3600 + 500 / 3600000;

function localHours(date) {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 + date.getMilliseconds() / 3600000;
}

function hoursInTimeZone(timeZone, instant = fixedInstant) {
  const script = `import { getSkyHours } from ${JSON.stringify(new URL(`file://${modulePath}`).href)}; console.log(getSkyHours({}, new Date(${JSON.stringify(instant)})));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: timeZone },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout.replace(/\u001b\[[0-9;]*m/g, '').trim();
  const hours = Number(output);
  assert.ok(Number.isFinite(hours), JSON.stringify({ timeZone, status: result.status, stdout: result.stdout, stderr: result.stderr }));
  return hours;
}

test('saved manual mode never forces a fresh scene out of browser-local auto mode', () => {
  const saved = { mode: 'manual', manualTime: 2, theme: 'festival' };
  const state = createSkyClockState(saved);

  assert.equal(state.mode, 'auto');
  assert.equal(state.manualTime, 2);
  assert.equal(state.theme, 'festival');
  const now = new Date('2026-06-15T12:00:00Z');
  assert.equal(getSkyHours(state, now), localHours(now));
});

test('creating a state preserves saved settings without mutating the saved object', () => {
  const saved = { mode: 'manual', manualTime: 8.5, nested: { setting: true } };
  const before = structuredClone(saved);
  const state = createSkyClockState(saved);

  assert.deepEqual(saved, before);
  assert.notEqual(state, saved);
  assert.equal(state.nested, saved.nested);
  assert.equal(state.mode, 'auto');
});

test('invalid settings safely default manual preview and never produce NaN', () => {
  for (const saved of [null, undefined, [], 'manual', 4, { manualTime: '12' }, { manualTime: NaN }, { manualTime: Infinity }, { manualTime: -0.1 }, { manualTime: 24.1 }]) {
    const state = createSkyClockState(saved);
    assert.equal(state.mode, 'auto');
    assert.equal(state.manualTime, 18);
    const now = new Date('2026-06-15T12:00:00Z');
    assert.equal(getSkyHours(state, now), localHours(now));
  }
});

test('manual preview is available in-session and clamps finite values to 0–24', () => {
  assert.equal(getSkyHours({ mode: 'manual', manualTime: 0 }), 0);
  assert.equal(getSkyHours({ mode: 'manual', manualTime: 24 }), 24);
  assert.equal(getSkyHours({ mode: 'manual', manualTime: -4 }), 0);
  assert.equal(getSkyHours({ mode: 'manual', manualTime: 30 }), 24);
  const now = new Date('2026-06-15T12:00:00Z');
  assert.equal(getSkyHours({ mode: 'manual', manualTime: NaN }, now), localHours(now));
});

test('auto mode ignores a saved or stale manual timestamp', () => {
  const now = new Date('2026-06-15T12:34:56.500Z');
  assert.equal(getSkyHours({ mode: 'auto', manualTime: 2 }, now), localHours(now));
  assert.equal(getSkyHours({ manualTime: 2 }, now), localHours(now));
});

test('same instant uses the browser local clock in UTC, Yangon, and New York', () => {
  assert.ok(Math.abs(hoursInTimeZone('UTC') - expectedSummerHours) < 1e-10, String(hoursInTimeZone('UTC')));
  assert.ok(Math.abs(hoursInTimeZone('Asia/Yangon') - (expectedSummerHours + 6.5)) < 1e-10, String(hoursInTimeZone('Asia/Yangon')));
  assert.ok(Math.abs(hoursInTimeZone('America/New_York') - (expectedSummerHours - 4)) < 1e-10, String(hoursInTimeZone('America/New_York')));
});

test('New York local clock observes the winter daylight-saving offset', () => {
  const winter = hoursInTimeZone('America/New_York', '2026-01-15T12:34:56.500Z');
  assert.ok(Math.abs(winter - (expectedSummerHours - 5)) < 1e-10);
  assert.ok(Math.abs((expectedSummerHours - 4) - winter - 1) < 1e-10);
});

test('local fractional hours wrap from the end of a day to midnight', () => {
  const nearMidnight = hoursInTimeZone('UTC', '2026-06-15T23:59:59.999Z');
  const midnight = hoursInTimeZone('UTC', '2026-06-16T00:00:00.000Z');
  assert.ok(nearMidnight < 24 && nearMidnight > 23.999999);
  assert.equal(midnight, 0);
});

test('timezone label uses the browser zone and has a fallback value', () => {
  assert.equal(typeof getBrowserTimeZone(), 'string');
  assert.ok(getBrowserTimeZone().length > 0);
});
