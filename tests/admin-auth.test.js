import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAdminHandler } from '../server/admin.js';
const origin='https://23.94.67.231';
const password='test-only-password-မြန်မာ';
const salt=randomBytes(16);
const encoded=`scrypt-v1$${salt.toString('base64url')}$${scryptSync(password,salt,64,{N:16384,r:8,p:1}).toString('hex')}`;
const env={THADINGYUT_PUBLIC_ORIGIN:origin,THADINGYUT_ADMIN_PASSWORD_HASH:encoded,THADINGYUT_ADMIN_BACKEND_KEY:'b'.repeat(64),SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
function request(path='/admin',{method='GET',data,cookie,from=origin,headers={}}={}) {
  if(cookie)headers={...headers,cookie};
  if(method==='POST')headers={...headers,origin:from,'content-type':'application/x-www-form-urlencoded'};
  return new Request(origin+path,{method,headers,body:data==null?undefined:new URLSearchParams(data)});
}
async function login(handler,ip='198.51.100.1') {
  const r=await handler(request('/admin/login',{method:'POST',data:{password}}),env,{clientIp:ip});
  assert.equal(r.status,303);return r.headers.get('set-cookie').split(';')[0];
}
function mock() {
  const calls=[];const handler=createAdminHandler({fetchImpl:async(url,options)=>{calls.push({url:String(url),options,body:JSON.parse(options.body)});return Response.json({items:[],has_more:false});}});
  return {handler,calls};
}
async function csrf(handler,cookie) {
  const r=await handler(request('/admin',{cookie}),env);assert.equal(r.status,200);
  const body=await r.text();const match=/name="csrf"[^>]*value="([0-9a-f]{64})"/.exec(body);
  assert.ok(match,'admin forms have CSRF token');return match[1];
}

test('unauthenticated admin shows login, does not load data or disclose any authority', async()=>{
 const {handler,calls}=mock();const r=await handler(request(),env);const text=await r.text();
 assert.equal(r.status,200);assert.match(text,/type="password"/);assert.equal(calls.length,0);
 for(const secret of [password,encoded,env.THADINGYUT_ADMIN_BACKEND_KEY])assert.ok(!text.includes(secret));
 assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.equal(await handler(new Request(origin+'/'),env),null);
});
test('HTTP only redirects GET to configured HTTPS; never accepts a cleartext credential POST or spoofed forwarding header',async()=>{
 const {handler,calls}=mock();
 const r=await handler(new Request('http://23.94.67.231/admin'),env);assert.equal(r.status,308);assert.equal(r.headers.get('location'),origin+'/admin');
 const p=await handler(new Request('http://23.94.67.231/admin/login',{method:'POST',headers:{'x-forwarded-proto':'https'}}),env);assert.equal(p.status,426);assert.equal(calls.length,0);
 const spoof=await handler(new Request('https://attacker.example/admin'),env);assert.equal(spoof.status,400);
});
test('correct password creates secure HttpOnly cookie, wrong password fails and successful login exposes no key',async()=>{
 const {handler,calls}=mock();
 const bad=await handler(request('/admin/login',{method:'POST',data:{password:'wrong'}}),env,{clientIp:'bad'});assert.equal(bad.status,401);
 const r=await handler(request('/admin/login',{method:'POST',data:{password}}),env,{clientIp:'good'});
 assert.equal(r.status,303);const c=r.headers.get('set-cookie');assert.match(c,/^__Secure-thadingyut_admin=[0-9a-f]{64};/);
 for(const attr of ['HttpOnly','Secure','SameSite=Strict','Path=/admin'])assert.ok(c.includes(attr));
 assert.equal(calls.length,0);assert.ok(!c.includes(password));
});
test('five failed attempts per IP are bounded and forwarded-IP cannot bypass the limiter',async()=>{
 const {handler}=mock();
 const responses=[];for(let i=0;i<6;i++) responses.push(await handler(request('/admin/login',{method:'POST',data:{password:'wrong'},headers:{'x-forwarded-for':`10.0.0.${i}`}}),env,{clientIp:'same-address'}));
 assert.equal(responses.filter(r=>r.status===401).length,5);assert.equal(responses.filter(r=>r.status===429).length,1);
});
test('cross-origin posts, missing CSRF, invalid mutation data and delete paths never call the backend',async()=>{
 const {handler,calls}=mock();const cookie=await login(handler);const token=await csrf(handler,cookie);calls.length=0;
 assert.equal((await handler(request('/admin/review',{method:'POST',cookie,from:'https://attacker.example',data:{csrf:token}}),env)).status,403);
 assert.equal((await handler(request('/admin/review',{method:'POST',cookie,data:{report_id:'1',status:'dismissed'}}),env)).status,403);
 assert.equal((await handler(request('/admin/review',{method:'POST',cookie,data:{csrf:token,report_id:'1',status:'pending'}}),env)).status,400);
 assert.equal((await handler(request('/admin/visibility',{method:'POST',cookie,data:{csrf:token,wish_id:'bad',hidden:'true'}}),env)).status,400);
 assert.equal((await handler(request('/admin/delete',{method:'POST',cookie,data:{csrf:token}}),env)).status,404);
 assert.equal(calls.length,0);
});
test('authenticated reads and moderation send scoped key only server-to-server and preserve bigint report IDs',async()=>{
 const {handler,calls}=mock();const cookie=await login(handler);const token=await csrf(handler,cookie);calls.length=0;
 const id='9007199254740993';const r=await handler(request('/admin/review',{method:'POST',cookie,data:{csrf:token,report_id:id,status:'dismissed',notes:'စိစစ်ပြီး'}}),env);
 assert.equal(r.status,303);assert.equal(calls.length,1);assert.equal(calls[0].body.p_report_id,id);assert.equal(calls[0].body.p_admin_key,env.THADINGYUT_ADMIN_BACKEND_KEY);
 assert.ok(calls[0].url.endsWith('/rest/v1/rpc/thadingyut_admin_review_report'));assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.apikey,env.SUPABASE_PUBLISHABLE_KEY);
 assert.ok(!r.headers.get('location').includes(env.THADINGYUT_ADMIN_BACKEND_KEY));
});
test('expiry, logout and login rotation revoke old sessions',async()=>{
 let time=1000;const handler=createAdminHandler({now:()=>time,fetchImpl:async()=>Response.json({items:[],has_more:false})});
 const first=await login(handler);const token=await csrf(handler,first);
 const logout=await handler(request('/admin/logout',{method:'POST',cookie:first,data:{csrf:token}}),env);assert.equal(logout.status,303);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 assert.match(await (await handler(request('/admin',{cookie:first}),env)).text(),/type="password"/);
 const second=await login(handler,'next');time+=8*60*60*1000+1;
 assert.match(await (await handler(request('/admin',{cookie:second}),env)).text(),/type="password"/);
});
test('backend failures, bad configuration and excessive form bodies fail closed without exposing server secrets',async()=>{
 const handler=createAdminHandler({fetchImpl:async()=>{throw Error(env.THADINGYUT_ADMIN_BACKEND_KEY);}});const cookie=await login(handler);
 const r=await handler(request('/admin',{cookie}),env);assert.equal(r.status,503);assert.ok(!(await r.text()).includes(env.THADINGYUT_ADMIN_BACKEND_KEY));
 assert.equal((await handler(request(),{})).status,503);
 const large=new Request(origin+'/admin/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:'password='+('x'.repeat(17000))});
 assert.equal((await handler(large,env,{clientIp:'large'})).status,400);
});
test('admin authority is not added to public frontend/proxy configuration',async()=>{
 const proxy=await readFile(new URL('../server/supabase-proxy.js',import.meta.url),'utf8');
 assert.ok(!proxy.includes('THADINGYUT_ADMIN_'));assert.ok(!proxy.includes('thadingyut_admin_'));
});


test('distributed attempts cannot run more than two password KDFs concurrently',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve;});let active=0,max=0;
 const handler=createAdminHandler({verifyPasswordImpl:async()=>{active++;max=Math.max(max,active);await waiting;active--;return false;}});
 const pending=Array.from({length:8},(_,i)=>handler(request('/admin/login',{method:'POST',data:{password:'wrong'}}),env,{clientIp:`independent-${i}`}));
 await new Promise(resolve=>setImmediate(resolve));release();const responses=await Promise.all(pending);
 assert.equal(max,2);assert.equal(responses.filter(r=>r.status===429).length,6);
});


test('native browser forms retain a same-origin Origin instead of no-referrer null Origin',async()=>{
 const {handler}=mock();
 const page=await handler(request('/admin'),env);
 assert.equal(page.headers.get('referrer-policy'),'same-origin');
 const response=await handler(request('/admin/login',{method:'POST',headers:{'sec-fetch-site':'same-origin'},data:{password}}),env,{clientIp:'browser-form'});
 assert.equal(response.status,303);
 assert.equal(response.headers.get('referrer-policy'),'same-origin');
});
test('null, missing, and cross-site Origins still fail closed after browser form compatibility fix',async()=>{
 const {handler,calls}=mock();
 for(const from of ['null','https://attacker.example']) {
   const r=await handler(request('/admin/login',{method:'POST',from,data:{password}}),env,{clientIp:'forged'});
   assert.equal(r.status,403);
 }
 const missing=new Request(origin+'/admin/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password})});
 assert.equal((await handler(missing,env,{clientIp:'missing'})).status,403);
 assert.equal(calls.length,0);
});
