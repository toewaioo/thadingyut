# သီတင်းကျွတ် ဆုတောင်းမယ် — Server-side Supabase Proxy

## Wish reporting: temporarily hide after three distinct reporters

Open a database-backed lantern's wish card and choose **မသင့်လျော်သော ဆုတောင်းကို တိုင်ကြားရန်**. Select a reason, optionally add details, and submit. Reports require the existing cloud/anonymous sign-in connection. Ambient/demo and not-yet-synced local lanterns cannot be reported; a local wish becomes reportable after it appears in the database feed and its card is reopened. Reports are stored privately.

**Approved policy:** automatically exclude a wish from the public sky when three distinct authenticated user IDs have active reports against it. One identity counts once. The wish is temporarily hidden, **not deleted**. Private owner records and sync remain unchanged. Pending/reviewed reports count; dismissed reports do not. A private human review can restore a wish by dismissing enough reports to reduce the active count below three. No timed expiry has been selected.

**Deployment order:** apply `20261020000100_wish_reports.sql` if not already applied, then `20261020000200_three_report_visibility.sql`, before redeploying the full source with `api/` functions. For a new database apply all migrations in filename order. Never rerun applied historical migrations on an existing project. Environment variables are unchanged; never put a service-role key in the app. See [DEPLOYMENT.md](DEPLOYMENT.md).

**Private review:** authorized database operators use the queue and review SQL in [MODERATION.md](MODERATION.md). Browser roles cannot read reports or the moderation queue. The owner-scoped visibility RPC exposes only the signed-in owner's display metadata (including matching JSON for ID-less legacy records) so local sync copies do not reappear in the online sky.

The existing 60/100-lantern display rules apply to the visible feed. No wish archive/profile record is removed or changed by the threshold. Existing active reports count as soon as the new migration is applied. Offline/cached copies and old text-bearing share links cannot be revoked. Three user IDs do not prove three humans; anonymous identity resets are an abuse limitation.

Run `npm ci`, `npm test`, and `npm run build`. Local PostgreSQL tests are documented in `MODERATION.md`. Nothing in this ZIP has been deployed or applied to a hosted database.

## ယခုအပြောင်းအလဲ — စာရင်းမပါ၊ ကောင်းကင်တွင် ဆုတောင်းမီးပုံးများ ဆက်ပြမည်

ဆုတောင်းစာရင်းကြည့်သည့် ခလုတ်၊ badge နှင့် စာရင်း dialog ကို ဖယ်ရှားထားသည်။ ဆုတောင်းစာရေးခြင်း၊ မီးပုံးလွှတ်ခြင်း၊ ကောင်းကင်ရှိ မီးပုံးကိုနှိပ်၍ ဆုတောင်းကတ်ကြည့်ခြင်းနှင့် မျှဝေခြင်းတို့ ဆက်ရှိပါသည်။

### DB ဆုတောင်း ၆၀ ကျော်လျှင်

- Database ဆုတောင်း **၆၁ ခုမှစပြီး demo မီးပုံးများ လုံးဝမပြတော့ပါ**။ Database ဆုတောင်းများဖြင့်သာ ကောင်းကင်ကို ဖြည့်ပါသည်။ အက်ပ်ဖွင့်ထားစဉ် ၆၀ မှ ၆၁ သို့ တိုးလာလျှင်လည်း နောက်တစ်ကြိမ် feed refresh တွင် demo မီးပုံးများကို ဖယ်ပါသည်။
- DB ဆုတောင်း ၆၀ နှင့်အောက်တွင် မူလ demo မီးပုံး ၆၀ နှင့် နောက်ဆုံးဆုတောင်းမီးပုံးများကို ဆက်ပြပါသည်။ Database ထဲတွင်ရှိသည့် ဆုတောင်းအရေအတွက်ဖြင့် threshold ကိုတွက်ပြီး local-only wishes ဖြင့် မတွက်ပါ။
- ဖုန်း performance အတွက် တစ်ပြိုင်နက် မီးပုံးအများဆုံး ၁၀၀ ကို ထိန်းထားသည်။ DB ၁၀၀ ကျော်ပါက နောက်ဆုံး DB ဆုတောင်း ၁၀၀ ကိုပြပြီး မှတ်တမ်းများကို မဖျက်ပါ။ မိမိအသစ်လွှတ်သော မီးပုံးကို ချက်ချင်းပြကာ မူလပုံစံအတိုင်း cloud sync လုပ်ပါသည်။
- Feed ကို စာမျက်နှာခွဲ၍ အားလုံးဖတ်သဖြင့် ၅၀၀ ကျော်သော်လည်း DB အရေအတွက်ကို မှန်ကန်စွာသိနိုင်ပါသည်။ Tab ဖွင့်ထားချိန် ၁၀ စက္ကန့်ခြား refresh လုပ်ပါသည်။

### Public access ကို ကောင်းကင်အတွက်သာ ကန့်သတ်ထားသည်

`thadingyut_sky_wishes` view အသစ်မှ `id` နှင့် allowlist ဖြင့်ရွေးထားသော ဆုတောင်း/မီးပုံး fields များကိုသာ အများဖတ်နိုင်ပါသည်။ Public feed သည် ထို view ကိုသာ GET လုပ်ပါသည်။ Proxy တွင် query ကို fixed fields၊ order၊ cursor နှင့် တစ်ကြိမ် အများဆုံး ၅၀၀ rows အထိသာ ခွင့်ပြုပါသည်။

`thadingyut_public_wishes` archive table ကိုယ်တိုင်ကို public/anon/authenticated roles ဖြင့် ဖတ်မရအောင် ဆက်ပိတ်ထားသည်။ ကိုယ်ပိုင် settings၊ environment၊ streak၊ owner/auth data နှင့် အခြား table များကို public မဖွင့်ထားပါ။ ဆုတောင်းမှတ်တမ်းများ၊ archive trigger၊ local storage နှင့် ပိုင်ရှင်အလိုက် `thadingyut_profiles` sync/RLS policies များကို မပြောင်း/မဖျက်ထားပါ။

စာရင်း UI မရှိသော်လည်း **ကောင်းကင်အတွက် ဖော်ပြသော ဆုတောင်းအချက်အလက်များသည် public ဖြစ်သည်**။ Link ဖြင့် မျှဝေသော ဆုတောင်းကိုလည်း link ရသူက ဖတ်နိုင်ပါသည်။

### Deploy လုပ်ရန်

ZIP ဖြည်ပြီး `package.json` ရှိရာကို root အဖြစ်သုံးကာ `api/` folder အပါအဝင် Vercel project အဟောင်းတွင် redeploy လုပ်ပါ။ Environment variables မပြောင်းရပါ။ `npm ci`၊ `npm test`၊ `npm run build` ဖြင့် စစ်နိုင်ပါသည်။

လက်ရှိ Supabase project တွင် archive access ပိတ်ခြင်းနှင့် sky projection ဖွင့်ခြင်း migrations နှစ်ခုလုံး လုပ်ပြီးဖြစ်သည်။ ဤ ZIP သည် live website code ကို အလိုအလျောက် မတင်ပါ။ Redeploy ပြီးမှ endpoint အသစ်နှင့် ၆၀ ကျော်လျှင် demo မပြသည့် logic ကို အသုံးပြုပါမည်။

Project အသစ်တွင် `supabase/migrations/` ဖိုင်များကို အမည်အစဉ်လိုက် အားလုံး run ပြီးမှ app ကိုဖွင့်ပါ။ နောက်ဆုံး `20261019000100_revoke_public_wishes_read.sql` နှင့် `20261019000200_sky_wishes_projection.sql` ကို မချန်ပါနှင့်။ အစောပိုင်း public archive migration တစ်ခုတည်းကို ပြန် run မလုပ်ပါနှင့်။

ဒီဗားရှင်းမှာ browser က `*.supabase.co` ကို တိုက်ရိုက်မခေါ်တော့ပါ။ Anonymous login၊ session refresh နဲ့ profile ဖတ်/သိမ်းခြင်းတို့ကို app ရဲ့ same-origin API ကတစ်ဆင့်ပို့ပါတယ်။ UI နဲ့ local-storage fallback ကို ထိန်းထားပါတယ်။

```text
Browser → https://su-taung-mal.vercel.app/api/supabase?__route=…
        → Vercel server → Supabase
```

ISP က Supabase domain ကိုသာ ပိတ်ထားပြီး app domain ကိုဖွင့်နိုင်ရင် ဒီပုံစံက အထောက်အကူဖြစ်နိုင်ပါတယ်။ App domain ကိုပါပိတ်ထားရင် မဖြေရှင်းနိုင်ပါ။ Server က Supabase ကို ဆက်သွယ်နိုင်ဖို့လည်း လိုပါတယ်။

## ဒီဗားရှင်းမှာ ပြင်ထားသော 404 ပြဿနာ

အရင် ZIP က `api/supabase/[...path].js` ကို Next.js catch-all လို သုံးထားတာ ဒီ Vite deployment မှာ nested URL တွေကို မဖမ်းနိုင်ခဲ့ပါ။ `/api/config` အလုပ်လုပ်ပေမယ့် `/api/supabase/auth/v1/signup` က Vercel `NOT_FOUND` ပြန်တာ ဖြစ်နိုင်ပါတယ်။

အခု `api/supabase.js` ဆိုတဲ့ ပုံမှန် function တစ်ခုကိုပဲ သုံးပါတယ်။ Browser မှာ signup request က `/api/supabase?__route=auth%2Fv1%2Fsignup` ဖြစ်ရပါမယ်။ Rewrite သို့မဟုတ် catch-all routing မလိုတော့ပါ။

အရင် source ကို အစားထိုးပါ။ Git repository မှာပြောင်းရင် `api/supabase/[...path].js` အဟောင်းကိုလည်း ဖျက်ပါ။ Environment variables မပြောင်းထားရင် ပြန်ထည့်ဖို့မလိုပါ။ Deploy ပြီး hard refresh လုပ်ပါ။ Network tab မှာ signup request က အဟောင်း nested URL ဖြစ်နေသေးရင် cached bundle အဟောင်းဖြစ်ပါတယ်။

ဒီပြင်ဆင်ချက်က 404 routing ပြဿနာအတွက်ပါ။ Route ပြင်ပြီးနောက် upstream မှ auth/configuration error ပြန်လာရင် အဲဒီ error ကို သီးခြားစစ်ဖို့လိုပါတယ်။

## Vercel မှာတင်ရန်

1. ဒီ ZIP ကိုဖြည်ပြီး `package.json` ရှိတဲ့ folder ကို project root အဖြစ် သုံးပါ။ ZIP အတွင်း folder အဟောင်းထပ်နေခြင်း မရှိပါ။
2. Vercel ရဲ့ project environment variables မှာ အောက်ပါနှစ်ခုထည့်ပါ။

   ```text
   SUPABASE_URL=https://civxldsafwtsjzadxiwl.supabase.co
   SUPABASE_PUBLISHABLE_KEY=သင့်-project-ရဲ့-publishable-key-သို့မဟုတ်-legacy-anon-key
   ```

   `service_role` / `sb_secret_...` key ကို **မသုံးရပါ**။ User တစ်ဦးချင်းစီရဲ့ access token နဲ့ RLS ကိုပဲ အသုံးပြုပါတယ်။ Publishable/anon key က public ဖြစ်ပြီး `/api/config` ကနေ browser ကိုပေးပါတယ်။ ဒါဟာ secret key မဟုတ်ပါ။

3. Supabase မှာ anonymous sign-in ဖွင့်ထားရပါမယ်။ Table မတည်ဆောက်ရသေးရင် `supabase/migrations/20261015000000_thadingyut_profiles.sql` ကို run ပါ။ ရှိပြီးသား data ဖျက်ဖို့မလိုပါ။
4. Project ကို deploy/redeploy လုပ်ပါ။ `vercel.json` မှာ Vite build နဲ့ `dist` output သတ်မှတ်ပြီးပါပြီ။ `api/` folder ထဲက server functions တွေကိုပါ deploy လုပ်ရပါမယ်။ `dist/` တစ်ခုတည်းကို static hosting ပေါ်တင်ရုံနဲ့ cloud sync မရပါ။
5. `https://သင့်-app-domain/api/config` ကိုဖွင့်ရင် public configuration JSON ရသင့်ပါတယ်။ App ကိုဖွင့်ပြီး Network tab မှာ login/data request တွေဟာ app ရဲ့ `/api/supabase?__route=…` ကိုပဲခေါ်ကြောင်း စစ်ပါ။ `Cloud sync active` ဖြစ်ပြီး ဆုတောင်းတစ်ခုသိမ်းကာ reload လုပ်၍ စစ်ပါ။

အရင်က သုံးထားတဲ့ `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` environment variable နာမည်တွေကိုလည်း migration အတွက် server က လက်ခံပါတယ်။ နောက်ပိုင်းမှာ `SUPABASE_*` နာမည်တွေကို သုံးပါ။

ဒီ ZIP ပြင်ဆင်ခြင်းက live website ကို အလိုအလျောက် မပြောင်းပါ။ Deploy ပြီးမှ live app မှာ အကျိုးသက်ရောက်ပါမယ်။

## စက်ထဲမှာ စမ်းရန်

Node.js 22 နှင့်အထက်ကို အကြံပြုပါတယ်။

```sh
cp .env.example .env
# .env ထဲမှာ publishable/anon key အမှန်ထည့်ပါ
npm ci
npm run dev
```

Development server ကလည်း တူညီတဲ့ proxy handler ကို အသုံးပြုပါတယ်။

```sh
npm test
npm run build
```

`vite preview` က API server မဟုတ်ပါ။ Cloud sync စမ်းရန် `npm run dev`၊ Vercel deployment၊ သို့မဟုတ် အောက်ပါ Bun server ကိုသုံးပါ။

## Bun / VPS

```sh
bun install
bun run build
# .env မှ environment variables ကို Bun က load လုပ်ပါမယ်
PORT=4173 bun run start
```

`server.ts` က static UI၊ `/api/config`၊ `/api/supabase?__route=…` နဲ့ `/healthz` ကို serve လုပ်ပါတယ်။ Systemd template ကိုသုံးမယ်ဆို project ကို `/opt/thadingyut-wishes` မှာထားပြီး `.env` ကို app user ဖတ်နိုင်အောင် သတ်မှတ်ပါ။ လက်ရှိ Telegram bot စတာတွေကို ပြင်ဆင်ရန်မလိုပါ။ Public deployment မှာ HTTPS သုံးပါ။

## လက်ရှိ default သတ်မှတ်ချက်

Cloud startup/save timeout က ၈ စက္ကန့်ဖြစ်ပြီး ကောင်းကင်ပေါ်မှာ အစပြု default ဆုတောင်းမီးပုံး ၆၀ ဖန်တီးပါတယ်။ ကိုယ်တိုင်သိမ်းထားတဲ့ ဆုတောင်းများကို မဖျက်ပါ။

## Data နဲ့ လုံခြုံရေး

- ရှိပြီးသား anonymous session ရဲ့ storage key ကို ဆက်သုံးထားလို့ same browser + same app domain မှာ အရင် owner identity ဆက်ထိန်းနိုင်ပါတယ်။ Browser storage ဖျက်ခြင်း၊ domain/browser/device ပြောင်းခြင်းမှာ anonymous identity ဆုံးရှုံးနိုင်ပါတယ်။
- Supabase row-level security ကို မပိတ်ထားပါ။ Proxy က user ရဲ့ bearer token ကိုပဲပို့ပြီး server admin key မသုံးပါ။
- Proxy ကို app အတွက်လိုတဲ့ auth routes နဲ့ `thadingyut_profiles` table အတွက်သာ ကန့်သတ်ထားပါတယ်။ အခြား URL ကို fetch လုပ်ပေးတဲ့ open proxy မဟုတ်ပါ။
- Cloud startup/save တစ်ကြိမ်က ၈ စက္ကန့်ထက်ကြာရင် local-only mode ဆင်းပါတယ်။ Vercel cold start သို့မဟုတ် connection နှေးရင်လည်း ဒီလိုဖြစ်နိုင်ပါတယ်။ အဲဒီအချိန်မှာ လက်ရှိ tab က auto retry မလုပ်ပါ။ ပြန်ဖွင့်/reload လုပ်ရင် ပြန်ကြိုးစားပါမယ်။
- Local-only မှာ သိမ်းထားတဲ့အရာတွေကို နောက်တစ်ခါ cloud ပြန်ချိတ်တဲ့အခါ အလိုအလျောက် merge လုပ်ပေးမယ်လို့ မအာမခံပါ။ မူရင်း app ရဲ့ cloud-load ဦးစားပေးပုံစံကို ဆက်ထိန်းထားပါတယ်။
- Anonymous signup ကို လူအများအသုံးပြုမယ်ဆို Supabase auth rate limits နဲ့ Vercel firewall/rate limits ကို ချိန်ပါ။ ဒီ patch က CAPTCHA သို့မဟုတ် persistent per-user rate limiter မထည့်ထားပါ။

## ပြင်ဆင်ထားသော အဓိကဖိုင်များ

- `src/App.jsx` — same-origin SDK URL၊ runtime config၊ session key ထိန်းသိမ်းခြင်း
- `server/supabase-proxy.js` — upstream proxy နဲ့ validation
- `api/config.js`, `api/supabase.js` — Vercel server functions
- `vite.config.js`, `server.ts` — local/VPS API routing
- `tests/` — mock upstream ဖြင့် regression tests

Tests တွေက upstream Supabase ကို mock လုပ်စစ်တာဖြစ်ပြီး production database ထဲ data အသစ် မရေးပါ။ Live deployment နဲ့ ISP ပိတ်ထားတဲ့ connection ပေါ်မှ end-to-end စမ်းသပ်ခြင်းကို သီးခြားလုပ်ရပါမယ်။
