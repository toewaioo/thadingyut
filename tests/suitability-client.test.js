import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { requestWishApproval, CHECK_UNAVAILABLE_MESSAGE } from '../src/wish-preflight.js';

const source = await readFile(new URL('../src/legacy.js', import.meta.url), 'utf8');
const launch = source.slice(source.indexOf('async function launchWish(){'), source.indexOf("launchBtn.addEventListener('click', launchWish);"));
function harness(approval) {
  const state = { spawns: 0, saves: 0, streaks: 0, errors: [] };
  const ctx = {
    cameraFollow: null, wishCheckPending: false, composeRevision: 0,
    wishInput: { value: 'မိသားစုအားလုံး ကျန်းမာပါစေ', focus() {}, blur() {} },
    dedicateInput: {}, launchBtn: { disabled: false, setAttribute() {}, removeAttribute() {} },
    composeBackdrop: { classList: { contains: () => true } },
    charCount: { classList: { remove() {} } },
    prefs: { dedicate: 'မိဘ', color: 20, shape: 'lotus', size: 1.15 },
    userWishes: [], soundEnabled: false,
    requestWishApproval: approval,
    showWishError: msg => state.errors.push(msg), showToast() {},
    getUserLaunchPosition: () => ({ x: 1, z: 2 }),
    spawnLantern: () => { state.spawns++; return { label: { position: {} } }; },
    saveWishes: () => { state.saves++; },
    closeCompose: () => { ctx.composeRevision++; },
    updateStreak: () => { state.streaks++; return { count: 1 }; },
    scheduleLanternFireworks() {},
    startCameraFollow: lantern => { ctx.cameraFollow = { lantern }; },
  };
  vm.createContext(ctx); vm.runInContext(launch, ctx);
  return { ctx, state };
}

test('preflight fails closed for network failure, malformed approval and non-JSON server output', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); },
    async () => new Response('{"allowed":"true"}', { status: 200 }),
    async () => new Response('<html>missing API</html>', { status: 200 })]) {
    const result = await requestWishApproval('မိသားစု ကျန်းမာပါစေ', '', fetcher);
    assert.equal(result.allowed, false);
    assert.equal(result.message, CHECK_UNAVAILABLE_MESSAGE);
  }
});

test('local unsuitable text never reaches the HTTP request and valid text must receive explicit approval', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response('{"allowed":true}'); };
  assert.equal((await requestWishApproval('မအေလိုး', '', fetcher)).allowed, false);
  assert.equal(calls, 0);
  assert.equal((await requestWishApproval('ကမ္ဘာကြီး ငြိမ်းချမ်းပါစေ', '', fetcher)).allowed, true);
  assert.equal(calls, 1);
});

test('a rejected wish creates no lantern, saved record, streak, or cleared draft', async () => {
  const { ctx, state } = harness(async () => ({ allowed: false, message: 'စာသားကို ပြန်ရေးပေးပါ။' }));
  const original = ctx.wishInput.value;
  await ctx.launchWish();
  assert.equal(state.spawns, 0); assert.equal(state.saves, 0); assert.equal(state.streaks, 0);
  assert.equal(ctx.userWishes.length, 0); assert.equal(ctx.wishInput.value, original);
  assert.equal(ctx.launchBtn.disabled, false); assert.equal(ctx.wishInput.readOnly, false);
  assert.ok(state.errors.includes('စာသားကို ပြန်ရေးပေးပါ။'));
});

test('double submission waits for one server check and uses the checked dedication snapshot', async () => {
  let release, calls = 0;
  const { ctx, state } = harness(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = ctx.launchWish();
  await ctx.launchWish();
  assert.equal(calls, 1); assert.equal(state.spawns, 0); assert.equal(ctx.launchBtn.disabled, true);
  ctx.prefs.dedicate = 'changed after check';
  release({ allowed: true }); await first;
  assert.equal(state.spawns, 1); assert.equal(state.saves, 1); assert.equal(state.streaks, 1);
  assert.equal(ctx.userWishes[0].dedication, 'မိဘ');
  assert.equal(ctx.launchBtn.disabled, true, 'camera-follow remains locked');
});

test('closing compose during preflight cancels the pending release', async () => {
  let release;
  const { ctx, state } = harness(() => new Promise(resolve => { release = resolve; }));
  const pending = ctx.launchWish(); ctx.composeRevision++;
  release({ allowed: true }); await pending;
  assert.equal(state.spawns, 0); assert.equal(ctx.userWishes.length, 0);
  assert.equal(ctx.launchBtn.disabled, false);
});

test('Burmese inline alert is safe and suitability sync rejection does not activate offline bypass', async () => {
  const markup = await readFile(new URL('../src/legacy-ui.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(markup, /id="wishSuitabilityError"[^>]*role="alert"/);
  assert.match(source, /suitabilityError\.textContent = message/);
  assert.match(app, /if \(isSuitabilityError\(error\)\) \{[\s\S]*?return;\s*\}\s*useLocalMode\(error\)/);
});
