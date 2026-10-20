import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminLogin, renderAdminPage } from '../server/admin-ui.js';

const attack = '</textarea><script>alert("x")</script><img src=x onerror=alert(1)>';

const countMatches = (text, regex) => [...text.matchAll(regex)].length;

test('login is polished, posts password securely, never prefills it, and escapes errors', () => {
  const html = renderAdminLogin({ error: attack });
  assert.match(html, /action="\/admin\/login" method="post"/);
  assert.match(html, /name="password" type="password" autocomplete="current-password" required/);
  assert.doesNotMatch(html, /name="password"[^>]*value=/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /min-height: 44px/);
});

test('wish text remains readable while moderator notes, technical IDs, and times are inside closed details', () => {
  const evilId = `id"><script>${attack}`;
  const html = renderAdminPage({
    items: [{
      id: evilId,
      text: attack,
      dedication: attack,
      at: attack,
      hidden: true,
      manual_hidden: true,
      active_report_count: 3,
      report_count: 7,
      moderator_note: attack,
    }],
    csrf: attack,
    search: attack,
    error: attack,
  });
  assert.match(html, /<h3 class="wish-text">&lt;\/textarea&gt;&lt;script&gt;/);
  assert.match(html, /name="csrf" value="&lt;\/textarea&gt;/);
  assert.match(html, /name="wish_id" value="id&quot;&gt;&lt;script&gt;/);
  assert.match(html, /name="notes" maxlength="1000">&lt;\/textarea&gt;/);
  assert.match(html, /name="search" value="&lt;\/textarea&gt;/);
  assert.match(html, /ဆုတောင်း ID: <bdi>id&quot;&gt;&lt;script&gt;/);
  assert.match(html, /တင်သွင်းချိန်: &lt;\/textarea&gt;/);
  assert.match(html, /<details>[\s\S]*<summary>စီမံရန်/);
  assert.match(html, /ဖျောက်ထားသည်/);
  assert.match(html, /ကိုယ်တိုင်ဖျောက်ထားမှုကို ရှင်းရန်/);
  assert.match(html, /တိုင်ကြားချက်များ ကြည့်ရန်/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.doesNotMatch(html, /<textarea[^>]*>[^<]*<\/textarea><script>/);
});

test('reports foreground snapshotted wish, translate known labels, and use explicit review actions', () => {
  const html = renderAdminPage({
    tab: 'reports',
    csrf: 'token&"',
    items: [{
      id: '9223372036854775807',
      wish_id: 'wish?&"',
      reason: 'personal_info',
      details: attack,
      wish_text_snapshot: attack,
      wish_dedication_snapshot: attack,
      status: 'reviewed',
      created_at: attack,
      reviewed_at: attack,
      reviewer_notes: attack,
    }],
  });
  assert.match(html, /တိုင်ကြားချိန်က ဆုတောင်းစာ[\s\S]*<div class="snapshot">&lt;\/textarea&gt;/);
  assert.match(html, /ကိုယ်ရေးအချက်အလက်/);
  assert.match(html, /စစ်ဆေးပြီး/);
  assert.match(html, /name="report_id" value="9223372036854775807"/);
  assert.match(html, /action="\/admin\/review" method="post"/);
  assert.match(html, /name="status" value="reviewed">စစ်ဆေးပြီးဟု မှတ်သားရန်/);
  assert.match(html, /name="status" value="dismissed">တိုင်ကြားချက် ပယ်ရန်/);
  assert.doesNotMatch(html, /<select[^>]*name="status"/);
  assert.match(html, /name="notes" maxlength="1000">&lt;\/textarea&gt;/);
  assert.match(html, /name="csrf" value="token&amp;&quot;"/);
  assert.match(html, /<details>[\s\S]*<summary>အသေးစိတ် · မှတ်ချက်နှင့် ID/);
  assert.match(html, /တိုင်ကြားချက် ID: <bdi>9223372036854775807/);
  assert.doesNotMatch(html, /<script>|reporter|owner|user_id|href="[^"]*csrf/i);
});

test('pending reports are not silently reviewed and unknown status and reason values are safely shown', () => {
  const html = renderAdminPage({ tab: 'reports', items: [{
    id: '7', status: 'pending', reason: attack, wish_text_snapshot: 'snapshot',
  }] });
  assert.match(html, /စောင့်ဆိုင်းနေသည်/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.match(html, /name="status" value="reviewed"/);
  assert.match(html, /name="status" value="dismissed"/);
  const unknown = renderAdminPage({ tab: 'reports', items: [{ id: '8', status: 'awaiting-review <tag>', reason: 'other', wish_text_snapshot: 'snapshot' }] });
  assert.match(unknown, /awaiting-review &lt;tag&gt;/);
});

test('all mutations remain same-origin POST forms with CSRF; no deletion control exists', () => {
  const html = renderAdminPage({ csrf: 'csrf<&', items: [{ id: 'a', text: 'wish' }] });
  const reportHtml = renderAdminPage({ tab: 'reports', csrf: 'csrf<&', items: [{ id: '1', status: 'pending' }] });
  assert.match(html, /action="\/admin\/logout" method="post"><input type="hidden" name="csrf" value="csrf&lt;&amp;"/);
  assert.match(html, /action="\/admin\/visibility" method="post"/);
  assert.match(html, /name="csrf" value="csrf&lt;&amp;"/);
  assert.match(reportHtml, /action="\/admin\/review" method="post"/);
  assert.doesNotMatch(html, /action="[^"]*delete/i);
  assert.doesNotMatch(html, /name="_method"[^>]*value="delete"/i);
  assert.doesNotMatch(html, /href="[^"]*csrf/i);
  assert.doesNotMatch(html, /ဖျက်ရန်|ဖျက်ပစ်ရန်/);
});

test('policy is concise and rendered once in a collapsed page footer', () => {
  const html = renderAdminPage({ items: Array.from({ length: 4 }, (_, id) => ({ id: String(id), text: 'wish' })) });
  assert.equal(countMatches(html, /စိစစ်ခြင်းနှင့် မြင်နိုင်မှု လမ်းညွှန်/g), 1);
  assert.equal(countMatches(html, /လူမတူသော တိုင်ကြားသူ ၃ ဦး/g), 1);
  assert.equal(countMatches(html, /<details class="guidance">/g), 1);
  assert.match(html, /ကိုယ်တိုင်ဖျောက်ထားမှုကို ရှင်းခြင်းသည် အလိုအလျောက်ဖျောက်မှုကို မကျော်လွှားပါ/);
  const cards = html.match(/<article class="card">[\s\S]*?<\/article>/g) || [];
  assert.equal(cards.some((card) => card.includes('လူမတူသော တိုင်ကြားသူ')), false);
});

test('page count reflects only the supplied current-page items, never an invented global total', () => {
  const wishes = renderAdminPage({ items: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }] });
  const reports = renderAdminPage({ tab: 'reports', items: [{ id: '1' }] });
  assert.match(wishes, /ဤစာမျက်နှာ · 2 ခု/);
  assert.match(reports, /ဤစာမျက်နှာ · 1 ခု/);
  assert.doesNotMatch(wishes, /စုစုပေါင်းဆုတောင်း|အားလုံး၏ စုစုပေါင်း|total count/i);
});

test('mobile layout has viewport, focus states, 44px targets, and no scripts or external resources', () => {
  const html = renderAdminPage();
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /@media \(max-width: 600px\)/);
  assert.match(html, /overflow-wrap: anywhere/);
  assert.match(html, /min-height: 44px/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script|<link\s|https?:\/\//i);
});

test('pagination bounds offsets and preserves GET search, filter, and report wish ID with URL encoding', () => {
  const wishes = renderAdminPage({
    offset: -15,
    limit: 500,
    hasMore: true,
    search: '><script>& value',
    filter: 'hidden',
    items: [],
  });
  assert.match(wishes, /href="\/admin\?tab=wishes&amp;offset=0&amp;limit=50&amp;search=%3E%3Cscript%3E%26\+value&amp;filter=hidden"/);
  assert.match(wishes, /href="\/admin\?tab=wishes&amp;offset=50&amp;limit=50&amp;search=%3E%3Cscript%3E%26\+value&amp;filter=hidden"/);
  assert.match(wishes, /filter=hidden/);
  assert.match(wishes, /action="\/admin" method="get"/);

  const reports = renderAdminPage({ tab: 'reports', offset: 25, limit: 25, hasMore: true, wishId: 'id&?><script>' });
  assert.match(reports, /tab=reports&amp;offset=0&amp;limit=25&amp;wish_id=id%26%3F%3E%3Cscript%3E/);
  assert.match(reports, /tab=reports&amp;offset=50&amp;limit=25&amp;wish_id=id%26%3F%3E%3Cscript%3E/);
  assert.doesNotMatch(reports, /wish_id=id&/);
});
