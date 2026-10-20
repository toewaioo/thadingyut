import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkWishSuitability,
  SUITABILITY_MESSAGE,
  SUITABILITY_RULES_VERSION,
} from '../src/wish-suitability.js';

test('suitability rules are explicitly versioned, local, deterministic and allow benign wishes', () => {
  assert.match(SUITABILITY_RULES_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.deepEqual(checkWishSuitability('May our family be peaceful and healthy', 'For my parents'), { allowed: true });
  assert.deepEqual(checkWishSuitability('အေးချမ်းသာယာပါစေ', 'မိသားစု'), { allowed: true });
  assert.deepEqual(checkWishSuitability('Wishing healing to survivors of violence', ''), { allowed: true });
  assert.deepEqual(checkWishSuitability('A world without hate or rape', ''), { allowed: true });
});

test('nonempty content and Unicode code-point limits are enforced', () => {
  assert.equal(checkWishSuitability('   ').code, 'EMPTY_TEXT');
  assert.equal(checkWishSuitability(null).code, 'INVALID_TEXT');
  assert.equal(checkWishSuitability('valid', null).code, 'INVALID_DEDICATION');
  assert.equal(checkWishSuitability('😀'.repeat(80)).allowed, true);
  assert.equal(checkWishSuitability('😀'.repeat(81)).code, 'TEXT_TOO_LONG');
  assert.equal(checkWishSuitability('wish', '😀'.repeat(20)).allowed, true);
  assert.equal(checkWishSuitability('wish', '😀'.repeat(21)).code, 'DEDICATION_TOO_LONG');
});

test('narrow English vulgar insults and direct threats are rejected, including separators and format obfuscation', () => {
  for (const text of [
    'Fuck you', 'f.u.c.k off', 'you are a bitch', 'You cunt!',
    'I will kill you', "I'll hurt you", 'I am going to kill you',
    'motherfucker', 'suck my dick',
    'f\u200B.u.c.k',
  ]) {
    assert.deepEqual(checkWishSuitability(text), {
      allowed: false,
      code: 'WISH_UNSUITABLE',
      message: SUITABILITY_MESSAGE,
    }, text);
  }
});

test('narrow Burmese explicit insults and direct threat phrases are rejected', () => {
  for (const text of [
    'မအေလိုး', 'မိအေလိုး', 'မေလိုး', 'စောက်ပတ်', 'စောက်ဖုတ်',
    'လီးစုပ်', 'လီးစား', 'သတ်ပစ်မယ်', 'မ\u200Bအေလိုး', 'စောက်-ပတ်',
  ]) {
    assert.equal(checkWishSuitability(text).code, 'WISH_UNSUITABLE', text);
  }
  assert.equal(checkWishSuitability('လီလီ ပန်းလေးများ ပွင့်ပါစေ').allowed, true);
  assert.equal(checkWishSuitability('အလီး ဟု အမည်ရသောနေရာ').allowed, true);
});

test('English substring false positives and general mentions are not blocked', () => {
  for (const text of [
    'Scunthorpe', 'class of 2026', 'assessment season',
    'Peace for people affected by violence', 'Support survivors of rape',
    'May hatred end', 'May everyone be safe from violence',
  ]) {
    assert.deepEqual(checkWishSuitability(text), { allowed: true }, text);
  }
});

test('both text and dedication are checked but tokens cannot be stitched across fields', () => {
  assert.equal(checkWishSuitability('A kind wish', 'fuck you').code, 'WISH_UNSUITABLE');
  assert.deepEqual(checkWishSuitability('fuc', 'k'), { allowed: true });
});
