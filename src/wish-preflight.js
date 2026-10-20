import { checkWishSuitability, SUITABILITY_MESSAGE } from './wish-suitability.js';

export const CHECK_UNAVAILABLE_MESSAGE = 'စာသားစစ်ဆေးမှု မပြီးဆုံးသေးပါ။ အင်တာနက်ချိတ်ဆက်မှုကို စစ်ပြီး ထပ်မံကြိုးစားပါ။';

export async function requestWishApproval(text, dedication = '', fetcher = fetch) {
  const local = checkWishSuitability(text, dedication);
  if (!local.allowed) return local;
  try {
    const response = await fetcher('/api/wish-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, dedication }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (response.ok && result?.allowed === true) return { allowed: true };
    if (response.status === 422 && result?.code === 'WISH_UNSUITABLE') {
      return { allowed: false, code: 'WISH_UNSUITABLE', message: SUITABILITY_MESSAGE };
    }
  } catch {
    // No offline release fallback: a missing/failed server check is not approval.
  }
  return { allowed: false, code: 'CHECK_UNAVAILABLE', message: CHECK_UNAVAILABLE_MESSAGE };
}
