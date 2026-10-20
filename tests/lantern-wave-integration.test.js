import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createLanternArrivalPlanner, consumeLanternReleaseDelay } from '../src/lantern-arrival.js';

const legacy = await readFile(new URL('../src/legacy.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../src/lantern-physics.worker.js', import.meta.url), 'utf8');
const slice = (start, end) => legacy.slice(legacy.indexOf(start), legacy.indexOf(end, legacy.indexOf(start)));
function localLantern(delay = 0) {
  return { age:0,releaseDelay:delay,baseX:65,baseZ:75,maxSpeed:3.3,swayAmp:2,swayFreq:.4,phase:1,baseScale:1,
    group:{ position:{x:65,y:35,z:75,set(x,y,z){Object.assign(this,{x,y,z});}},rotation:{x:0,z:0},scale:{value:0,setScalar(value){this.value=value;}} },
    smokeTrail:{points:{visible:true}}, label:null, body:null };
}
function localHarness() {
  let smokeCalls = 0;
  const ctx = {consumeLanternReleaseDelay,wind:{strength:.2,dirX:.3,dirZ:.4},cameraFollow:null,randomSkyPosition:()=>({x:90,z:80}),updateSmoke:()=>{smokeCalls++;}};
  vm.createContext(ctx);
  vm.runInContext(slice('function updateLanternLocalPhysics(', 'function updateLantern(l,'),ctx);
  return {ctx,smokeCalls:()=>smokeCalls};
}
function workerHarness() {
  const messages=[];
  const ctx = {consumeLanternReleaseDelay,self:{postMessage:message=>messages.push(message)}};
  vm.createContext(ctx);
  vm.runInContext(worker.replace(/^import .*;\n/,''),ctx);
  return {send:message=>ctx.self.onmessage({data:message}),frame:()=>new Float32Array(messages.at(-1).buffer)};
}

test('worker and main-thread fallback preserve identical waiting/partial-release physics', () => {
  const {ctx}=localHarness(); const w=workerHarness(); const l=localLantern(.18);
  w.send({type:'add',state:{id:1,age:l.age,releaseDelay:l.releaseDelay,x:65,y:35,z:75,baseX:l.baseX,baseZ:l.baseZ,maxSpeed:l.maxSpeed,swayAmp:l.swayAmp,swayFreq:l.swayFreq,phase:l.phase,baseScale:l.baseScale,rotationX:0,rotationZ:0}});
  for(let i=1;i<=25;i++) {
    const dt=.08,t=i*.08;
    ctx.updateLanternLocalPhysics(l,dt,t);
    w.send({type:'tick',frameId:i,dt,t,wind:ctx.wind,suspendRecycle:false});
    const f=w.frame();assert.equal(f.length,12);assert.equal(f[0],1);
    for(const [actual,expected] of [[f[1],l.age],[f[2],l.group.position.x],[f[3],l.group.position.y],[f[4],l.group.position.z],[f[7],l.group.scale.value],[f[11],l.releaseDelay]]) assert.ok(Math.abs(actual-expected)<.0001,`${actual} != ${expected}`);
    if(i<=2){assert.equal(l.age,0);assert.equal(l.group.position.y,35);}
  }
  assert.ok(l.age>0);assert.ok(l.group.position.y>35);
});

test('waiting lanterns have no visible group, label or detached smoke; manual launches stay immediate', () => {
  const {ctx,smokeCalls}=localHarness();const waiting=localLantern(.5);
  ctx.updateLanternLocalPhysics(waiting,.05,1);ctx.updateLanternVisuals(waiting,.05,1);
  assert.equal(waiting.group.visible,false);assert.equal(waiting.smokeTrail.points.visible,false);assert.equal(smokeCalls(),0);
  const manual=localLantern();ctx.updateLanternLocalPhysics(manual,.05,1);ctx.updateLanternVisuals(manual,.05,1);
  assert.equal(manual.group.visible,true);assert.equal(manual.smokeTrail.points.visible,true);assert.ok(manual.age>0);assert.equal(smokeCalls(),1);
  assert.match(legacy,/raycaster\.intersectObjects\(lanterns\.filter\(l => l\.group\.visible\)/);
});

test('startup shares one wave planner across real and ambient wishes, never changes saved records', () => {
  const wishes=Array.from({length:40},(_,i)=>({_skyKey:`db-${i}`,id:`id-${i}`,text:`wish ${i}`,position:{x:1,z:2}}));
  const original=JSON.stringify(wishes);const spawned=[];
  const ctx={createLanternArrivalPlanner,planSkyLanterns:()=>({ambientCount:60,wishes}),communityWishes:wishes,userWishes:[],hiddenLocalSourceIds:[],hiddenLocalWishKeys:[],lanterns:[],AMBIENT_WISHES:['sample']};
  ctx.spawnLantern=(text,opts)=>{const l={group:{position:{x:opts.position.x,y:opts.startY,z:opts.position.z}},opts,text};ctx.lanterns.push(l);spawned.push(l);};
  ctx.spawnPolicyWish=(wish,index,arrival)=>ctx.spawnLantern(wish.text,{...arrival,canonical:wish.id});
  vm.createContext(ctx);vm.runInContext(slice('function nextSkyArrival(', '\ninitializeSky();'),ctx);ctx.initializeSky();
  assert.equal(spawned.length,100);assert.equal(spawned.filter(l=>l.opts.isAmbient).length,60);
  assert.equal(spawned.filter(l=>l.opts.canonical).length,40);
  assert.ok(spawned[0].opts.canonical,'first wave contains real wishes');
  const delays=spawned.map(l=>l.opts.releaseDelay);assert.ok(Math.max(...delays)>5);assert.ok(Math.max(...delays)<=22);
  assert.ok(delays.filter(x=>x<.3).length>=3,'first wave is a group, not a single lantern');
  assert.equal(JSON.stringify(wishes),original);
});

test('feed polling keeps existing waiting lantern objects; moderation removes pending lanterns immediately', () => {
  const wish={_skyKey:'db-1',_isCommunity:true,id:'a'.repeat(32),source_id:'local-1',text:'peace'};
  let plan={ambientCount:0,databaseOnly:true,wishes:[wish]};
  const lantern={skyKey:'db-1',releaseDelay:5,isCommunity:true,isAmbient:false};const disposed=[];
  const ctx={createLanternArrivalPlanner,planSkyLanterns:()=>plan,communityWishes:[wish],userWishes:[],hiddenLocalSourceIds:[],hiddenLocalWishKeys:[],legacyWishKey:()=>'',localKey:()=>'',lanterns:[lantern],cameraFollow:null,currentLantern:null,
    disposeLantern:l=>disposed.push(l),updateCounter(){},spawnPolicyWish(){throw Error('Existing object respawned');},nextSkyArrival(){throw Error('Existing arrival rescheduled');},AMBIENT_WISHES:['sample']};
  vm.createContext(ctx);vm.runInContext(slice('function reconcileSkyWishes(', '// Initial composition'),ctx);
  ctx.reconcileSkyWishes();ctx.reconcileSkyWishes();
  assert.equal(ctx.lanterns[0],lantern);assert.equal(lantern.releaseDelay,5);assert.equal(lantern.archiveWishId,wish.id);
  plan={ambientCount:0,databaseOnly:true,wishes:[]};ctx.reconcileSkyWishes();
  assert.equal(ctx.lanterns.length,0);assert.deepEqual(disposed,[lantern]);
});

test('release state survives worker readiness and fallback and does not use wall-clock spawn timers', () => {
  assert.match(legacy,/id:lantern\.physicsId, age:lantern\.age, releaseDelay:lantern\.releaseDelay/);
  assert.match(legacy,/lantern\.releaseDelay=states\[i\+11\]/);
  assert.match(worker,/const STRIDE = 12/);
  assert.doesNotMatch(slice('function nextSkyArrival(', '\ninitializeSky();'),/setTimeout|setInterval|saveWishes/);
});
