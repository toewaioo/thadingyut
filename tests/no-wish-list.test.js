import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path) => readFileSync(resolve(here, path), 'utf8');
const legacyUi = source('../src/legacy-ui.html');
const legacyJs = source('../src/legacy.js');
const app = source('../src/App.jsx');

test('legacy markup no longer contains wish-list viewing controls or panel IDs', () => {
  for (const id of [
    'wishesBtn', 'wishesBadge', 'wishesBackdrop', 'wishesClose', 'wishesList',
    'statTotal', 'statBlessed', 'statFlying', 'streakText',
  ]) {
    assert.doesNotMatch(legacyUi, new RegExp(`\\bid=["']${id}["']`), `${id} should not be rendered`);
  }
});

test('legacy JavaScript has no wish-list render or viewing-handler references or badge calls', () => {
  for (const removedReference of [
    'wishesBtn', 'wishesBadge', 'wishesBackdrop', 'wishesClose', 'wishesList',
    'renderWishesPanel', 'updateWishesBadge',
  ]) {
    assert.equal(legacyJs.includes(removedReference), false, `${removedReference} should be removed from legacy.js`);
  }
});

test('wish records remain locally stored and uploaded only in the authenticated owner profile', () => {
  assert.match(app, /wishes:\s*read\(STORAGE_KEYS\.wishes,\s*\[\]\)/, 'local wish records remain in readLocalBundle');
  assert.match(app, /\.eq\(['"]owner_id['"],\s*ownerId\)/, 'profile reads remain owner-scoped');
  assert.match(app, /\.upsert\s*\(/, 'profile upsert remains available');
  assert.match(app, /\.upsert\s*\([\s\S]*?\.\.\.readLocalBundle\(\)[\s\S]*?onConflict:\s*['"]owner_id['"]/, 'profile upsert still saves the local bundle keyed by owner_id');
  assert.match(legacyJs, /function\s+saveWishes\s*\(/, 'wish persistence helper remains');
  assert.match(legacyJs, /localStorage\.setItem\(['"]thadingyut_wishes_v2['"],\s*JSON\.stringify\(userWishes\)\)/, 'user wishes remain stored locally');
  assert.match(legacyJs, /userWishes\.push\(savedWish\)/, 'newly launched wishes remain recorded');
});

test('public community feed remains connected to the lantern scene', () => {
  assert.match(app, /import\s*\{\s*startCommunityFeed\s*\}\s*from\s*['"]\.\/community-feed\.js['"]/, 'App still imports the public feed');
  assert.match(app, /startCommunityFeed\s*\(/, 'App still starts the public feed');
  assert.match(app, /thadingyut:community-wishes/, 'App still dispatches feed updates to the scene');
  assert.match(legacyJs, /addEventListener\(['"]thadingyut:community-wishes['"]/, 'legacy scene still receives feed updates');
  assert.match(legacyJs, /function\s+syncCommunityWishes\s*\(/, 'community wishes still spawn into the scene');
});

test('public wish card and sharing controls remain available', () => {
  assert.match(legacyUi, /id=["']cardBackdrop["']/, 'wish card panel remains in the markup');
  assert.match(legacyUi, /id=["']cardText["']/, 'wish card text remains in the markup');
  assert.match(legacyUi, /id=["']cardShare["']/, 'card sharing control remains in the markup');
  assert.match(legacyUi, /id=["']linkShareBtn["']/, 'scene link-sharing control remains in the markup');
  assert.match(legacyJs, /function\s+openCard\s*\(/, 'lanterns still open the wish card');
  assert.match(legacyJs, /getElementById\(['"]cardShare['"]\)/, 'card sharing control remains wired');
  assert.match(legacyJs, /getElementById\(['"]linkShareBtn['"]\)/, 'scene link-sharing control remains wired');
  assert.match(legacyJs, /async function\s+shareWishLink\s*\(/, 'wish and scene sharing remains implemented');
});
