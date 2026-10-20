import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeLanternReleaseDelay,
  createLanternArrivalPlanner,
} from '../src/lantern-arrival.js';

function seededRandom(seed = 0x7a11) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makePlan(seed) {
  const planner = createLanternArrivalPlanner({ random: seededRandom(seed) });
  const occupied = [];
  const plan = [];
  for (let i = 0; i < 100; i += 1) {
    const arrival = planner.next({ occupied, wishKey: `wish-${i}` });
    plan.push(arrival);
    occupied.push({ x: arrival.position.x, y: arrival.startY, z: arrival.position.z });
  }
  return plan;
}

test('starts immediately in 6–7 lantern waves with short jitter and finishes 100 under 20 seconds', () => {
  const plan = makePlan(17);
  const delays = plan.map(({ releaseDelay }) => releaseDelay).sort((a, b) => a - b);
  assert.ok(delays.every((delay) => Number.isFinite(delay) && delay >= 0 && delay < 20));
  assert.ok(Math.abs(delays[0]) < 1e-12, 'the first lantern must release immediately');
  assert.ok(delays.at(-1) < 20);

  const waves = [];
  for (const delay of delays) {
    const wave = waves.at(-1);
    if (!wave || delay - wave.at(-1) > 0.5) waves.push([delay]);
    else wave.push(delay);
  }
  assert.ok(waves.length >= 14 && waves.length <= 17);
  for (const wave of waves) {
    assert.ok(wave.length >= 4 && wave.length <= 7);
    assert.ok(wave.at(-1) - wave[0] <= 0.18 + 1e-12);
  }
  for (let i = 1; i < waves.length; i += 1) {
    const pause = waves[i][0] - waves[i - 1].at(-1);
    assert.ok(pause >= 0.7 && pause <= 1.2, `unexpected inter-wave pause ${pause}`);
  }
});

test('seeded plans are repeatable, broadly spread, bounded, and separated in 3D', () => {
  const first = makePlan(2026);
  const second = makePlan(2026);
  assert.deepEqual(first, second);

  const xs = first.map(({ position }) => position.x);
  const zs = first.map(({ position }) => position.z);
  assert.ok(Math.min(...xs) >= -170 && Math.max(...xs) <= 170);
  assert.ok(Math.min(...zs) >= -150 && Math.max(...zs) <= 150);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 250);
  assert.ok(Math.max(...zs) - Math.min(...zs) > 220);
  const heights = first.map(arrival => arrival.startY);
  assert.ok(Math.max(...heights) - Math.min(...heights) > 100);

  for (const arrival of first) {
    const { x, z } = arrival.position;
    assert.ok(Math.hypot(x, z + 70) >= 62);
    assert.ok(Math.hypot(x - 44, z - 152) >= 48);
    assert.ok(Number.isFinite(arrival.startY) && arrival.startY >= 14 && arrival.startY <= 159);
    assert.ok(Number.isFinite(arrival.age) && arrival.age >= 0 && arrival.age <= 1.8);
    assert.ok(Number.isFinite(arrival.maxSpeed) && arrival.maxSpeed >= 4.2 && arrival.maxSpeed <= 6.8);
    assert.ok(Number.isFinite(arrival.releaseDelay));
  }

  for (let i = 0; i < first.length; i += 1) {
    for (let j = i + 1; j < first.length; j += 1) {
      const a = first[i];
      const b = first[j];
      const distance = Math.hypot(
        a.position.x - b.position.x,
        a.startY - b.startY,
        a.position.z - b.position.z,
      );
      assert.ok(distance >= 22, `planned lanterns ${i} and ${j} were only ${distance} apart`);
    }
  }
});

test('avoids supplied occupancy without mutating the caller data', () => {
  const occupied = Object.freeze([
    Object.freeze({ x: 8, y: 4, z: -68 }),
    Object.freeze({ x: -140, y: 24, z: 100 }),
  ]);
  const before = structuredClone(occupied);
  const arrival = createLanternArrivalPlanner({ random: seededRandom(88) }).next({
    occupied,
    wishKey: 'display-only-key',
    ambient: true,
  });

  assert.deepEqual(occupied, before);
  for (const point of occupied) {
    assert.ok(Math.hypot(arrival.position.x - point.x, arrival.startY - point.y, arrival.position.z - point.z) >= 22);
  }
  assert.ok(arrival.maxSpeed >= 2.4 && arrival.maxSpeed <= 4.2);
});

test('consumes release delay with waiting, partial boundary steps, and bounded dt', () => {
  const state = { releaseDelay: 0.12 };
  assert.equal(consumeLanternReleaseDelay(state, 0.08), 0);
  assert.ok(Math.abs(state.releaseDelay - 0.04) < 1e-12);
  assert.ok(Math.abs(consumeLanternReleaseDelay(state, 0.08) - 0.04) < 1e-12);
  assert.equal(state.releaseDelay, 0);
  assert.equal(consumeLanternReleaseDelay(state, 0.08), 0.08);

  const longDelay = { releaseDelay: 0.2 };
  assert.equal(consumeLanternReleaseDelay(longDelay, 10), 0);
  assert.ok(Math.abs(longDelay.releaseDelay - 0.12) < 1e-12);
  assert.equal(consumeLanternReleaseDelay(longDelay, -1), 0);
  assert.equal(consumeLanternReleaseDelay(longDelay, Number.NaN), 0);
  assert.equal(consumeLanternReleaseDelay(longDelay, Infinity), 0);
});

test('treats a cancelled or invalid pending delay as released without scheduling timers', () => {
  const cancelled = { releaseDelay: -4 };
  assert.equal(consumeLanternReleaseDelay(cancelled, 0.05), 0.05);
  assert.equal(cancelled.releaseDelay, 0);

  const invalid = { releaseDelay: Number.NaN };
  assert.equal(consumeLanternReleaseDelay(invalid, 0.03), 0.03);
  assert.equal(invalid.releaseDelay, 0);
  assert.equal(consumeLanternReleaseDelay({}, 0.02), 0.02);
});
