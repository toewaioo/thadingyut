import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/legacy.js',import.meta.url),'utf8');
const markup=readFileSync(new URL('../src/legacy-ui.html',import.meta.url),'utf8');

test('the scene clock, Sun, Moon and sky lighting share browser-local hours',()=>{
 assert.match(source,/const environment = createSkyClockState\(savedEnvironment\)/);
 assert.match(source,/function getHours\(\)\{\s*return getSkyHours\(environment\);/);
 assert.match(source,/const hours = getHours\(\);\s*const sunPos = getCelestialPosition\(hours\);\s*const moonPos = getCelestialPosition\(hours \+ 12\);/);
 assert.match(source,/dayFactor = smoothstep\(-150, 250, sunPos\.y\)/);
 assert.doesNotMatch(source,/Object\.assign\(environment, JSON\.parse/);
 assert.match(source,/environment\.mode = b\.dataset\.mode/);
 assert.match(source,/environment\.manualTime = parseFloat\(timeSlider\.value\)/);
 assert.match(source,/getBrowserTimeZone\(\)/);
 assert.match(markup,/Browser Local Time/);
 assert.match(markup,/id="bigTime">--:--<\/div>/);
});

test('unchanged solar orbit crosses dawn/noon/dusk/midnight and the Moon stays opposite',()=>{
 const declaration=source.match(/function getCelestialPosition\(hours\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(declaration);
 const position=vm.runInNewContext(`(${declaration})`);
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
 near(position(6).x,-900);near(position(6).y,0);
 near(position(12).x,0);near(position(12).y,900);
 near(position(18).x,900);near(position(18).y,0);
 near(position(0).x,0);near(position(0).y,-900);
 for(const hour of [0,3.5,6,12,18,23.999]) {
   const sun=position(hour),moon=position(hour+12);
   near(sun.x,-moon.x);near(sun.y,-moon.y);
 }
});

test('sky discovery hint is removed while the original report selector prompt stays accessible',()=>{
 const selector=markup.match(/<select id="wishReportReason"[^>]*>[\s\S]*?<\/select>/)?.[0];
 assert.ok(selector);assert.match(selector,/required/);
 assert.match(selector,/<option value="" disabled selected>အကြောင်းရင်း ရွေးပါ<\/option>/);
 assert.doesNotMatch(markup,/report-discovery-hint|မီးပုံးကို နှိပ်ပြီး ဆုတောင်းကတ်ရှိ/);
 assert.match(markup,/<label for="wishReportReason">တိုင်ကြားသည့် အကြောင်းရင်း<\/label>/);
 for(const value of ['spam','harassment','hate','sexual','violence','personal_info','other']) {
   assert.match(selector,new RegExp(`<option value="${value}">[^<]+<\\/option>`));
 }
 assert.equal((selector.match(/<option /g)||[]).length,8);
});
