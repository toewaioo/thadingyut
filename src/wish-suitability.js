export const SUITABILITY_RULES_VERSION = '2026-10-20.1';

export const SUITABILITY_MESSAGE = 'မသင့်တော်သော စကားလုံး သို့မဟုတ် ခြိမ်းခြောက်စာသား ပါဝင်နေသဖြင့် မီးပုံးလွှတ်၍ မရပါ။ စာသားကို ယဉ်ကျေးစွာ ပြန်ရေးပေးပါ။';

const BURMESE_BLOCKED = Object.freeze([
  'မအေလိုး',
  'မိအေလိုး',
  'မေလိုး',
  'စောက်ပတ်',
  'စောက်ဖုတ်',
  'လီးစုပ်',
  'လီးစား',
  'သတ်ပစ်မယ်',
]);

// Deliberately narrow: these are explicit insults/sexual abuse and direct
// second-person threats, not general references to violence, hate or trauma.
const ENGLISH_BLOCKED = Object.freeze([
  'fuck', 'fuckyou', 'fuckoff', 'motherfucker', 'fucker',
  'asshole', 'bitch', 'whore', 'slut', 'cunt', 'dickhead',
  'suckmydick', 'eatshit',
  'killyou', 'iwillkillyou', 'illkillyou', 'iamgoingtokillyou',
  'iwillhurtyou', 'illhurtyou', 'iwillbeatyou', 'illbeatyou',
]);

const FORMAT_AND_INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;
const SEPARATORS = /[\p{White_Space}\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E\u104A-\u104B\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F\uFE10-\uFE1F\uFE30-\uFE4F\uFF00-\uFF65]/gu;
const ENGLISH_SEPARATOR = '[\\p{White_Space}\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E\\u104A-\\u104B\\u2000-\\u206F\\u2E00-\\u2E7F\\u3000-\\u303F\\uFE10-\\uFE1F\\uFE30-\\uFE4F\\uFF00-\\uFF65]';

function codePointLength(value) {
  return Array.from(value).length;
}

function canonical(value) {
  return value.normalize('NFKC').toLowerCase().replace(FORMAT_AND_INVISIBLE, '');
}

function compact(value) {
  return value.replace(SEPARATORS, '');
}

function hasWholeEnglishTerm(value, term) {
  // Mirror the SQL separator allowlist and whole-term boundaries. The
  // Unicode letter/number boundary prevents substring accidents such as
  // "cunt" inside "Scunthorpe" while allowing f.u.c.k obfuscation.
  const lettersWithSeparators = [...term].join(`${ENGLISH_SEPARATOR}*`);
  return new RegExp(`(^|${ENGLISH_SEPARATOR})${lettersWithSeparators}($|${ENGLISH_SEPARATOR})`, 'u').test(value);
}

function invalid(reason) {
  return { allowed: false, code: reason, message: SUITABILITY_MESSAGE };
}

/**
 * Rule-based, deterministic suitability check. No network, model, or external
 * service is called. Limits are Unicode code points (not UTF-16 code units).
 */
export function checkWishSuitability(text, dedication = '') {
  if (typeof text !== 'string') return invalid('INVALID_TEXT');
  if (typeof dedication !== 'string') return invalid('INVALID_DEDICATION');
  if (codePointLength(text) > 80) return invalid('TEXT_TOO_LONG');
  if (codePointLength(dedication) > 20) return invalid('DEDICATION_TOO_LONG');
  if (!text.trim()) return invalid('EMPTY_TEXT');

  for (const field of [text, dedication]) {
    const normalized = canonical(field);
    const compacted = compact(normalized);
    if (BURMESE_BLOCKED.some((phrase) => compacted.includes(phrase))) {
      return invalid('WISH_UNSUITABLE');
    }
    if (ENGLISH_BLOCKED.some((term) => hasWholeEnglishTerm(normalized, term))) {
      return invalid('WISH_UNSUITABLE');
    }
  }
  return { allowed: true };
}
