const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

const safeInteger = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
};

const queryUrl = (values) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return `/admin?${params.toString()}`;
};

const pageStyles = `
  :root {
    color-scheme: light;
    font-family: system-ui, -apple-system, "Noto Sans Myanmar", "Myanmar Text", sans-serif;
    color: #24312b;
    background: #f6f8f6;
    font-synthesis: none;
  }
  * { box-sizing: border-box; }
  body { margin: 0; line-height: 1.65; }
  .wrap { width: min(100% - 2rem, 880px); margin: 0 auto; padding: 1.25rem 0 3rem; }
  header, main, section, article, form { min-width: 0; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
  .brand { margin: 0; font-size: clamp(1.3rem, 4vw, 1.8rem); line-height: 1.35; letter-spacing: -.02em; }
  .subtitle, .muted { color: #5b6b62; }
  .subtitle { margin: .25rem 0 0; font-size: .95rem; }
  h2 { margin: 0 0 .85rem; font-size: 1.25rem; }
  h3 { margin: 0; font-size: 1.05rem; line-height: 1.55; }
  p { margin: .45rem 0 .8rem; }
  .panel, .card, .notice, .error { border: 1px solid #dce5de; border-radius: .85rem; background: #fff; }
  .notice, .error { padding: .8rem 1rem; margin: .9rem 0; }
  .notice { border-color: #a9cdb3; background: #f1faf3; }
  .error { border-color: #e2b5ae; background: #fff6f4; }
  nav.tabs { display: flex; gap: .6rem; margin: 1rem 0 1.25rem; }
  a, button { color: #205b3b; }
  .tabs a, .button, button {
    display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
    border: 1px solid #b8cbbd; border-radius: .65rem; background: #fff; padding: .55rem .9rem;
    color: #205b3b; font: inherit; font-weight: 650; text-decoration: none; cursor: pointer;
  }
  .tabs a[aria-current="page"] { background: #245b3d; border-color: #245b3d; color: #fff; }
  .logout { margin-left: auto; }
  .logout button { border-color: transparent; background: transparent; color: #4c5d52; }
  .filters { display: grid; grid-template-columns: minmax(0, 1fr) minmax(9rem, .45fr) auto; align-items: end; gap: .7rem; padding: .85rem; margin-bottom: 1rem; }
  label { display: block; font-weight: 620; }
  input, select, textarea {
    display: block; width: 100%; min-height: 44px; margin-top: .3rem; padding: .55rem .65rem;
    border: 1px solid #aebdb3; border-radius: .55rem; background: #fff; color: inherit; font: inherit;
  }
  textarea { min-height: 6rem; resize: vertical; }
  .list { display: grid; gap: .8rem; margin: .8rem 0 1rem; }
  .card { padding: 1rem; overflow-wrap: anywhere; }
  .wish-text, .snapshot { white-space: pre-wrap; overflow-wrap: anywhere; }
  .wish-text { margin: .6rem 0 .8rem; font-size: 1.08rem; line-height: 1.75; color: #202b24; }
  .snapshot { padding: .8rem; border-left: 3px solid #b7cbbd; border-radius: .2rem .55rem .55rem .2rem; background: #f6f9f6; }
  .badges { display: flex; flex-wrap: wrap; gap: .45rem; margin: .3rem 0 .7rem; }
  .badge { display: inline-flex; align-items: center; min-height: 30px; padding: .12rem .6rem; border-radius: 99px; background: #edf3ee; color: #345541; font-size: .9rem; }
  .badge.hidden { background: #fff2e7; color: #774516; }
  .badge.count { background: #f0f2f4; color: #46545c; }
  .meta { color: #5b6b62; font-size: .92rem; }
  .card-actions { display: flex; flex-wrap: wrap; gap: .55rem; margin-top: .65rem; }
  details { margin-top: .75rem; }
  summary { width: fit-content; min-height: 44px; display: flex; align-items: center; padding: .4rem .2rem; color: #285d40; font-weight: 650; cursor: pointer; }
  summary:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 3px solid #397eb8; outline-offset: 3px;
  }
  .details-body { padding: .35rem .15rem .2rem; }
  .review-actions { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: .8rem; }
  .review-actions button { flex: 1 1 12rem; }
  .review-actions .dismiss { color: #754332; border-color: #dbc1b8; }
  .pagination { display: flex; align-items: center; justify-content: space-between; gap: .7rem; margin: 1rem 0; }
  .pagination a[aria-disabled="true"] { opacity: .48; pointer-events: none; }
  .guidance { border-top: 1px solid #dce5de; margin-top: 2rem; padding-top: .5rem; color: #5b6b62; }
  .guidance summary { color: #52655a; font-weight: 550; }
  .guidance p { max-width: 72ch; }
  .login-panel { max-width: 28rem; margin: 2.5rem auto; padding: 1.25rem; }
  .login-panel button { width: 100%; margin-top: .7rem; }
  @media (max-width: 600px) {
    .wrap { width: min(100% - 1.25rem, 880px); padding-top: .8rem; }
    .topbar { align-items: flex-start; }
    .logout { flex: 0 0 auto; }
    .tabs { flex-wrap: wrap; }
    .tabs a { flex: 1 1 8.5rem; }
    .filters { grid-template-columns: minmax(0, 1fr); }
    .filters button { width: 100%; }
    .card, .login-panel { padding: .8rem; }
    .pagination { flex-wrap: wrap; }
    .pagination a { flex: 1 1 8rem; text-align: center; }
    .pagination .muted { flex-basis: 100%; order: -1; text-align: center; }
  }
`;

const documentStart = (title) => `<!doctype html>
<html lang="my">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${pageStyles}</style>
</head>
<body>`;

const messageBlock = (notice, error) => `${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ''}`;

export function renderAdminLogin({ error = '' } = {}) {
  return `${documentStart('အုပ်ချုပ်ရေးမှူး ဝင်ရောက်ရန် | ဆုတောင်းမီးအိမ်')}
  <main class="wrap">
    <header class="topbar"><div><h1 class="brand">အုပ်ချုပ်ရေးမှူး ဝင်ရောက်ရန်</h1><p class="subtitle">ဆုတောင်းမီးအိမ် စီမံခန့်ခွဲမှု</p></div></header>
    ${messageBlock('', error)}
    <section class="panel login-panel" aria-labelledby="login-heading">
      <h2 id="login-heading">စကားဝှက်ဖြင့် ဝင်ရောက်ပါ</h2>
      <form action="/admin/login" method="post">
        <label for="admin-password">စကားဝှက်</label>
        <input id="admin-password" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">ဝင်ရောက်ရန်</button>
      </form>
    </section>
  </main>
</body>
</html>`;
}

function renderLogout(csrf) {
  return `<form class="logout" action="/admin/logout" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">ထွက်ရန်</button></form>`;
}

function renderWish(item, csrf) {
  const id = String(item?.id ?? '');
  const hidden = Boolean(item?.hidden);
  const manuallyHidden = Boolean(item?.manual_hidden);
  const reports = safeInteger(item?.report_count, 0, 0, Number.MAX_SAFE_INTEGER);
  const activeReports = safeInteger(item?.active_report_count, 0, 0, Number.MAX_SAFE_INTEGER);
  const actionLabel = manuallyHidden ? 'ကိုယ်တိုင်ဖျောက်ထားမှုကို ရှင်းရန်' : 'ကိုယ်တိုင် ဖျောက်ထားရန်';
  const note = String(item?.moderator_note ?? '');
  const dedication = item?.dedication !== undefined && item?.dedication !== null && item?.dedication !== ''
    ? `<p><strong>ရည်စူးချက်:</strong> ${escapeHtml(item.dedication)}</p>` : '';
  return `<article class="card">
    <h3 class="wish-text">${escapeHtml(item?.text)}</h3>
    ${dedication}
    <div class="badges"><span class="badge${hidden ? ' hidden' : ''}">${hidden ? 'ဖျောက်ထားသည်' : 'မြင်နိုင်သည်'}</span><span class="badge count">အသက်ဝင်သော တိုင်ကြားချက် ${activeReports}</span><span class="badge count">စုစုပေါင်း ${reports}</span></div>
    <div class="card-actions"><a class="button" href="${escapeHtml(queryUrl({ tab: 'reports', wish_id: id }))}">တိုင်ကြားချက်များ ကြည့်ရန်</a></div>
    <details>
      <summary>စီမံရန် · ID နှင့် အချိန်</summary>
      <div class="details-body">
        <p class="meta">ဆုတောင်း ID: <bdi>${escapeHtml(id)}</bdi><br>တင်သွင်းချိန်: ${escapeHtml(item?.at ?? '—')}</p>
        <p class="meta">ကိုယ်တိုင်ဖျောက်ထားမှု: ${manuallyHidden ? 'ရှိသည်' : 'မရှိပါ'}</p>
        <form class="inline-form" action="/admin/visibility" method="post">
          <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
          <input type="hidden" name="wish_id" value="${escapeHtml(id)}">
          <input type="hidden" name="hidden" value="${manuallyHidden ? 'false' : 'true'}">
          <label for="wish-note-${escapeHtml(id)}">စီမံသူ၏ မှတ်ချက် (အများဆုံး စာလုံး ၁,၀၀၀)</label>
          <textarea id="wish-note-${escapeHtml(id)}" name="notes" maxlength="1000">${escapeHtml(note)}</textarea>
          <button type="submit">${actionLabel}</button>
        </form>
      </div>
    </details>
  </article>`;
}

const reportStatuses = {
  pending: 'စောင့်ဆိုင်းနေသည်',
  reviewed: 'စစ်ဆေးပြီး',
  dismissed: 'ပယ်ဖျက်ပြီး',
};
const reportReasons = {
  spam: 'စပမ်း / မလိုလားအပ်သော အကြောင်းအရာ',
  harassment: 'နှောင့်ယှက်မှု',
  hate: 'မုန်းတီးမှုကို လှုံ့ဆော်ခြင်း',
  sexual: 'လိင်ပိုင်းဆိုင်ရာ အကြောင်းအရာ',
  violence: 'အကြမ်းဖက်မှု',
  personal_info: 'ကိုယ်ရေးအချက်အလက်',
  other: 'အခြားအကြောင်းရင်း',
};

function renderReport(item, csrf) {
  const id = String(item?.id ?? '');
  const status = String(item?.status ?? 'pending');
  const statusLabel = reportStatuses[status] ?? status;
  const reason = String(item?.reason ?? '');
  const reasonLabel = reportReasons[reason] ?? reason;
  const details = item?.details !== undefined && item?.details !== null && item?.details !== ''
    ? `<details><summary>တိုင်ကြားသူ၏ အသေးစိတ်</summary><div class="details-body snapshot">${escapeHtml(item.details)}</div></details>` : '';
  const dedication = item?.wish_dedication_snapshot !== undefined && item?.wish_dedication_snapshot !== null && item?.wish_dedication_snapshot !== ''
    ? `<p><strong>မှတ်တမ်းရှိ ရည်စူးချက်:</strong> ${escapeHtml(item.wish_dedication_snapshot)}</p>` : '';
  return `<article class="card">
    <h3>တိုင်ကြားချက်</h3>
    <div class="badges"><span class="badge">${escapeHtml(statusLabel)}</span></div>
    <p><strong>အကြောင်းရင်း:</strong> ${escapeHtml(reasonLabel)}</p>
    <section aria-label="တိုင်ကြားချိန်က ဆုတောင်းစာ">
      <h3>တိုင်ကြားချိန်က ဆုတောင်းစာ</h3>
      <div class="snapshot">${escapeHtml(item?.wish_text_snapshot ?? '')}</div>
      ${dedication}
    </section>
    ${details}
    <form class="inline-form" action="/admin/review" method="post">
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
      <input type="hidden" name="report_id" value="${escapeHtml(id)}">
      <details>
        <summary>အသေးစိတ် · မှတ်ချက်နှင့် ID</summary>
        <div class="details-body">
          <p class="meta">တိုင်ကြားချက် ID: <bdi>${escapeHtml(id)}</bdi><br>ဆုတောင်း ID: <bdi>${escapeHtml(item?.wish_id ?? '')}</bdi><br>တိုင်ကြားချိန်: ${escapeHtml(item?.created_at ?? '—')}${item?.reviewed_at ? `<br>စစ်ဆေးချိန်: ${escapeHtml(item.reviewed_at)}` : ''}</p>
          <label for="report-notes-${escapeHtml(id)}">စီမံသူ၏ မှတ်ချက် (အများဆုံး စာလုံး ၁,၀၀၀)</label>
          <textarea id="report-notes-${escapeHtml(id)}" name="notes" maxlength="1000">${escapeHtml(item?.reviewer_notes ?? '')}</textarea>
        </div>
      </details>
      <div class="review-actions">
        <button type="submit" name="status" value="reviewed">စစ်ဆေးပြီးဟု မှတ်သားရန်</button>
        <button class="dismiss" type="submit" name="status" value="dismissed">တိုင်ကြားချက် ပယ်ရန်</button>
      </div>
    </form>
  </article>`;
}

export function renderAdminPage({ tab = 'wishes', items = [], offset = 0, limit = 25, hasMore = false, search = '', filter = 'all', wishId = '', csrf = '', notice = '', error = '' } = {}) {
  const selectedTab = tab === 'reports' ? 'reports' : 'wishes';
  const selectedFilter = ['all', 'hidden', 'visible'].includes(filter) ? filter : 'all';
  const currentOffset = safeInteger(offset, 0, 0, 1_000_000_000);
  const pageLimit = safeInteger(limit, 25, 1, 50);
  const currentItems = Array.isArray(items) ? items : [];
  const previousUrl = queryUrl({ tab: selectedTab, offset: Math.max(0, currentOffset - pageLimit), limit: pageLimit, search: selectedTab === 'wishes' ? search : '', filter: selectedTab === 'wishes' ? selectedFilter : undefined, wish_id: selectedTab === 'reports' ? wishId : undefined });
  const nextUrl = queryUrl({ tab: selectedTab, offset: Math.min(1_000_000_000, currentOffset + pageLimit), limit: pageLimit, search: selectedTab === 'wishes' ? search : '', filter: selectedTab === 'wishes' ? selectedFilter : undefined, wish_id: selectedTab === 'reports' ? wishId : undefined });
  const searchValue = escapeHtml(search);
  const filterOptions = ['all', 'hidden', 'visible'].map((value) => `<option value="${value}"${selectedFilter === value ? ' selected' : ''}>${value === 'all' ? 'အားလုံး' : value === 'hidden' ? 'ဖျောက်ထားသည်' : 'မြင်နိုင်သည်'}</option>`).join('');
  const listContent = selectedTab === 'wishes'
    ? currentItems.map((item) => renderWish(item, csrf)).join('')
    : currentItems.map((item) => renderReport(item, csrf)).join('');
  const searchForm = selectedTab === 'wishes' ? `<form class="panel filters" action="/admin" method="get">
    <input type="hidden" name="tab" value="wishes">
    <label for="admin-search">ဆုတောင်းစာ ရှာရန်<input id="admin-search" type="search" name="search" value="${searchValue}"></label>
    <label for="wish-filter">မြင်ကွင်းစစ်ထုတ်ရန်<select id="wish-filter" name="filter">${filterOptions}</select></label>
    <button type="submit">ရှာဖွေရန်</button>
  </form>` : '';
  const emptyText = selectedTab === 'wishes' ? 'ဤစာမျက်နှာတွင် ဆုတောင်းမရှိပါ။' : 'ဤစာမျက်နှာတွင် တိုင်ကြားချက်မရှိပါ။';
  const nav = `<nav class="tabs" aria-label="စီမံခန့်ခွဲမှု ကဏ္ဍများ">
    <a href="/admin?tab=wishes"${selectedTab === 'wishes' ? ' aria-current="page"' : ''}>ဆုတောင်းများ</a>
    <a href="/admin?tab=reports"${selectedTab === 'reports' ? ' aria-current="page"' : ''}>တိုင်ကြားချက်များ</a>
    ${renderLogout(csrf)}
  </nav>`;
  const policy = `<details class="guidance"><summary>စိစစ်ခြင်းနှင့် မြင်နိုင်မှု လမ်းညွှန်</summary>
    <p>ဆုတောင်းမူရင်းကို ဖျက်ခြင်းမပြုပါ။ လူမတူသော တိုင်ကြားသူ ၃ ဦး၏ အသက်ဝင်တိုင်ကြားချက် ရှိလျှင် ဆုတောင်းကို အလိုအလျောက် ဖျောက်ထားမည်။ “စစ်ဆေးပြီး” သတ်မှတ်ခြင်းသည် တိုင်ကြားချက်ကို အသက်ဝင်နေဆဲထားပြီး “တိုင်ကြားချက် ပယ်ရန်” သာ အသက်ဝင်ရေတွက်မှုမှ ဖယ်ရှားသည်။</p>
    <p>ကိုယ်တိုင်ဖျောက်ထားမှုကို ရှင်းခြင်းသည် အလိုအလျောက်ဖျောက်မှုကို မကျော်လွှားပါ။ အသက်ဝင်သော လူမတူသည့် တိုင်ကြားချက် ၃ ခုရှိနေပါက ဆုတောင်းသည် ဆက်လက်ဖျောက်ထားမည်။</p>
  </details>`;
  return `${documentStart('ဆုတောင်းမီးအိမ် စီမံခန့်ခွဲမှု')}
  <main class="wrap">
    <header class="topbar"><div><h1 class="brand">ဆုတောင်းမီးအိမ်</h1><p class="subtitle">စီမံခန့်ခွဲမှု</p></div></header>
    ${messageBlock(notice, error)}
    ${nav}
    <section aria-labelledby="list-heading">
      <h2 id="list-heading">${selectedTab === 'wishes' ? 'ဆုတောင်းများ' : 'တိုင်ကြားချက်များ'}</h2>
      ${searchForm}
      <p class="meta">ဤစာမျက်နှာ · ${currentItems.length} ခု</p>
      <div class="list">${listContent || `<p class="panel">${emptyText}</p>`}</div>
      <nav class="pagination" aria-label="စာမျက်နှာပြောင်းရန်">
        <a class="button" href="${escapeHtml(previousUrl)}"${currentOffset === 0 ? ' aria-disabled="true" tabindex="-1"' : ''}>ယခင်</a>
        <span class="muted">စတင်နေရာ ${currentOffset}</span>
        <a class="button" href="${escapeHtml(nextUrl)}"${!hasMore ? ' aria-disabled="true" tabindex="-1"' : ''}>နောက်</a>
      </nav>
    </section>
    ${policy}
  </main>
</body>
</html>`;
}
