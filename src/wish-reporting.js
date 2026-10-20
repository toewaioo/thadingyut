export const REPORT_REASONS = Object.freeze([
  'spam', 'harassment', 'hate', 'sexual', 'violence', 'personal_info', 'other',
]);
export function isReportableWishId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}
export async function submitWishReport(client, { wishId, reason, details = '' }) {
  if (!isReportableWishId(wishId)) throw new Error('Invalid wish ID');
  if (!REPORT_REASONS.includes(reason)) throw new Error('Invalid report reason');
  if (typeof details !== 'string' || Array.from(details).length > 1000) throw new Error('Invalid report details');
  if (!client) throw new Error('Reporting needs an active cloud connection');
  const { data, error } = await client.rpc('thadingyut_submit_wish_report', {
    p_wish_id: wishId, p_reason: reason, p_details: details.trim(),
  });
  if (error || data?.accepted !== true) throw new Error('Report was not confirmed');
  return data;
}

// The database applies the three-distinct-reporter rule; the UI never guesses counts.
// Refreshing the public feed reconciles visibility without editing saved wishes.
export function bindWishReporting({ getClient, root = document, events = window }) {
  const button = root.getElementById('cardReport');
  const form = root.getElementById('wishReportForm');
  const reason = root.getElementById('wishReportReason');
  const details = root.getElementById('wishReportDetails');
  const send = root.getElementById('wishReportSend');
  const cancel = root.getElementById('wishReportCancel');
  const status = root.getElementById('wishReportStatus');
  let selectedId = null;
  let generation = 0;
  let disposed = false;
  const pending = new Set();
  const confirmed = new Set();
  const select = (event) => {
    generation++;
    selectedId = isReportableWishId(event.detail?.wishId) ? event.detail.wishId : null;
    button.hidden = false;
    button.setAttribute('aria-expanded', 'false');
    form.hidden = true;
    form.reset();
    status.textContent = selectedId && confirmed.has(selectedId)
      ? 'တိုင်ကြားချက် ပေးပို့ပြီးပါပြီ။ စိစစ်ရန် စောင့်ဆိုင်းနေပါသည်။'
      : selectedId ? '' : event.detail?.kind === 'local'
        ? 'ဤဆုတောင်းကို Cloud သို့ သိမ်းဆည်းပြီးမှ တိုင်ကြားနိုင်ပါမည်။ ခဏစောင့်ပြီး ကတ်ကို ပြန်ဖွင့်ပါ။'
        : 'ဤမီးပုံးသည် နမူနာဆုတောင်းဖြစ်၍ တိုင်ကြားရန် မလိုပါ။ အသုံးပြုသူ၏ ဆုတောင်းမီးပုံးကို ရွေးပါ။';
    button.disabled = !selectedId || pending.has(selectedId) || confirmed.has(selectedId);
    send.disabled = false;
  };
  const open = () => {
    if (!selectedId || button.disabled) return;
    form.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    status.textContent = '';
    reason.focus();
  };
  const close = () => { form.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus(); };
  const submit = async (event) => {
    event.preventDefault();
    const wishId = selectedId;
    if (!wishId || pending.has(wishId) || confirmed.has(wishId)) return;
    const version = generation;
    pending.add(wishId);
    send.disabled = true;
    button.disabled = true;
    status.textContent = 'ပေးပို့နေသည်…';
    try {
      await submitWishReport(getClient(), { wishId, reason: reason.value, details: details.value });
      confirmed.add(wishId);
      if (!disposed) events.dispatchEvent(new Event('thadingyut:report-submitted'));
      if (disposed || version !== generation) return;
      form.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      status.textContent = 'တိုင်ကြားချက် ပေးပို့ပြီးပါပြီ။ မတူညီသော အသုံးပြုသူ ၃ ဦး တိုင်ကြားပါက ဆုတောင်းကို ယာယီဖျောက်ထားမည်ဖြစ်ပြီး ဖျက်မည်မဟုတ်ပါ။';
    } catch {
      if (disposed || version !== generation) return;
      status.textContent = 'ပေးပို့မှု မအောင်မြင်ပါ။ အင်တာနက်နှင့် cloud ချိတ်ဆက်မှုကို စစ်ပြီး ပြန်ကြိုးစားပါ။ မအောင်မြင်သေးလျှင် ခဏစောင့်ပြီး စာမျက်နှာကို ပြန်ဖွင့်ပါ။';
    } finally {
      pending.delete(wishId);
      if (!disposed && selectedId === wishId) {
        send.disabled = false;
        button.disabled = confirmed.has(wishId);
      }
    }
  };
  events.addEventListener('thadingyut:wish-card', select);
  button.addEventListener('click', open);
  cancel.addEventListener('click', close);
  form.addEventListener('submit', submit);
  return () => {
    disposed = true;
    events.removeEventListener('thadingyut:wish-card', select);
    button.removeEventListener('click', open);
    cancel.removeEventListener('click', close);
    form.removeEventListener('submit', submit);
  };
}
