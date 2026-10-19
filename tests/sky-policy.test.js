import test from 'node:test';
import assert from 'node:assert/strict';
import { planSkyLanterns, DEFAULT_WISH_COUNT, MAX_LANTERNS } from '../src/sky-policy.js';

const wishes = count => Array.from({ length: count }, (_, index) => ({
  id: `db-${index}`,
  text: `database wish ${index}`,
  at: index + 1
}));

test('0 database wishes preserves the default 60 ambient lanterns', () => {
  const plan = planSkyLanterns({ databaseWishes: wishes(0) });
  assert.equal(plan.databaseOnly, false);
  assert.equal(plan.ambientCount, 60);
  assert.equal(plan.wishes.length, 0);
});

test('60 database wishes preserves 60 ambient and selects at most 40 recent wishes', () => {
  const plan = planSkyLanterns({ databaseWishes: wishes(60) });
  assert.equal(plan.databaseOnly, false);
  assert.equal(plan.ambientCount, 60);
  assert.equal(plan.wishes.length, 40);
  assert.equal(plan.wishes[0].id, 'db-59');
});

test('61 database wishes switches to database-only with no ambient lanterns', () => {
  const plan = planSkyLanterns({ databaseWishes: wishes(61), localWishes: [{ id: 'private', text: 'local only' }] });
  assert.equal(plan.databaseOnly, true);
  assert.equal(plan.ambientCount, 0);
  assert.equal(plan.wishes.length, 61);
  assert.ok(plan.wishes.every(wish => wish._isCommunity));
  assert.ok(!plan.wishes.some(wish => wish.id === 'private'));
});

test('100 database wishes displays all 100 under the performance bound', () => {
  const plan = planSkyLanterns({ databaseWishes: wishes(100) });
  assert.equal(plan.ambientCount, 0);
  assert.equal(plan.wishes.length, 100);
  assert.equal(plan.wishes[0].id, 'db-99');
});

test('more than 100 database wishes displays only the 100 most recent', () => {
  const plan = planSkyLanterns({ databaseWishes: wishes(125) });
  assert.equal(plan.databaseOnly, true);
  assert.equal(plan.wishes.length, MAX_LANTERNS);
  assert.equal(plan.wishes[0].id, 'db-124');
  assert.equal(plan.wishes.at(-1).id, 'db-25');
});

test('a database source matching a local id is represented once as the database wish', () => {
  const plan = planSkyLanterns({
    databaseWishes: Array.from({ length: 61 }, (_, index) => ({
      id: `row-${index}`,
      ...(index === 0 ? { source_id: 'local-1' } : {}),
      text: `wish ${index}`,
      at: index + 1
    })),
    localWishes: [{ id: 'local-1', text: 'my wish', at: 1 }]
  });
  assert.equal(plan.wishes.length, 61);
  assert.equal(plan.wishes.filter(wish => wish.source_id === 'local-1').length, 1);
  assert.ok(plan.wishes.every(wish => wish._isCommunity));
});

test('a synced local wish remains one sky entry when the feed is below the threshold', () => {
  const plan = planSkyLanterns({
    databaseWishes: [{ id: 'public-row', source_id: 'local-1', text: 'my wish', at: 10 }],
    localWishes: [{ id: 'local-1', text: 'my wish', at: 10 }]
  });
  assert.equal(plan.wishes.length, 1);
  assert.equal(plan.wishes[0]._skyKey, 'id:local-1');
  assert.equal(plan.wishes[0]._isCommunity, true);
});

test('a live 60 to 61 transition removes demo selection and keeps the database feed', () => {
  const at60 = planSkyLanterns({ databaseWishes: wishes(60) });
  const at61 = planSkyLanterns({ databaseWishes: wishes(61) });
  assert.equal(at60.ambientCount, DEFAULT_WISH_COUNT);
  assert.equal(at61.ambientCount, 0);
  assert.equal(at61.databaseOnly, true);
  assert.equal(at61.wishes.length, 61);
});
