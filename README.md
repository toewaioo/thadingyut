# သီတင်းကျွတ် ဆုတောင်းမယ် — Server-side Supabase Proxy

ဒီဗားရှင်းမှာ browser က `*.supabase.co` ကို တိုက်ရိုက်မခေါ်တော့ပါ။ Anonymous login၊ session refresh နဲ့ profile ဖတ်/သိမ်းခြင်းတို့ကို app ရဲ့ same-origin API ကတစ်ဆင့်ပို့ပါတယ်။ UI နဲ့ local-storage fallback ကို ထိန်းထားပါတယ်။

```text
Browser → https://su-taung-mal.vercel.app/api/supabase/…
        → Vercel server → Supabase
```

ISP က Supabase domain ကိုသာ ပိတ်ထားပြီး app domain ကိုဖွင့်နိုင်ရင် ဒီပုံစံက အထောက်အကူဖြစ်နိုင်ပါတယ်။ App domain ကိုပါပိတ်ထားရင် မဖြေရှင်းနိုင်ပါ။ Server က Supabase ကို ဆက်သွယ်နိုင်ဖို့လည်း လိုပါတယ်။

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
5. `https://သင့်-app-domain/api/config` ကိုဖွင့်ရင် public configuration JSON ရသင့်ပါတယ်။ App ကိုဖွင့်ပြီး Network tab မှာ login/data request တွေဟာ app ရဲ့ `/api/supabase/…` ကိုပဲခေါ်ကြောင်း စစ်ပါ။ `Cloud sync active` ဖြစ်ပြီး ဆုတောင်းတစ်ခုသိမ်းကာ reload လုပ်၍ စစ်ပါ။

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

`server.ts` က static UI၊ `/api/config`၊ `/api/supabase/…` နဲ့ `/healthz` ကို serve လုပ်ပါတယ်။ Systemd template ကိုသုံးမယ်ဆို project ကို `/opt/thadingyut-wishes` မှာထားပြီး `.env` ကို app user ဖတ်နိုင်အောင် သတ်မှတ်ပါ။ လက်ရှိ Telegram bot စတာတွေကို ပြင်ဆင်ရန်မလိုပါ။ Public deployment မှာ HTTPS သုံးပါ။

## Data နဲ့ လုံခြုံရေး

- ရှိပြီးသား anonymous session ရဲ့ storage key ကို ဆက်သုံးထားလို့ same browser + same app domain မှာ အရင် owner identity ဆက်ထိန်းနိုင်ပါတယ်။ Browser storage ဖျက်ခြင်း၊ domain/browser/device ပြောင်းခြင်းမှာ anonymous identity ဆုံးရှုံးနိုင်ပါတယ်။
- Supabase row-level security ကို မပိတ်ထားပါ။ Proxy က user ရဲ့ bearer token ကိုပဲပို့ပြီး server admin key မသုံးပါ။
- Proxy ကို app အတွက်လိုတဲ့ auth routes နဲ့ `thadingyut_profiles` table အတွက်သာ ကန့်သတ်ထားပါတယ်။ အခြား URL ကို fetch လုပ်ပေးတဲ့ open proxy မဟုတ်ပါ။
- Cloud startup/save တစ်ကြိမ်က ၃ စက္ကန့်ထက်ကြာရင် အရင်ဗားရှင်းအတိုင်း local-only mode ဆင်းပါတယ်။ Vercel cold start သို့မဟုတ် connection နှေးရင်လည်း ဒီလိုဖြစ်နိုင်ပါတယ်။ အဲဒီအချိန်မှာ လက်ရှိ tab က auto retry မလုပ်ပါ။ ပြန်ဖွင့်/reload လုပ်ရင် ပြန်ကြိုးစားပါမယ်။
- Local-only မှာ သိမ်းထားတဲ့အရာတွေကို နောက်တစ်ခါ cloud ပြန်ချိတ်တဲ့အခါ အလိုအလျောက် merge လုပ်ပေးမယ်လို့ မအာမခံပါ။ မူရင်း app ရဲ့ cloud-load ဦးစားပေးပုံစံကို ဆက်ထိန်းထားပါတယ်။
- Anonymous signup ကို လူအများအသုံးပြုမယ်ဆို Supabase auth rate limits နဲ့ Vercel firewall/rate limits ကို ချိန်ပါ။ ဒီ patch က CAPTCHA သို့မဟုတ် persistent per-user rate limiter မထည့်ထားပါ။

## ပြင်ဆင်ထားသော အဓိကဖိုင်များ

- `src/App.jsx` — same-origin SDK URL၊ runtime config၊ session key ထိန်းသိမ်းခြင်း
- `server/supabase-proxy.js` — upstream proxy နဲ့ validation
- `api/config.js`, `api/supabase/[...path].js` — Vercel server functions
- `vite.config.js`, `server.ts` — local/VPS API routing
- `tests/` — mock upstream ဖြင့် regression tests

Tests တွေက upstream Supabase ကို mock လုပ်စစ်တာဖြစ်ပြီး production database ထဲ data အသစ် မရေးပါ။ Live deployment နဲ့ ISP ပိတ်ထားတဲ့ connection ပေါ်မှ end-to-end စမ်းသပ်ခြင်းကို သီးခြားလုပ်ရပါမယ်။
