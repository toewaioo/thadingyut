import * as THREE from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }       from 'three/addons/postprocessing/OutputPass.js';

/* ═══════════════════════════════════════════
   ENVIRONMENT (time & day/night)
   ═══════════════════════════════════════════ */
function announceCloudChange(){
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('thadingyut:data-change'));
}

const environment = {
  mode: 'auto',
  manualTime: 18
};
try {
  const s = localStorage.getItem('thadingyut_env_v1');
  if (s) Object.assign(environment, JSON.parse(s));
} catch(e){}
function saveEnv(){
  try { localStorage.setItem('thadingyut_env_v1', JSON.stringify(environment)); announceCloudChange(); } catch(e){}
}
function getHours(){
  if (environment.mode === 'auto'){
    const n = new Date();
    return n.getHours() + n.getMinutes()/60 + n.getSeconds()/3600;
  }
  return environment.manualTime;
}
function smoothstep(a, b, x){
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function getCelestialPosition(hours){
  /* 6am: east horizon (x = -900, y = 0)
     12pm: top (x = 0, y = 900)
     6pm: west horizon (x = 900, y = 0)
     12am: below (x = 0, y = -900) */
  const h = ((hours - 6) % 24 + 24) % 24;
  const angle = (h / 24) * Math.PI * 2;
  return {
    x: -Math.cos(angle) * 900,
    y:  Math.sin(angle) * 900,
    z: -500
  };
}

/* Season (only affects lantern hues + subtitle now) */
const SEASONS = {
  thadingyut: {
    name:'သီတင်းကျွတ်',
    subtitle:'သီတင်းကျွတ် အခါတော်နေ့',
    hues:[0xff9028,0xff5866,0xff4a8c,0xa06aff,0x4a9eff,0x40d68c,0xffd24a]
  },
  tazaungdaing: {
    name:'တန်ဆောင်မုန်း',
    subtitle:'တန်ဆောင်မုန်း မီးပုံးပျံပွဲ',
    hues:[0x8ab4ff,0x4a9eff,0xa06aff,0xffd24a,0x40d68c,0x6ad4ff,0xff90c8]
  },
  kathina: {
    name:'ကထိန်',
    subtitle:'ကထိန် သင်္ကန်းကပ်လှူပွဲ',
    hues:[0xffd24a,0xffb347,0xff9028,0xff6a3a,0xffd4a0,0xffaa3a,0xe8b438]
  }
};

const POEMS = [
  'မီးပုံးရောင်စုံ လွင့်တက်လေသောအခါ\nဆုတောင်းသံများ ကောင်းကင်ဆီ ရောက်ပါစေ',
  'သီတင်းကျွတ်လပြည့်ည\nဆီမီးအလင်းနှင့် မေတ္တာအလင်း ထွန်းလင်းပါစေ',
  'အမှောင်ကို ဖျောက်ဖျက်သော အလင်းရောင်\nမိဘကျေးဇူး ဆပ်နိုင်ပါစေ',
  'မီးပုံးတစ်လုံး လွှတ်လိုက်တိုင်း\nဆုတောင်းတစ်ခု ပြည့်ဝပါစေ',
  'ကောင်းကင်မှာ လွင့်နေတဲ့ မီးပုံးများ\nကမ္ဘာလုံးကို အလင်းပေးပါစေ',
  'သီတင်းကျွတ်ညရဲ့ အလင်းရောင်\nနှလုံးသားထဲ ထာဝရ လင်းလက်ပါစေ'
];

/* ═══════════════════════════════════════════
   RENDERER / SCENE / CAMERA
   ═══════════════════════════════════════════ */
const canvas   = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias:true, powerPreference:'high-performance',
  preserveDrawingBuffer: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace    = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog   = new THREE.FogExp2(0x080814, 0.0012);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.5, 3200);
const DEFAULT_CAM_POS = new THREE.Vector3(44, 66, 152);
const DEFAULT_TARGET  = new THREE.Vector3(0, 52, -22);
camera.position.copy(DEFAULT_CAM_POS);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(DEFAULT_TARGET);
controls.enableDamping   = true;
controls.dampingFactor   = 0.06;
controls.enablePan       = false;
controls.minDistance     = 48;
controls.maxDistance     = 330;
controls.minPolarAngle   = 0.15;
controls.maxPolarAngle   = Math.PI * 0.5;
controls.autoRotate      = true;
controls.autoRotateSpeed = 0.22;
controls.addEventListener('start', () => { controls.autoRotate = false; });

/* ═══════════════════════════════════════════
   LIGHTS (kept refs for day/night transitions)
   ═══════════════════════════════════════════ */
const hemiLight = new THREE.HemisphereLight(0x35406e, 0x07070f, 0.32);
scene.add(hemiLight);

const ambientLight = new THREE.AmbientLight(0x1c2038, 0.5);
scene.add(ambientLight);

const moonLight = new THREE.DirectionalLight(0x94a8e8, 0.35);
moonLight.position.set(-340, 360, -640);
scene.add(moonLight);

const sunLight = new THREE.DirectionalLight(0xfff0c0, 0);
sunLight.position.set(0, 500, 0);
scene.add(sunLight);

const warmLight = new THREE.PointLight(0xffb060, 1.4, 320, 1.7);
warmLight.position.set(0, 70, -70);
scene.add(warmLight);

const pagodaCore = new THREE.PointLight(0xffc878, 0.9, 160, 1.9);
pagodaCore.position.set(0, 58, -70);
scene.add(pagodaCore);

const spotPivots = [];
for (let i=0;i<3;i++){
  const pivot = new THREE.Object3D();
  pivot.position.set(0, 30, -70);
  scene.add(pivot);
  const spot = new THREE.SpotLight(0xffd890, 12, 320, Math.PI/7, 0.7, 1.8);
  spot.position.set(0, 30, 0);
  spot.target.position.set(0, 60, 0);
  pivot.add(spot);
  pivot.add(spot.target);
  pivot.rotation.y = (i/3) * Math.PI * 2;
  spotPivots.push({ pivot, speed: 0.12 + i*0.04, dir: i%2===0 ? 1 : -1 });
}

/* ═══════════════════════════════════════════
   TEXTURES
   ═══════════════════════════════════════════ */
const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128,128,0,128,128,128);
  g.addColorStop(0.00,'rgba(255,232,180,1)');
  g.addColorStop(0.18,'rgba(255,200,105,0.7)');
  g.addColorStop(0.42,'rgba(255,158,48,0.25)');
  g.addColorStop(0.70,'rgba(255,120,20,0.06)');
  g.addColorStop(1.00,'rgba(255,90,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,256,256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const sunGlowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128,128,0,128,128,128);
  g.addColorStop(0.00,'rgba(255,255,240,1)');
  g.addColorStop(0.15,'rgba(255,250,200,0.85)');
  g.addColorStop(0.40,'rgba(255,220,120,0.32)');
  g.addColorStop(0.70,'rgba(255,180,60,0.08)');
  g.addColorStop(1.00,'rgba(255,140,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,256,256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const candleGlowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0.00,'rgba(255,248,220,1)');
  g.addColorStop(0.20,'rgba(255,225,150,0.85)');
  g.addColorStop(0.50,'rgba(255,180,60,0.28)');
  g.addColorStop(0.80,'rgba(255,130,20,0.06)');
  g.addColorStop(1.00,'rgba(255,90,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,128,128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const smokeTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(220,210,200,0.55)');
  g.addColorStop(0.4,'rgba(180,170,160,0.22)');
  g.addColorStop(1,'rgba(120,110,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,64,64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

/* ═══════════════════════════════════════════
   SKY
   ═══════════════════════════════════════════ */
const skyUniforms = {
  cTop:    { value: new THREE.Color('#01020a') },
  cMid:    { value: new THREE.Color('#070c26') },
  cBottom: { value: new THREE.Color('#1a1136') }
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  vertexShader:`varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader:`
    varying vec3 vPos;
    uniform vec3 cTop, cMid, cBottom;
    void main(){
      float h = normalize(vPos).y;
      vec3 col = mix(cBottom, cMid, smoothstep(-0.25, 0.30, h));
      col = mix(col, cTop, smoothstep(0.22, 0.85, h));
      float n = sin(vPos.x*0.003) * cos(vPos.z*0.0035);
      col += vec3(0.015,0.008,0.025) * n;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  side: THREE.BackSide, depthWrite:false, fog:false
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(1500, 40, 28), skyMat));

/* Sky color targets */
const SKY_NIGHT = {
  top: new THREE.Color('#01020a'),
  mid: new THREE.Color('#070c26'),
  bottom: new THREE.Color('#1a1136')
};
const SKY_DAY = {
  top: new THREE.Color('#2a5aa8'),
  mid: new THREE.Color('#6aa8d8'),
  bottom: new THREE.Color('#c0e0f0')
};
const SKY_SUNSET = {
  top: new THREE.Color('#1a1a4a'),
  mid: new THREE.Color('#c86040'),
  bottom: new THREE.Color('#f0b060')
};

/* Soft procedural cloud sprites drift across the daytime sky. */
const cloudTexture = (() => {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  const puffs = [[54,166,54],[104,126,72],[170,145,88],[236,116,74],[298,144,88],[367,126,70],[430,165,56],[82,177,43],[180,173,50],[335,177,55]];
  puffs.forEach(([x,y,r]) => {
    const g = ctx.createRadialGradient(x-r*.12,y-r*.18,0,x,y,r*1.35);
    g.addColorStop(0,'rgba(255,255,255,.62)');
    g.addColorStop(.48,'rgba(250,253,255,.42)');
    g.addColorStop(.78,'rgba(237,246,255,.16)');
    g.addColorStop(1,'rgba(230,242,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r*1.35,0,Math.PI*2); ctx.fill();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const cloudMaterial = new THREE.SpriteMaterial({
  map: cloudTexture, color: 0xffffff, transparent: true, opacity: 0,
  depthWrite: false, fog: false
});
const cloudSprites = [];
for (let i=0; i<20; i++){
  const angle = (i/20)*Math.PI*2;
  const radius = 500 + Math.random()*150;
  const cloud = new THREE.Sprite(cloudMaterial);
  cloud.position.set(Math.cos(angle)*radius, 105 + Math.random()*185, -70 + Math.sin(angle)*radius);
  cloud.scale.set(150 + Math.random()*150, 65 + Math.random()*55, 1);
  cloud.userData.drift = 0.35 + Math.random()*0.6;
  cloud.visible = false;
  scene.add(cloud);
  cloudSprites.push(cloud);
}

/* ═══════════════════════════════════════════
   STARS (with opacity uniform)
   ═══════════════════════════════════════════ */
const starMaterial = (() => {
  const COUNT = 2900;
  const pos   = new Float32Array(COUNT*3);
  const sizes = new Float32Array(COUNT);
  const colors= new Float32Array(COUNT*3);
  const tints = [[1,1,1],[1,.96,.85],[.85,.9,1],[1,.85,.7]];
  for (let i=0;i<COUNT;i++){
    const r     = 820 + Math.random()*460;
    const theta = Math.random()*Math.PI*2;
    const phi   = Math.acos(Math.random()*0.97);
    pos[i*3]   = r*Math.sin(phi)*Math.cos(theta);
    pos[i*3+1] = r*Math.cos(phi) + 40;
    pos[i*3+2] = r*Math.sin(phi)*Math.sin(theta);
    sizes[i]   = Math.random()*1.4 + 0.35;
    const tint = tints[Math.floor(Math.random()*tints.length)];
    colors[i*3] = tint[0]; colors[i*3+1] = tint[1]; colors[i*3+2] = tint[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('size',     new THREE.BufferAttribute(sizes,1));
  g.setAttribute('color',    new THREE.BufferAttribute(colors,3));

  const m = new THREE.ShaderMaterial({
    uniforms:{
      uPixelRatio:{value: renderer.getPixelRatio()},
      uOpacity:{value: 1.0}
    },
    vertexShader:`
      attribute float size; attribute vec3 color;
      varying float vSize; varying vec3 vColor;
      uniform float uPixelRatio;
      void main(){
        vSize = size; vColor = color;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * 1.7 * uPixelRatio;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader:`
      varying float vSize; varying vec3 vColor;
      uniform float uOpacity;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float core = smoothstep(0.5, 0.0, d);
        float halo = smoothstep(0.5, 0.15, d) * 0.28;
        float a = core + halo;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a * 0.72 * uOpacity);
      }
    `,
    transparent:true, depthWrite:false, fog:false, blending: THREE.AdditiveBlending
  });
  const stars = new THREE.Points(g, m);
  stars.frustumCulled = false;
  scene.add(stars);
  return m;
})();

/* Slow, luminous meteors with a tapered colored trail, drifting sparks, and camera tracking. */
const shootingStars = [];
let nextShootingStarAt = 0;
let shootingStarsNightActive = false;
let meteorCameraFocus = null;
let pendingMeteorFocus = null;
function makeMeteorTrailGeometry(){
  const segments = 18;
  const positions = new Float32Array((segments+1)*2*3);
  const fades = new Float32Array((segments+1)*2);
  const along = new Float32Array((segments+1)*2);
  const indices = [];
  for (let i=0;i<=segments;i++){
    const t = i/segments;
    const x = -58*t;
    const width = .12 + 2.5*Math.pow(1-t,1.35);
    const base = i*2;
    positions.set([x,-width,0,x,width,0],base*3);
    const fade = Math.pow(1-t,1.25);
    fades[base]=fade; fades[base+1]=fade;
    along[base]=t; along[base+1]=t;
    if (i<segments){
      const a=base,b=base+1,c=base+2,d=base+3;
      indices.push(a,b,c,b,d,c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('aFade',new THREE.BufferAttribute(fades,1));
  geometry.setAttribute('aAlong',new THREE.BufferAttribute(along,1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
function makeShootingStar(){
  const group = new THREE.Group();
  const trailGeometry = makeMeteorTrailGeometry();
  const trailMaterial = new THREE.ShaderMaterial({
    uniforms:{uOpacity:{value:0}}, transparent:true, depthWrite:false,
    blending:THREE.AdditiveBlending, side:THREE.DoubleSide, fog:false, toneMapped:false,
    vertexShader:`
      attribute float aFade;
      attribute float aAlong;
      varying float vFade;
      varying float vAlong;
      void main(){
        vFade=aFade; vAlong=aAlong;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }
    `,
    fragmentShader:`
      uniform float uOpacity;
      varying float vFade;
      varying float vAlong;
      void main(){
        vec3 head=vec3(1.0,.88,.62);
        vec3 tail=vec3(.25,.45,1.0);
        float alpha=uOpacity*vFade;
        if(alpha<.008) discard;
        gl_FragColor=vec4(mix(head,tail,vAlong),alpha);
      }
    `
  });
  const trail = new THREE.Mesh(trailGeometry,trailMaterial);
  trail.renderOrder=1; group.add(trail);
  const streakGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0,0,.03),new THREE.Vector3(-34,12,.03)
  ]);
  const streakMaterial = new THREE.LineBasicMaterial({
    color:0xe4f1ff,transparent:true,opacity:0,
    blending:THREE.AdditiveBlending,depthWrite:false
  });
  const streak = new THREE.Line(streakGeometry,streakMaterial);
  streak.renderOrder=2; group.add(streak);
  const auraMaterial = new THREE.SpriteMaterial({
    map:glowTex,color:0x6999ff,transparent:true,opacity:0,
    blending:THREE.AdditiveBlending,depthWrite:false,fog:false
  });
  const aura = new THREE.Sprite(auraMaterial);
  aura.scale.set(22,22,1); aura.renderOrder=3; group.add(aura);
  const glowMaterial = new THREE.SpriteMaterial({
    map:glowTex,color:0xfff4d1,transparent:true,opacity:0,
    blending:THREE.AdditiveBlending,depthWrite:false,fog:false
  });
  const head = new THREE.Sprite(glowMaterial);
  head.scale.set(11,11,1); head.renderOrder=4; group.add(head);
  const sparks=[];
  for (let i=0;i<5;i++){
    const material=new THREE.SpriteMaterial({
      map:glowTex,color:i%2?0xb7d7ff:0xffe7a3,transparent:true,opacity:0,
      blending:THREE.AdditiveBlending,depthWrite:false,fog:false
    });
    const spark=new THREE.Sprite(material);
    spark.position.set(-10-i*9,(Math.random()-.5)*4,.05);
    const size=2.2+Math.random()*1.2;
    spark.scale.set(size,size,1); spark.renderOrder=5; group.add(spark);
    sparks.push({sprite:spark,phase:Math.random()*Math.PI*2});
  }
  group.visible=false;
  scene.add(group);
  return {group,trailMaterial,streakMaterial,auraMaterial,glowMaterial,sparks,age:0,duration:1.8,velocity:new THREE.Vector3(),active:false,impactAt:null};
}
for (let i=0;i<3;i++) shootingStars.push(makeShootingStar());
function launchShootingStar(star,t){
  star.group.position.set((Math.random()-.5)*420,230+Math.random()*270,-390-Math.random()*340);
  star.velocity.set(52+Math.random()*28,-18-Math.random()*18,0);
  star.age=0; star.duration=3.2+Math.random()*1.0; star.active=true; star.impactAt=null;
  star.group.rotation.z=Math.atan2(star.velocity.y,star.velocity.x);
  star.group.visible=true;
  beginMeteorCameraFocus(star,t);
}
function updateShootingStars(dt,t,nightFactor){
  if (nightFactor<.38){
    shootingStarsNightActive=false;
    shootingStars.forEach(star=>{if(star.active){star.active=false;star.impactAt=t;star.group.visible=false;}});
    return;
  }
  if (!shootingStarsNightActive){
    shootingStarsNightActive=true;
    nextShootingStarAt=t+30+Math.random()*30;
  }
  if (t>nextShootingStarAt){
    const idle=shootingStars.find(star=>!star.active);
    if (idle){launchShootingStar(idle,t);nextShootingStarAt=Infinity;}
  }
  shootingStars.forEach(star=>{
    if (!star.active) return;
    star.age+=dt;
    star.group.position.addScaledVector(star.velocity,dt);
    star.group.rotation.z=Math.atan2(star.velocity.y,star.velocity.x);
    const fade=Math.min(1,star.age/.32,(star.duration-star.age)/.72)*Math.max(0,nightFactor);
    star.trailMaterial.uniforms.uOpacity.value=Math.max(0,fade*.9);
    star.streakMaterial.opacity=Math.max(0,fade*.82);
    star.auraMaterial.opacity=Math.max(0,fade*.25);
    star.glowMaterial.opacity=Math.max(0,fade*.72);
    star.sparks.forEach(({sprite,phase},i)=>{
      sprite.material.opacity=Math.max(0,fade*(.12+.3*(.5+.5*Math.sin(t*10+i+phase))));
    });
    if (star.age>=star.duration){
      star.active=false;star.impactAt=t;star.group.visible=false;
      nextShootingStarAt=t+30+Math.random()*30;
      showMeteorWishHint();
    }
  });
}
function beginMeteorCameraFocus(star,t){
  if (cameraFollow){pendingMeteorFocus=star;return;}
  meteorCameraFocus={
    star,phase:'track',phaseStart:t,startTarget:controls.target.clone(),
    startCamPos:camera.position.clone(),impactTarget:star.group.position.clone(),returnTarget:null
  };
  controls.enabled=false;controls.autoRotate=false;
}
function updateMeteorCameraFocus(t){
  if (!meteorCameraFocus&&pendingMeteorFocus&&!cameraFollow){
    const star=pendingMeteorFocus;pendingMeteorFocus=null;
    beginMeteorCameraFocus(star,t);
  }
  if (!meteorCameraFocus)return false;
  const focus=meteorCameraFocus,star=focus.star;
  if (focus.phase==='track'){
    if (star.active){
      const progress=Math.min(1,(t-focus.phaseStart)/1.05);
      const eased=1-Math.pow(1-progress,3);
      const desired=star.group.position;
      if (progress<1)controls.target.copy(focus.startTarget).lerp(desired,eased);
      else controls.target.lerp(desired,.12);
    }else{
      focus.impactTarget=star.group.position.clone();
      focus.phase='hold';focus.phaseStart=t;
    }
  }else if(focus.phase==='hold'){
    controls.target.lerp(focus.impactTarget,.18);
    if(t-focus.phaseStart>1.35){focus.phase='return';focus.phaseStart=t;focus.returnTarget=controls.target.clone();}
  }else if(focus.phase==='return'){
    const k=Math.min(1,(t-focus.phaseStart)/1.2);
    const eased=1-Math.pow(1-k,3);
    controls.target.copy(focus.returnTarget).lerp(focus.startTarget,eased);
    camera.position.copy(focus.startCamPos);
    if(k>=1){
      controls.target.copy(focus.startTarget);controls.enabled=true;meteorCameraFocus=null;
      return false;
    }
  }
  camera.position.copy(focus.startCamPos);
  camera.lookAt(controls.target);
  return true;
}

/* ═══════════════════════════════════════════
   MOON (with refs)
   ═══════════════════════════════════════════ */
function makeMoonTexture(){
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5eed8';
  ctx.fillRect(0,0,1024,1024);
  const maria = [[320,360,150],[640,300,120],[500,550,180],[780,520,110],[250,700,100],[600,750,130],[400,180,90]];
  maria.forEach(([x,y,r]) => {
    const g = ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,'rgba(180,170,155,0.42)');
    g.addColorStop(1,'rgba(180,170,155,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  });
  for (let i=0;i<240;i++){
    const x = Math.random()*1024, y = Math.random()*1024;
    const r = 2 + Math.random()*22;
    const g = ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,'rgba(150,140,125,0.38)');
    g.addColorStop(0.6,'rgba(190,180,165,0.18)');
    g.addColorStop(1,'rgba(195,185,165,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const moon = new THREE.Mesh(
  new THREE.SphereGeometry(46, 48, 48),
  new THREE.MeshBasicMaterial({
    map: makeMoonTexture(), fog:false,
    transparent: true, opacity: 1
  })
);
moon.position.set(-420, 400, -760);
scene.add(moon);

const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex, color: 0xbccaf0, transparent:true,
  blending: THREE.AdditiveBlending, depthWrite:false, opacity: 0.18, fog:false
}));
moonGlow.scale.setScalar(360);
moonGlow.position.copy(moon.position);
scene.add(moonGlow);

/* ═══════════════════════════════════════════
   SUN (new)
   ═══════════════════════════════════════════ */
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(58, 48, 48),
  new THREE.MeshBasicMaterial({
    color: 0xfff8d8, fog: false,
    transparent: true, opacity: 1
  })
);
scene.add(sun);

const sunGlow1 = new THREE.Sprite(new THREE.SpriteMaterial({
  map: sunGlowTex, color: 0xfff4c0, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, fog: false
}));
sunGlow1.scale.setScalar(240);
scene.add(sunGlow1);

const sunGlow2 = new THREE.Sprite(new THREE.SpriteMaterial({
  map: sunGlowTex, color: 0xffd880, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, fog: false
}));
sunGlow2.scale.setScalar(480);
scene.add(sunGlow2);

const sunGlow3 = new THREE.Sprite(new THREE.SpriteMaterial({
  map: sunGlowTex, color: 0xffb050, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.24, fog: false
}));
sunGlow3.scale.setScalar(820);
scene.add(sunGlow3);

/* ═══════════════════════════════════════════
   GROUND
   ═══════════════════════════════════════════ */
const groundMat = new THREE.MeshStandardMaterial({ color:0x08091a, roughness:0.97, metalness:0.12 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 96), groundMat);
ground.rotation.x = -Math.PI/2;
ground.position.y = -0.05;
scene.add(ground);

const groundRings = [];
for (let i=0;i<4;i++){
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(70 + i*34, 71.2 + i*34, 140),
    new THREE.MeshBasicMaterial({
      color: i%2 ? 0xffb347 : 0xff8f1e,
      transparent:true, opacity: 0.07 - i*0.013,
      blending: THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide
    })
  );
  ring.rotation.x = -Math.PI/2;
  ring.position.set(0, 0.06, -70);
  scene.add(ring);
  groundRings.push(ring);
}

/* ═══════════════════════════════════════════
   EMBERS
   ═══════════════════════════════════════════ */
const embersMaterial = (() => {
  const COUNT = 140;
  const pos = new Float32Array(COUNT*3);
  const spd = new Float32Array(COUNT);
  const sz  = new Float32Array(COUNT);
  for (let i=0;i<COUNT;i++){
    pos[i*3]   = (Math.random()-0.5)*420;
    pos[i*3+1] = Math.random()*160 + 2;
    pos[i*3+2] = (Math.random()-0.5)*420 - 50;
    spd[i]     = 0.35 + Math.random()*0.75;
    sz[i]      = 0.12 + Math.random()*0.35;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('size',     new THREE.BufferAttribute(sz,1));
  g.userData.spd = spd;

  const m = new THREE.ShaderMaterial({
    uniforms:{
      uPixelRatio:{value: renderer.getPixelRatio()},
      uOpacity:{value: 1.0}
    },
    vertexShader:`attribute float size; uniform float uPixelRatio; varying float vSize;
      void main(){ vSize = size; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * 2.0 * uPixelRatio; gl_Position = projectionMatrix * mv; }`,
    fragmentShader:`varying float vSize; uniform float uOpacity;
      void main(){ vec2 uv = gl_PointCoord - 0.5; float d = length(uv);
        float a = smoothstep(0.5, 0.0, d);
        vec3 col = mix(vec3(1.0,0.68,0.28), vec3(1.0,0.92,0.7), smoothstep(0.0,0.5,d));
        gl_FragColor = vec4(col, a * 0.22 * uOpacity); }`,
    transparent:true, depthWrite:false, fog:false, blending: THREE.AdditiveBlending
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  scene.add(pts);
  scene.userData.embers = pts;
  return m;
})();

/* ═══════════════════════════════════════════
   SHWEDAGON PAGODA
   ═══════════════════════════════════════════ */
function createPagoda(){
  const g = new THREE.Group();
  const goldBright = new THREE.MeshStandardMaterial({ color: 0xffd45c, metalness: 0.98, roughness: 0.18, emissive: 0x8a5a00, emissiveIntensity: 0.5 });
  const goldMid    = new THREE.MeshStandardMaterial({ color: 0xe8b438, metalness: 0.94, roughness: 0.28, emissive: 0x5a3800, emissiveIntensity: 0.4 });
  const goldDeep   = new THREE.MeshStandardMaterial({ color: 0xba8420, metalness: 0.9,  roughness: 0.38, emissive: 0x3a2400, emissiveIntensity: 0.35 });
  const marble      = new THREE.MeshStandardMaterial({ color: 0x32324a, roughness: 0.86, metalness: 0.1 });
  const marbleLight = new THREE.MeshStandardMaterial({ color: 0x42425e, roughness: 0.82, metalness: 0.12 });
  const deepStone   = new THREE.MeshStandardMaterial({ color: 0x181828, roughness: 0.93, metalness: 0.06 });

  const baseTiers = [
    { r: 58, h: 3.5, y: 1.75, mat: deepStone },
    { r: 54, h: 3.5, y: 5.25, mat: deepStone },
    { r: 50, h: 3.5, y: 8.75, mat: marble },
    { r: 46, h: 3.2, y: 12.1, mat: marble },
    { r: 42, h: 3.0, y: 15.2, mat: marbleLight }
  ];
  baseTiers.forEach(t => {
    const oct = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r*1.015, t.h, 8), t.mat);
    oct.position.y = t.y; oct.rotation.y = Math.PI/8; g.add(oct);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(t.r, 0.28, 8, 8), goldDeep);
    trim.rotation.x = Math.PI/2; trim.rotation.z = Math.PI/8;
    trim.position.y = t.y + t.h/2; g.add(trim);
  });

  const platform = new THREE.Mesh(new THREE.CylinderGeometry(38, 40, 2.5, 72), marbleLight);
  platform.position.y = 18.45; g.add(platform);
  const platTrim = new THREE.Mesh(new THREE.TorusGeometry(38, 0.5, 10, 84), goldBright);
  platTrim.rotation.x = Math.PI/2; platTrim.position.y = 19.75; g.add(platTrim);
  const upperPlat = new THREE.Mesh(new THREE.CylinderGeometry(30, 33, 3, 64), marble);
  upperPlat.position.y = 21.2; g.add(upperPlat);

  const bellProfile = [
    [27.0,0.0],[27.5,1.2],[27.8,2.8],[27.4,5.0],[26.5,7.8],[25.3,11.0],[23.6,14.5],
    [21.5,18.2],[19.0,22.0],[16.5,25.8],[14.0,29.5],[11.6,33.0],[9.5,36.4],[7.6,39.5],
    [6.0,42.4],[4.6,45.0],[3.4,47.4],[2.4,49.5],[1.6,51.4],[1.0,53.0],[0.55,54.3],
    [0.22,55.3],[0.0,56.0]
  ].map(([r,y]) => new THREE.Vector2(r,y));
  const bell = new THREE.Mesh(new THREE.LatheGeometry(bellProfile, 96), goldBright);
  bell.position.y = 22.5; g.add(bell);

  const bands = [
    { y: 8, r: 26.8, thick: 0.55 }, { y: 18, r: 25.2, thick: 0.5 },
    { y: 28, r: 22.0, thick: 0.45 }, { y: 38, r: 17.0, thick: 0.4 },
    { y: 46, r: 12.0, thick: 0.35 }
  ];
  bands.forEach((b, i) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(b.r, b.thick, 10, 84), i%2===0 ? goldDeep : goldMid);
    band.rotation.x = Math.PI/2; band.position.y = 22.5 + b.y; g.add(band);
  });

  const ribs = 32;
  for (let i=0;i<ribs;i++){
    const a = (i/ribs) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.55, 7.5, 1.1), goldDeep);
    rib.position.set(Math.cos(a) * 27, 26, Math.sin(a) * 27);
    rib.rotation.y = -a; g.add(rib);
  }

  for (let i=0;i<8;i++){
    const a = (i/8) * Math.PI * 2 + Math.PI/8;
    const shrine = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.2, 1.2), goldDeep);
    shrine.position.set(Math.cos(a)*38.5, 20.5, Math.sin(a)*38.5);
    shrine.rotation.y = -a; g.add(shrine);
    const nl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4),
      new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent:true, opacity:0.5, side:THREE.DoubleSide }));
    nl.position.set(Math.cos(a)*39.15, 20.5, Math.sin(a)*39.15);
    nl.rotation.y = -a + Math.PI/2; g.add(nl);
  }

  const bananaBud = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 32), goldMid);
  bananaBud.scale.set(1, 2.6, 1); bananaBud.position.y = 22.5 + 56 + 8; g.add(bananaBud);
  for (let i=0;i<10;i++){
    const a = (i/10)*Math.PI*2;
    const petal = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.5, 6), goldMid);
    petal.position.set(Math.cos(a)*1.6, 22.5 + 56 + 4.5, Math.sin(a)*1.6);
    petal.rotation.z = Math.cos(a) * 0.6; petal.rotation.x = -Math.sin(a) * 0.6; g.add(petal);
  }

  const htiBaseY = 22.5 + 56 + 13;
  const htiTiers = [
    { r: 5.4, y: 0.0, h: 1.6 }, { r: 4.9, y: 1.5, h: 1.5 },
    { r: 4.4, y: 2.9, h: 1.4 }, { r: 3.9, y: 4.2, h: 1.3 },
    { r: 3.4, y: 5.4, h: 1.2 }, { r: 2.9, y: 6.5, h: 1.1 },
    { r: 2.4, y: 7.5, h: 1.0 }, { r: 1.9, y: 8.4, h: 0.9 },
    { r: 1.4, y: 9.2, h: 0.8 }, { r: 0.95,y: 9.9, h: 0.7 }
  ];
  htiTiers.forEach((t, i) => {
    const tier = new THREE.Mesh(new THREE.ConeGeometry(t.r, t.h, 32), i%2===0 ? goldBright : goldMid);
    tier.position.y = htiBaseY + t.y; g.add(tier);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(t.r * 0.98, 0.09, 6, 32), goldDeep);
    rim.rotation.x = Math.PI/2; rim.position.y = htiBaseY + t.y - t.h/2; g.add(rim);
  });

  const crownSpire = new THREE.Mesh(new THREE.ConeGeometry(0.55, 6.5, 16), goldBright);
  crownSpire.position.y = htiBaseY + 9.9 + 3.5; g.add(crownSpire);

  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(1.0),
    new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog:false }));
  orb.position.y = htiBaseY + 15.5; g.add(orb);
  const orbGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffe0a0, transparent:true,
    blending: THREE.AdditiveBlending, depthWrite:false, opacity: 0.5, fog:false
  }));
  orbGlow.scale.set(14, 14, 1); orbGlow.position.copy(orb.position); g.add(orbGlow);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffb347, transparent:true,
    blending: THREE.AdditiveBlending, depthWrite:false, opacity: 0.22, fog:false
  }));
  halo.scale.set(280, 280, 1); halo.position.set(0, 78, 0); g.add(halo);

  const bellGeo = new THREE.ConeGeometry(0.5, 1.4, 10);
  for (let i=0;i<24;i++){
    const a = (i/24) * Math.PI * 2;
    const hb = new THREE.Mesh(bellGeo, goldMid);
    hb.position.set(Math.cos(a)*36.5, 18.0, Math.sin(a)*36.5);
    hb.rotation.x = Math.PI; g.add(hb);
  }

  addOilLamps(g);
  return g;
}

function addOilLamps(pagodaGroup){
  const bowlGeo = new THREE.CylinderGeometry(0.24, 0.19, 0.16, 10);
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0xb55a2a, roughness: 0.92, metalness: 0.05, emissive: 0x3a1200, emissiveIntensity: 0.25 });
  const rimGeo  = new THREE.TorusGeometry(0.24, 0.035, 6, 12);
  const rimMat  = new THREE.MeshStandardMaterial({ color: 0xd88a4a, roughness: 0.88, metalness: 0.08, emissive: 0x501a00, emissiveIntensity: 0.3 });
  const wickGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.12, 5);
  const wickMat = new THREE.MeshBasicMaterial({ color: 0x22160a });
  const makeFlameMat = () => new THREE.SpriteMaterial({
    map: candleGlowTex, color: 0xffb850, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9
  });
  const flameMats = [];
  const rings = [
    { r: 55.2, y: 3.62,  count: 40 }, { r: 51.2, y: 7.12,  count: 36 },
    { r: 47.2, y: 10.62, count: 30 }, { r: 43.4, y: 13.82, count: 26 },
    { r: 39.4, y: 16.82, count: 22 }, { r: 36.4, y: 19.85, count: 20 }
  ];
  rings.forEach(ring => {
    const flameMat = makeFlameMat();
    flameMats.push(flameMat);
    for (let i=0;i<ring.count;i++){
      const a = (i/ring.count) * Math.PI * 2;
      const jr = ring.r + (Math.random()-0.5)*0.55;
      const x = Math.cos(a) * jr, z = Math.sin(a) * jr, y = ring.y;
      const bowl = new THREE.Mesh(bowlGeo, bowlMat);
      bowl.position.set(x, y + 0.08, z); bowl.rotation.y = Math.random()*Math.PI; pagodaGroup.add(bowl);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.x = Math.PI/2; rim.position.set(x, y + 0.16, z); pagodaGroup.add(rim);
      const wick = new THREE.Mesh(wickGeo, wickMat);
      wick.position.set(x, y + 0.20, z); pagodaGroup.add(wick);
      const flame = new THREE.Sprite(flameMat);
      const sz = 1.35 + Math.random()*0.4;
      flame.scale.set(sz, sz, 1); flame.position.set(x, y + 0.45, z); pagodaGroup.add(flame);
    }
  });
  pagodaGroup.userData.flameMats = flameMats;
}

const pagoda = createPagoda();
pagoda.position.set(0, 0, -70);
pagoda.scale.setScalar(1.0);
scene.add(pagoda);

/* ═══════════════════════════════════════════
   SCENERY
   ═══════════════════════════════════════════ */
function createBaganSilhouette(){
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x14112a, fog: true });
  if (Math.random() < 0.55){
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.6, 3, 6), mat); base.position.y = 1.5; g.add(base);
    const base2 = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5, 2.5, 6), mat); base2.position.y = 4.25; g.add(base2);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 14, 12, 0, Math.PI*2, 0, Math.PI/2), mat); dome.position.y = 5.5; g.add(dome);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.9, 14, 14), mat); spire.position.y = 13.5; g.add(spire);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.55, 4, 8), mat); tip.position.y = 22.5; g.add(tip);
  } else {
    const base = new THREE.Mesh(new THREE.BoxGeometry(9, 2.4, 9), mat); base.position.y = 1.2; g.add(base);
    const body = new THREE.Mesh(new THREE.BoxGeometry(7, 6, 7), mat); body.position.y = 5.4; g.add(body);
    const roof1 = new THREE.Mesh(new THREE.ConeGeometry(5.5, 3, 4), mat); roof1.rotation.y = Math.PI/4; roof1.position.y = 9.9; g.add(roof1);
    const roof2 = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2.5, 4), mat); roof2.rotation.y = Math.PI/4; roof2.position.y = 12.6; g.add(roof2);
    const roof3 = new THREE.Mesh(new THREE.ConeGeometry(3.3, 2, 4), mat); roof3.rotation.y = Math.PI/4; roof3.position.y = 14.9; g.add(roof3);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.5, 8), mat); top.position.y = 17.6; g.add(top);
  }
  return g;
}

function createVillage(){
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x0d0a1e, fog: true });
  const n = 2 + Math.floor(Math.random()*3);
  for (let i=0;i<n;i++){
    const hx = (Math.random()-0.5) * 14, hz = (Math.random()-0.5) * 10;
    const w = 3 + Math.random()*2, h = 2.2 + Math.random()*1.4;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(w, h, w*0.9), mat);
    hut.position.set(hx, h/2, hz); g.add(hut);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w*0.75, h*0.9, 4), mat);
    roof.rotation.y = Math.PI/4; roof.position.set(hx, h + h*0.4, hz); g.add(roof);
  }
  for (let i=0;i<2+Math.floor(Math.random()*3);i++){
    const tx = (Math.random()-0.5) * 22, tz = (Math.random()-0.5) * 16;
    const trunkH = 5 + Math.random()*4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, trunkH, 5), mat);
    trunk.position.set(tx, trunkH/2, tz); g.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.8, 6, 5), mat);
    crown.position.set(tx, trunkH + 0.8, tz); g.add(crown);
  }
  return g;
}

(function placeScenery(){
  const positions = [];
  for (let i=0;i<28;i++){
    const a = Math.random() * Math.PI * 2;
    const dist = 340 + Math.random() * 320;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist - 60;
    let tooClose = false;
    for (const p of positions){ if (Math.hypot(p.x-x, p.z-z) < 30){ tooClose = true; break; } }
    if (tooClose) continue;
    const sil = createBaganSilhouette();
    sil.position.set(x, 0, z);
    sil.rotation.y = Math.atan2(-x, -z) + (Math.random()-0.5)*0.3;
    sil.scale.setScalar(0.7 + Math.random()*1.5);
    scene.add(sil);
    positions.push({ x, z });
  }
  for (let i=0;i<14;i++){
    const a = Math.random() * Math.PI * 2;
    const dist = 180 + Math.random() * 160;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist - 60;
    if (Math.hypot(x, z + 70) < 140) continue;
    const v = createVillage();
    v.position.set(x, 0, z);
    v.rotation.y = Math.random() * Math.PI * 2;
    v.scale.setScalar(0.7 + Math.random()*0.7);
    scene.add(v);
  }
})();

/* Lotuses */
function createLotus(){
  const g = new THREE.Group();
  const petalColors = [0xffc8d8, 0xffa8c0, 0xffe0ea, 0xffd8e6];
  const petalGeo = new THREE.SphereGeometry(0.55, 8, 6, 0, Math.PI*2, 0, Math.PI*0.4);
  for (let i=0;i<8;i++){
    const a = (i/8) * Math.PI * 2;
    const petal = new THREE.Mesh(petalGeo,
      new THREE.MeshStandardMaterial({ color: petalColors[i%4], roughness: 0.75, side: THREE.DoubleSide, emissive: 0x442030, emissiveIntensity: 0.2 }));
    petal.scale.set(1, 0.5, 0.55); petal.rotation.z = Math.PI * 0.42; petal.rotation.y = a;
    petal.position.set(Math.cos(a)*0.35, 0.08, Math.sin(a)*0.35); g.add(petal);
  }
  for (let i=0;i<5;i++){
    const a = (i/5) * Math.PI * 2 + 0.3;
    const petal = new THREE.Mesh(petalGeo,
      new THREE.MeshStandardMaterial({ color: 0xfff0f5, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x553040, emissiveIntensity: 0.3 }));
    petal.scale.set(0.7, 0.6, 0.5); petal.rotation.z = Math.PI * 0.35; petal.rotation.y = a;
    petal.position.set(Math.cos(a)*0.18, 0.18, Math.sin(a)*0.18); g.add(petal);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.6, emissive: 0x503000, emissiveIntensity: 0.5 }));
  center.position.y = 0.22; g.add(center);
  return g;
}

(function placeLotus(){
  for (let i=0;i<42;i++){
    const a = Math.random() * Math.PI * 2;
    const r = 92 + Math.random() * 240;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 40;
    if (Math.hypot(x, z + 70) < 80) continue;
    const lotus = createLotus();
    lotus.position.set(x, 0.14, z);
    lotus.rotation.y = Math.random() * Math.PI * 2;
    lotus.scale.setScalar(0.9 + Math.random() * 0.8);
    scene.add(lotus);
  }
})();

/* Small stupas */
function createSmallStupa(){
  const g = new THREE.Group();
  const gold    = new THREE.MeshStandardMaterial({ color: 0xe0b038, metalness:0.88, roughness:0.34, emissive:0x40280a, emissiveIntensity:0.4 });
  const goldDim = new THREE.MeshStandardMaterial({ color: 0xa87a1e, metalness:0.85, roughness:0.42, emissive:0x2a1a00, emissiveIntensity:0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7.5, 2.5, 8), goldDim); base.position.y = 1.25; g.add(base);
  const base2 = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 6.5, 2, 8), goldDim); base2.position.y = 3.5; g.add(base2);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 24, 18, 0, Math.PI*2, 0, Math.PI/2), gold); dome.position.y = 4.5; g.add(dome);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(4.4, 11, 28), gold); cone.position.y = 13.5; g.add(cone);
  const bud = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 16), goldDim); bud.scale.set(1,2.2,1); bud.position.y = 20.3; g.add(bud);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.6, 5, 12), gold); tip.position.y = 24.5; g.add(tip);
  return g;
}
for (let i=0;i<16;i++){
  const a = (i/16)*Math.PI*2 + 0.42;
  const r = 110 + Math.random()*85;
  const s = createSmallStupa();
  s.position.set(Math.cos(a)*r, 0, Math.sin(a)*r - 40);
  s.scale.setScalar(0.5 + Math.random()*0.6);
  scene.add(s);
}

/* ═══════════════════════════════════════════
   AUDIO
   ═══════════════════════════════════════════ */
let audioCtx = null;
let soundEnabled = true;
let ambientTimer = null;
function initAudio(){
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
}
function playBell(frequency = 220, duration = 3.5, volume = 0.13){
  if (!audioCtx || !soundEnabled) return;
  const now = audioCtx.currentTime;
  const partials = [
    { f: 1.00, g: 1.00 }, { f: 1.49, g: 0.55 }, { f: 2.10, g: 0.42 },
    { f: 2.82, g: 0.28 }, { f: 3.65, g: 0.18 }, { f: 4.48, g: 0.11 }
  ];
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(volume, now + 0.008);
  master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  master.connect(audioCtx.destination);
  partials.forEach(p => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = frequency * p.f;
    osc.detune.value = (Math.random() - 0.5) * 6;
    const g = audioCtx.createGain(); g.gain.value = p.g;
    osc.connect(g); g.connect(master);
    osc.start(now); osc.stop(now + duration);
  });
}
function playAmbientWind(){
  if (!audioCtx || !soundEnabled) return;
  const now = audioCtx.currentTime;
  const dur = 12;
  const bufSize = 2 * audioCtx.sampleRate;
  const buffer = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i=0;i<bufSize;i++){ const w = Math.random()*2-1; last = (last + 0.02*w)/1.02; data[i] = last*3.5; }
  const src = audioCtx.createBufferSource(); src.buffer = buffer; src.loop = true;
  const filter = audioCtx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=340; filter.Q.value=0.6;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.035, now + 3);
  gain.gain.linearRampToValueAtTime(0.035, now + dur - 3);
  gain.gain.linearRampToValueAtTime(0, now + dur);
  src.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
  src.start(now); src.stop(now + dur);
}
function scheduleAmbientBell(){
  if (ambientTimer) clearTimeout(ambientTimer);
  const delay = 14000 + Math.random() * 22000;
  ambientTimer = setTimeout(() => {
    if (soundEnabled && audioCtx){
      playBell(180 + Math.random()*80, 4 + Math.random()*2, 0.075);
      if (Math.random() < 0.4) playAmbientWind();
    }
    scheduleAmbientBell();
  }, delay);
}

/* ═══════════════════════════════════════════
   PREFS + STORAGE
   ═══════════════════════════════════════════ */
const prefs = {
  color: 0xff9028, shape: 'classic', size: 1.15, font: '', dedicate: '', season: 'thadingyut', offerings: []
};
try {
  const saved = localStorage.getItem('thadingyut_prefs_v2');
  if (saved) Object.assign(prefs, JSON.parse(saved));
} catch(e){}
const MAX_OFFERINGS = 160;
prefs.offerings = Array.isArray(prefs.offerings)
  ? prefs.offerings.filter(item => item && item.position && Number.isFinite(item.position.x) && Number.isFinite(item.position.y) && Number.isFinite(item.position.z)).slice(-MAX_OFFERINGS)
  : [];
function savePrefs(){
  try {
    if (prefs.offerings.length > MAX_OFFERINGS) prefs.offerings = prefs.offerings.slice(-MAX_OFFERINGS);
    localStorage.setItem('thadingyut_prefs_v2', JSON.stringify(prefs));
    announceCloudChange();
  } catch(e){}
}

let userWishes = [];
try {
  const raw = localStorage.getItem('thadingyut_wishes_v2');
  if (raw) userWishes = JSON.parse(raw) || [];
} catch(e){ userWishes = []; }
function saveWishes(){
  try {
    if (userWishes.length > 40) userWishes = userWishes.slice(-40);
    localStorage.setItem('thadingyut_wishes_v2', JSON.stringify(userWishes));
    announceCloudChange();
  } catch(e){}
}
function updateStreak(){
  const today = new Date().toISOString().slice(0,10);
  let streak = { last:'', count:0, total:0 };
  try { const s = localStorage.getItem('thadingyut_streak_v2'); if (s) streak = JSON.parse(s); } catch(e){}
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
  if (streak.last === today){}
  else if (streak.last === yesterday){ streak.count = (streak.count||0) + 1; streak.last = today; }
  else { streak.count = 1; streak.last = today; }
  streak.total = (streak.total||0) + 1;
  try { localStorage.setItem('thadingyut_streak_v2', JSON.stringify(streak)); } catch(e){}
  announceCloudChange();
  return streak;
}
function getStreak(){
  try { const s = localStorage.getItem('thadingyut_streak_v2'); if (s) return JSON.parse(s); } catch(e){}
  return { last:'', count:0, total:0 };
}

/* Oil lamps placed by visitors are persisted with the existing cloud-synced preferences. */
const OFFERING_RINGS = [
  { radius: 55.2, y: 3.62 }, { radius: 51.2, y: 7.12 }, { radius: 47.2, y: 10.62 },
  { radius: 43.4, y: 13.82 }, { radius: 39.4, y: 16.82 }, { radius: 36.4, y: 19.85 }
];
const offeringLamps = [];
function getOfferingPosition(index){
  const ringIndex = index % OFFERING_RINGS.length;
  const ring = OFFERING_RINGS[ringIndex];
  const turn = Math.floor(index / OFFERING_RINGS.length);
  const angle = turn * 2.399963229728653 + ringIndex * .51;
  return { x: Math.cos(angle)*ring.radius, y: ring.y, z: -70 + Math.sin(angle)*ring.radius };
}
function createOfferingLamp(record, index, { unlit=false }={}){
  const position = record.position || getOfferingPosition(index);
  const group = new THREE.Group();
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0xc57a39, roughness: .38, metalness: .68, emissive: 0x5b2100, emissiveIntensity: .38 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xffd18a, roughness: .32, metalness: .72, emissive: 0x7b3800, emissiveIntensity: .28 });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.57,.42,.24,16), bowlMat);
  bowl.position.y = .12; group.add(bowl);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.52,.055,7,18), rimMat);
  rim.rotation.x = Math.PI/2; rim.position.y = .235; group.add(rim);
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.18,6), new THREE.MeshBasicMaterial({ color: 0x38210d }));
  wick.position.y = .32; group.add(wick);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(.15,12,12), new THREE.MeshBasicMaterial({ color: 0xffedb8, fog:false }));
  flame.position.y = .53; flame.scale.set(unlit?0:.8,unlit?0:1.8,unlit?0:.8); flame.visible = !unlit; group.add(flame);
  const glowMaterial = new THREE.SpriteMaterial({ map: candleGlowTex, color: 0xffb74d, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:unlit?0:.8, fog:false });
  const glow = new THREE.Sprite(glowMaterial);
  glow.position.y = .55; glow.scale.set(unlit?0:2.4,unlit?0:2.4,1); glow.visible = !unlit; group.add(glow);
  group.position.set(position.x, position.y, position.z);
  group.rotation.y = Math.atan2(position.x, position.z + 70);
  scene.add(group);
  const lamp = { group, flame, glow, phase: Math.random()*Math.PI*2, igniting:unlit, ignitionStart:null };
  offeringLamps.push(lamp);
  return lamp;
}
function disposeOfferingLamp(lamp){
  if (!lamp) return;
  scene.remove(lamp.group);
  lamp.group.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    if (object.material){
      if (object.material.map && object.material.map !== candleGlowTex) object.material.map.dispose();
      object.material.dispose();
    }
  });
}
function updateOfferingLamps(t){
  offeringLamps.forEach(lamp => {
    if (lamp.igniting && lamp.ignitionStart === null){ lamp.flame.visible=false; lamp.glow.visible=false; return; }
    const ignition = lamp.igniting ? THREE.MathUtils.clamp((t-lamp.ignitionStart)/.72,0,1) : 1;
    lamp.flame.visible = ignition > 0;
    lamp.glow.visible = ignition > 0;
    const flicker = 1 + Math.sin(t*9 + lamp.phase)*.11 + Math.sin(t*17 + lamp.phase*1.7)*.06;
    lamp.flame.scale.set(.8*flicker*ignition,1.8*flicker*ignition,.8*flicker*ignition);
    lamp.glow.scale.set(2.4*ignition,2.4*ignition,1);
    lamp.glow.material.opacity = (.68 + Math.sin(t*6 + lamp.phase)*.12)*ignition;
    if (lamp.igniting && ignition >= 1) lamp.igniting = false;
  });
}
prefs.offerings.forEach((record, index) => createOfferingLamp(record, index));
function offerOilLamp(){
  if (cameraFollow) return;
  const index = prefs.offerings.length;
  const position = getOfferingPosition(index);
  const record = { id: 'o_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), position, at: Date.now() };
  prefs.offerings.push(record);
  const lamp = createOfferingLamp(record, index, { unlit:true });
  if (prefs.offerings.length > MAX_OFFERINGS){
    prefs.offerings.shift();
    disposeOfferingLamp(offeringLamps.shift());
  }
  savePrefs();
  if (soundEnabled){ initAudio(); playBell(420,1.8,.075); }
  showToast('ဆီမီးလှူဒါန်းလိုက်ပါပြီ — စေတီတော်ဆီ လိုက်ကြည့်နေသည် 🪔');
  startCameraFollow(lamp, {
    focusOffsetY:1.05, followDistance:8, approachDur:1.45, followDur:3.0, returnDur:1.8,
    badgeText:'ဆီမီးကို မီးညှိနေသည်',
    onArrive:(t) => {
      lamp.ignitionStart = t;
      showToast('ဆီမီးတစ်တိုင် မီးတောက်လင်းလာပါပြီ 🪔');
    }
  });
}

/* ═══════════════════════════════════════════
   WISH SPRITE + LANTERN BODY
   ═══════════════════════════════════════════ */
function wrapLines(ctx, text, maxWidth, maxLines){
  const lines = []; let line = ''; let truncated = false;
  const chars = Array.from(text);
  for (let i=0;i<chars.length;i++){
    const ch = chars[i];
    if (ch === '\n'){ lines.push(line); line=''; continue; }
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0){
      const sp = line.lastIndexOf(' ');
      if (sp > line.length*0.4){ lines.push(line.slice(0, sp)); line = line.slice(sp+1) + ch; }
      else { lines.push(line); line = ch; }
      if (lines.length >= maxLines){ truncated = true; break; }
    } else line = test;
  }
  if (!truncated && line && lines.length < maxLines) lines.push(line);
  if (truncated){ let last = lines[maxLines-1]; if (last.length > 2) last = last.slice(0,-2); lines[maxLines-1] = last + '…'; }
  return lines;
}
function makeWishSprite(text, opts = {}){
  const fontSize = opts.fontSize || 40;
  const maxW = 448;
  const hue = opts.hue || 0xff9028;
  const fontFamily = opts.fontFamily || '"Noto Sans Myanmar","Padauk","Pyidaungsu",sans-serif';
  const hueColor = new THREE.Color(hue);
  const cssHue = `rgb(${Math.round(hueColor.r*255)},${Math.round(hueColor.g*255)},${Math.round(hueColor.b*255)})`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `700 ${fontSize}px ${fontFamily}`;
  ctx.font = font;
  const lines = wrapLines(ctx, text, maxW, 3);
  const lineH = fontSize * 1.55, padY = 22;
  const W = 512, H = Math.max(100, Math.ceil(lines.length * lineH + padY*2));
  canvas.width = W; canvas.height = H;
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = cssHue; ctx.shadowBlur = 24; ctx.fillStyle = '#ffe6b8';
  lines.forEach((ln,i)=> ctx.fillText(ln, W/2, padY + lineH*(i+0.5)));
  ctx.shadowColor = 'rgba(255,220,140,0.75)'; ctx.shadowBlur = 8; ctx.fillStyle = '#fff0c8';
  lines.forEach((ln,i)=> ctx.fillText(ln, W/2, padY + lineH*(i+0.5)));
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4; ctx.fillStyle = '#fff8d8';
  lines.forEach((ln,i)=> ctx.fillText(ln, W/2, padY + lineH*(i+0.5)));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent:true, depthWrite:false, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  const worldW = opts.worldWidth || 5.4;
  sprite.scale.set(worldW, worldW * H / W, 1);
  return sprite;
}
function getLanternProfile(shape){
  if (shape === 'cylinder'){
    return [
      [0.88, 0.0],[0.94, 0.15],[0.98, 0.55],[0.99, 1.10],[0.98, 1.65],
      [0.94, 2.10],[0.88, 2.45],[0.75, 2.68],[0.48, 2.80],[0.22, 2.86],[0.0, 2.90]
    ].map(([r,y]) => new THREE.Vector2(r, y - 1.45));
  }
  if (shape === 'lotus'){
    return [
      [0.75, 0.0],[0.86, 0.10],[0.98, 0.30],[1.10, 0.62],[1.15, 0.98],
      [1.14, 1.35],[1.08, 1.72],[0.98, 2.05],[0.82, 2.32],[0.62, 2.52],
      [0.38, 2.68],[0.15, 2.78],[0.0, 2.82]
    ].map(([r,y]) => new THREE.Vector2(r, y - 1.45));
  }
  return [
    [0.86, 0.00],[0.89, 0.06],[0.94, 0.20],[1.00, 0.48],
    [1.05, 0.82],[1.05, 1.20],[1.01, 1.60],[0.94, 1.96],
    [0.82, 2.26],[0.66, 2.50],[0.46, 2.68],[0.22, 2.80],[0.00, 2.85]
  ].map(([r,y]) => new THREE.Vector2(r, y - 1.45));
}
function makeLanternBody(hue, shape='classic'){
  const g = new THREE.Group();
  const warmHue = hue || 0xff9028;
  const hueColor = new THREE.Color(warmHue);
  const profile = getLanternProfile(shape);
  const paperBase = new THREE.Color(0xffe2b0);
  const paperColor = paperBase.clone().lerp(hueColor, 0.42);
  const paperMat = new THREE.MeshStandardMaterial({
    color: paperColor, emissive: hueColor, emissiveIntensity: 0.55,
    transparent: true, opacity: 0.92, side: THREE.DoubleSide,
    roughness: 0.92, metalness: 0.0, depthWrite: false
  });
  const paper = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), paperMat);
  g.add(paper);
  const ribMat = new THREE.MeshBasicMaterial({ color: 0x8a5020, transparent:true, opacity: 0.5 });
  const ribCount = shape === 'lotus' ? 16 : 12;
  for (let i=0;i<ribCount;i++){
    const a = (i/ribCount) * Math.PI * 2;
    const pts = profile.map(v => new THREE.Vector3(Math.cos(a) * v.x * 1.006, v.y, Math.sin(a) * v.x * 1.006));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.018, 4, false), ribMat);
    g.add(tube);
  }
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x9a5c28, roughness: 0.72, metalness: 0.12 });
  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.03, 6, 20), ringMat);
  topRing.rotation.x = Math.PI/2; topRing.position.y = 1.40; g.add(topRing);
  const midY = shape === 'cylinder' ? 0.85 : (shape === 'lotus' ? 0.55 : 0.51);
  const midR = shape === 'cylinder' ? 0.99 : (shape === 'lotus' ? 1.12 : 0.94);
  const midRing1 = new THREE.Mesh(new THREE.TorusGeometry(midR, 0.032, 6, 28), ringMat);
  midRing1.rotation.x = Math.PI/2; midRing1.position.y = midY; g.add(midRing1);
  const midRing2 = new THREE.Mesh(new THREE.TorusGeometry(midR + 0.02, 0.036, 6, 28), ringMat);
  midRing2.rotation.x = Math.PI/2; midRing2.position.y = midY - 0.66; g.add(midRing2);
  const botRing = new THREE.Mesh(new THREE.TorusGeometry(0.87, 0.055, 8, 28), ringMat);
  botRing.rotation.x = Math.PI/2; botRing.position.y = -1.45; g.add(botRing);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x3a2010 });
  for (let i=0;i<3;i++){
    const w = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.022, 0.022), wireMat);
    w.position.y = -1.43; w.rotation.y = (i/3) * Math.PI; g.add(w);
  }
  const fuel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.16, 12),
    new THREE.MeshStandardMaterial({ color: 0xe8d8b8, roughness: 0.9, emissive: 0x331800, emissiveIntensity: 0.2 }));
  fuel.position.y = -1.36; g.add(fuel);
  const flameCore = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe8b8, fog: false }));
  flameCore.position.y = -1.18; flameCore.scale.set(1, 1.7, 1); g.add(flameCore);
  const flameOuter = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff8030, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  flameOuter.position.y = -1.05; flameOuter.scale.set(1, 1.9, 1); g.add(flameOuter);
  const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: hueColor, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.4 }));
  innerGlow.scale.set(3.6, 3.6, 1); innerGlow.position.y = -0.25; g.add(innerGlow);
  const outerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: hueColor, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.22 }));
  outerGlow.scale.set(7.5, 7.5, 1); g.add(outerGlow);
  const groundGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: hueColor, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.12 }));
  groundGlow.scale.set(3.5, 1.4, 1); groundGlow.position.y = -2.6; g.add(groundGlow);
  g.userData.flameCore = flameCore; g.userData.flameOuter = flameOuter;
  g.userData.innerGlow = innerGlow; g.userData.outerGlow = outerGlow;
  g.userData.hue = warmHue;
  return g;
}

/* Smoke trail */
const SMOKE_PER_LANTERN = 10;
function createSmokeTrail(){
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(SMOKE_PER_LANTERN * 3);
  const aOpacity = new Float32Array(SMOKE_PER_LANTERN);
  const aSize = new Float32Array(SMOKE_PER_LANTERN);
  for (let i=0;i<SMOKE_PER_LANTERN;i++){
    pos[i*3] = 0; pos[i*3+1] = 0; pos[i*3+2] = 0;
    aOpacity[i] = 0; aSize[i] = 0.3 + Math.random()*0.4;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aOpacity', new THREE.BufferAttribute(aOpacity, 1));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(aSize, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: smokeTex }, uPixelRatio: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float aOpacity; attribute float aSize;
      varying float vOpacity; uniform float uPixelRatio;
      void main(){
        vOpacity = aOpacity;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * 22.0 * uPixelRatio * (30.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTex; varying float vOpacity;
      void main(){
        vec4 t = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(t.rgb, t.a * vOpacity);
      }
    `,
    transparent: true, depthWrite: false, fog: false, blending: THREE.NormalBlending
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points, geo,
    particles: new Array(SMOKE_PER_LANTERN).fill(null).map(() => ({ life: 0, maxLife: 0, x:0, y:0, z:0, vx:0, vy:0, vz:0 })),
    nextIdx: 0, lastEmit: 0
  };
}
function updateSmoke(trail, lanternPos, dt, t){
  if (t - trail.lastEmit > 0.16){
    trail.lastEmit = t;
    const p = trail.particles[trail.nextIdx];
    p.life = 0; p.maxLife = 2.2 + Math.random() * 1.0;
    p.x = lanternPos.x + (Math.random()-0.5) * 0.35;
    p.y = lanternPos.y - 1.9;
    p.z = lanternPos.z + (Math.random()-0.5) * 0.35;
    p.vx = (Math.random()-0.5) * 0.35;
    p.vy = 0.6 + Math.random() * 0.4;
    p.vz = (Math.random()-0.5) * 0.35;
    trail.nextIdx = (trail.nextIdx + 1) % SMOKE_PER_LANTERN;
  }
  const posAttr = trail.geo.attributes.position;
  const opAttr  = trail.geo.attributes.aOpacity;
  for (let i=0;i<SMOKE_PER_LANTERN;i++){
    const p = trail.particles[i];
    if (p.maxLife > 0){
      p.life += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.985; p.vz *= 0.985; p.vy *= 0.99;
      if (p.life / p.maxLife >= 1) p.maxLife = 0;
    }
    const visible = p.maxLife > 0;
    posAttr.setXYZ(i, p.x, p.y, p.z);
    opAttr.setX(i, visible ? (1 - p.life/p.maxLife) * 0.55 : 0);
  }
  posAttr.needsUpdate = true;
  opAttr.needsUpdate = true;
}

/* ═══════════════════════════════════════════
   LANTERN SYSTEM
   ═══════════════════════════════════════════ */
const AMBIENT_WISHES = [
  'မိဘနှစ်ပါး ကျန်းမာပါစေ','စိတ်ဆန္ဒ ပြည့်ဝပါစေ','အောင်မြင်ပါစေ',
  'ချစ်သူနှင့် အမြဲပေါင်းဖက်ရပါစေ','ပညာရေး ထူးချွန်ပါစေ','ဘေးကင်းလုံခြုံပါစေ',
  'ကုသိုလ်ကောင်းမှု အမြဲပြုနိုင်ပါစေ','နိုင်ငံတော် ငြိမ်းချမ်းပါစေ','ဒုက္ခရောက်သူများ ကယ်တင်ခံရပါစေ',
  'စီးပွားရေး အဆင်ပြေပါစေ','မိသားစု ချမ်းသာပါစေ','အိပ်မက်များ အကောင်အထည်ပေါ်ပါစေ',
  'ကျန်းမာရေး ကောင်းမွန်ပါစေ','အလုပ်အကိုင် အခွင့်အလမ်းများ ရပါစေ','ရေဘေး မီးဘေး ကင်းဝေးပါစေ',
  'ချစ်ခြင်းမေတ္တာ ကြီးထွားပါစေ','စိတ်ချမ်းသာ ကိုယ်ကျန်းမာပါစေ','ဆရာသမား ကျေးဇူးဆပ်နိုင်ပါစေ',
  'အခက်အခဲများ ကျော်လွှားနိုင်ပါစေ','မေတ္တာတရား ပြန့်ပွားပါစေ'
];
let lanterns = [];
const MAX_LANTERNS = 46;
const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();
const countEl = document.getElementById('count');

let lanternPhysicsWorker = null;
let lanternPhysicsWorkerReady = false;
let lanternPhysicsWorkerEnabled = false;
let lanternPhysicsWorkerBusy = false;
let lanternPhysicsFrameId = 0;
let lanternPhysicsPendingDt = 0;
let nextLanternPhysicsId = 1;
const lanternsByPhysicsId = new Map();
function getLanternPhysicsState(lantern){
  return {
    id:lantern.physicsId, age:lantern.age,
    x:lantern.group.position.x, y:lantern.group.position.y, z:lantern.group.position.z,
    baseX:lantern.baseX, baseZ:lantern.baseZ, maxSpeed:lantern.maxSpeed,
    swayAmp:lantern.swayAmp, swayFreq:lantern.swayFreq, phase:lantern.phase,
    baseScale:lantern.baseScale, rotationX:lantern.group.rotation.x, rotationZ:lantern.group.rotation.z
  };
}
function stopLanternPhysicsWorker(error){
  if (error) console.warn('Lantern physics worker unavailable; using main-thread physics.',error.message||error);
  if (lanternPhysicsWorker) lanternPhysicsWorker.terminate();
  lanternPhysicsWorker=null; lanternPhysicsWorkerReady=false; lanternPhysicsWorkerEnabled=false;
  lanternPhysicsWorkerBusy=false; lanternPhysicsPendingDt=0; lanternsByPhysicsId.clear();
}
function initLanternPhysicsWorker(){
  if (!('Worker' in window)) return;
  try{
    lanternPhysicsWorker=new Worker(new URL('./lantern-physics.worker.js',import.meta.url),{type:'module'});
    lanternPhysicsWorker.onmessage=(event)=>{
      const message=event.data;
      if (!message)return;
      if (message.type==='ready'){
        lanternPhysicsWorkerReady=true;
        lanterns.forEach(lantern=>{
          if (lantern.physicsId!==undefined) lanternPhysicsWorker.postMessage({type:'add',state:getLanternPhysicsState(lantern)});
        });
        lanternPhysicsWorkerEnabled=true;
        return;
      }
      if (message.type!=='frame')return;
      lanternPhysicsWorkerBusy=false;
      const states=new Float32Array(message.buffer);
      for(let i=0;i+10<states.length;i+=11){
        const lantern=lanternsByPhysicsId.get(states[i]|0);
        if(!lantern)continue;
        lantern.age=states[i+1];
        lantern.group.position.set(states[i+2],states[i+3],states[i+4]);
        lantern.group.rotation.x=states[i+5];
        lantern.group.rotation.z=states[i+6];
        lantern.group.scale.setScalar(states[i+7]);
        lantern.baseX=states[i+8]; lantern.baseZ=states[i+9]; lantern.phase=states[i+10];
      }
    };
    lanternPhysicsWorker.onerror=(event)=>stopLanternPhysicsWorker(event.message||event);
  }catch(error){stopLanternPhysicsWorker(error);}
}
function registerLanternPhysics(lantern){
  if(!lanternPhysicsWorker)return;
  lantern.physicsId=nextLanternPhysicsId++;
  lanternsByPhysicsId.set(lantern.physicsId,lantern);
  try{lanternPhysicsWorker.postMessage({type:'add',state:getLanternPhysicsState(lantern)});}
  catch(error){stopLanternPhysicsWorker(error);}
}
function unregisterLanternPhysics(lantern){
  if(lantern.physicsId===undefined)return;
  lanternsByPhysicsId.delete(lantern.physicsId);
  if(lanternPhysicsWorker){
    try{lanternPhysicsWorker.postMessage({type:'remove',id:lantern.physicsId});}catch(error){stopLanternPhysicsWorker(error);}
  }
}
function tickLanternPhysicsWorker(dt,t){
  if(!lanternPhysicsWorkerEnabled||!lanternPhysicsWorkerReady||!lanternPhysicsWorker)return;
  lanternPhysicsPendingDt=Math.min(.12,lanternPhysicsPendingDt+dt);
  if(lanternPhysicsWorkerBusy)return;
  const stepDt=lanternPhysicsPendingDt;
  lanternPhysicsPendingDt=0;
  lanternPhysicsWorkerBusy=true;
  try{
    lanternPhysicsWorker.postMessage({
      type:'tick',frameId:++lanternPhysicsFrameId,dt:stepDt,t,
      wind:{strength:wind.strength,dirX:wind.dirX,dirZ:wind.dirZ},
      suspendRecycle:!!cameraFollow
    });
  }catch(error){stopLanternPhysicsWorker(error);}
}
initLanternPhysicsWorker();

function randomSkyPosition(){
  let x = 0, z = 0;
  for (let i=0;i<16;i++){
    const a = Math.random()*Math.PI*2;
    const r = 40 + Math.random()*150;
    x = Math.cos(a)*r; z = Math.sin(a)*r;
    if (Math.hypot(x, z + 70) > 75) break;
  }
  return { x, z };
}
function getUserLaunchPosition(){
  const angle = Math.random() * Math.PI * 2;
  const r = 8 + Math.random() * 12;
  return { x: Math.cos(angle) * r, z: 26 + Math.sin(angle) * r * 0.5 };
}
function getRestoredWishPosition(wish, index){
  const saved = wish.position;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.z)){
    return {
      x: THREE.MathUtils.clamp(saved.x, -30, 30),
      z: THREE.MathUtils.clamp(saved.z, 12, 42)
    };
  }
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const radius = 8 + (index % 4) * 3;
  return {
    x: Math.cos(angle) * radius,
    z: 27 + Math.sin(angle) * radius * 0.45
  };
}
function spawnLantern(wish, opts = {}){
  const group = new THREE.Group();
  const hue = opts.hue || SEASONS[prefs.season].hues[Math.floor(Math.random()*SEASONS[prefs.season].hues.length)];
  const shape = opts.shape || (opts.isUser ? prefs.shape : ['classic','cylinder','lotus'][Math.floor(Math.random()*3)]);
  const body = makeLanternBody(hue, shape);
  group.add(body);
  let brightness = 0.55;
  if (wish){
    const positive = (wish.match(/ပါစေ|ချမ်းသာ|အောင်|ပြည့်|ကြီး/g) || []).length;
    brightness = 0.5 + Math.min(0.3, positive * 0.06) + Math.min(0.2, wish.length * 0.003);
    body.userData.innerGlow.material.opacity = 0.4 * (0.8 + brightness * 0.5);
  }
  let label = null;
  if (wish){
    label = makeWishSprite(wish, {
      fontSize: opts.isUser ? 42 : 38,
      worldWidth: opts.isUser ? 6.4 : 5.2,
      hue,
      fontFamily: prefs.font ? `'${prefs.font==='font-padauk'?'Padauk':'Pyidaungsu'}','Noto Sans Myanmar',sans-serif` : null
    });
    label.position.y = -3.4;
    group.add(label);
  }
  const pos = opts.position || randomSkyPosition();
  const startY = opts.startY !== undefined ? opts.startY : (10 + Math.random()*180);
  group.position.set(pos.x, startY, pos.z);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 12), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hit);
  const smokeTrail = createSmokeTrail();
  scene.add(smokeTrail.points);
  const lantern = {
    group, body, label, hit, smokeTrail,
    wish: wish || '', hue, shape,
    dedication: opts.dedication || '', blessings: 0, brightness,
    baseX: pos.x, baseZ: pos.z,
    age: opts.age || 0,
    maxSpeed: opts.maxSpeed || (2.4 + Math.random()*1.8),
    swayAmp: 1.6 + Math.random()*2.4, swayFreq: 0.32 + Math.random()*0.38,
    phase: Math.random()*Math.PI*2,
    baseScale: opts.baseScale || (0.9 + Math.random()*0.35),
    labelOpacity: opts.isUser ? 1.0 : 0.78,
    isUser: !!opts.isUser,
    createdAt: Date.now()
  };
  lantern.group.scale.setScalar(lantern.baseScale * (opts.age ? 1 : 0.05));
  group.userData.lantern = lantern;
  scene.add(group);
  lanterns.push(lantern);
  registerLanternPhysics(lantern);
  while (lanterns.length > MAX_LANTERNS){ const old = lanterns.shift(); disposeLantern(old); }
  updateCounter();
  return lantern;
}
function disposeLantern(l){
  unregisterLanternPhysics(l);
  scene.remove(l.group);
  if (l.smokeTrail){ scene.remove(l.smokeTrail.points); l.smokeTrail.geo.dispose(); l.smokeTrail.points.material.dispose(); }
  l.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material){
      if (o.material.map && o.material.map !== glowTex && o.material.map !== candleGlowTex && o.material.map !== smokeTex)
        o.material.map.dispose();
      o.material.dispose();
    }
  });
}
function updateCounter(){ countEl.textContent = lanterns.length; }

/* One rising shell per letter; each burst forms a glyph, then the full phrase rains down. */
const FIREWORK_PARTICLES_PER_LETTER=52;
const FIREWORK_BURST_SPARKS_PER_LETTER=40;
const FIREWORK_LAUNCH_INTERVAL=.42;
const MAX_ACTIVE_FIREWORKS=2;
const activeFireworks=[];
const fireworkSparkTex=(()=>{
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
  const ctx=canvas.getContext('2d');
  const gradient=ctx.createRadialGradient(48,48,0,48,48,48);
  gradient.addColorStop(0,'rgba(255,255,255,1)');
  gradient.addColorStop(.22,'rgba(255,255,255,.92)');
  gradient.addColorStop(.58,'rgba(255,255,255,.24)');
  gradient.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,96,96);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
})();
function makeFireworkLetterLayouts(particlesPerLetter,worldWidth){
  const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=600;
  const ctx=canvas.getContext('2d');
  const words=[{text:'HAPPY',y:180},{text:'THADINGYUT',y:420}];
  const trackingFor=size=>size*.04;
  let fontSize=240;
  ctx.textBaseline='middle';ctx.textAlign='left';
  const lineWidth=(word,size)=>{
    ctx.font=`900 ${size}px Arial, sans-serif`;
    const chars=Array.from(word);
    return chars.reduce((sum,char)=>sum+ctx.measureText(char).width,0)+trackingFor(size)*Math.max(0,chars.length-1);
  };
  while(Math.max(...words.map(row=>lineWidth(row.text,fontSize)))>canvas.width-160&&fontSize>100)fontSize-=4;
  ctx.font=`900 ${fontSize}px Arial, sans-serif`;
  ctx.fillStyle='#fff';ctx.lineJoin='round';ctx.lineWidth=7;ctx.strokeStyle='#fff';
  const glyphs=[];
  for(const row of words){
    const chars=Array.from(row.text),tracking=trackingFor(fontSize);
    const total=chars.reduce((sum,char)=>sum+ctx.measureText(char).width,0)+tracking*Math.max(0,chars.length-1);
    let x=(canvas.width-total)/2;
    for(const char of chars){
      const width=ctx.measureText(char).width;
      const glyph={char,left:x-5,right:x+width+5,centerX:x+width/2,centerY:row.y};
      ctx.fillText(char,x,row.y);ctx.strokeText(char,x,row.y);
      glyphs.push(glyph);x+=width+tracking;
    }
  }
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const worldHeight=worldWidth*canvas.height/canvas.width;
  const colors=[0xffd36e,0x86e5ff,0xff83b5,0xbca0ff,0xffa94f,0xffedbd];
  return glyphs.map((glyph,index)=>{
    const candidates=[];
    const y0=Math.max(12,glyph.centerY-fontSize*.62),y1=Math.min(canvas.height-12,glyph.centerY+fontSize*.62);
    for(let y=y0;y<y1;y+=4){
      for(let x=Math.max(8,glyph.left);x<Math.min(canvas.width-8,glyph.right);x+=4){
        if(pixels[(Math.floor(y)*canvas.width+Math.floor(x))*4+3]>100)candidates.push([x,y]);
      }
    }
    if(!candidates.length)candidates.push([glyph.centerX,glyph.centerY]);
    const targets=new Float32Array(particlesPerLetter*3);
    for(let i=0;i<particlesPerLetter;i++){
      const [x,y]=candidates[Math.floor(Math.random()*candidates.length)];
      targets[i*3]=(x/canvas.width-.5)*worldWidth;
      targets[i*3+1]=(.5-y/canvas.height)*worldHeight;
    }
    return {
      char:glyph.char,centerX:(glyph.centerX/canvas.width-.5)*worldWidth,
      centerY:(.5-glyph.centerY/canvas.height)*worldHeight,
      targets,color:colors[index%colors.length],phase:'waiting',elapsed:0,mesh:null,flash:null
    };
  });
}
function disposeFirework(firework){
  if(!firework)return;
  scene.remove(firework.group);
  firework.group.traverse(object=>{
    if(object.geometry)object.geometry.dispose();
    if(object.material){
      if(object.material.map&&object.material.map!==glowTex&&object.material.map!==fireworkSparkTex)object.material.map.dispose();
      object.material.dispose();
    }
  });
}
function createFireworkSequence(){
  while(activeFireworks.length>=MAX_ACTIVE_FIREWORKS)disposeFirework(activeFireworks.shift());
  const group=new THREE.Group();
  const worldWidth=THREE.MathUtils.clamp(camera.aspect*55,52,98);
  group.position.set((Math.random()-.5)*5,131+Math.random()*3,-70);
  const letters=makeFireworkLetterLayouts(FIREWORK_PARTICLES_PER_LETTER,worldWidth);
  for(const letter of letters){
    const positions=new Float32Array(FIREWORK_PARTICLES_PER_LETTER*3);
    const colors=new Float32Array(FIREWORK_PARTICLES_PER_LETTER*3);
    const paletteColor=new THREE.Color(letter.color),white=new THREE.Color(0xfff6dc);
    for(let i=0;i<FIREWORK_PARTICLES_PER_LETTER;i++){
      const color=paletteColor.clone().lerp(white,Math.random()*.42);
      colors.set([color.r,color.g,color.b],i*3);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const material=new THREE.PointsMaterial({
      map:fireworkSparkTex,size:2.2,sizeAttenuation:true,vertexColors:true,transparent:true,opacity:0,
      blending:THREE.AdditiveBlending,depthWrite:false,alphaTest:.025
    });
    const mesh=new THREE.Points(geometry,material);mesh.visible=false;mesh.frustumCulled=false;group.add(mesh);
    const flashMaterial=new THREE.SpriteMaterial({
      map:glowTex,color:letter.color,transparent:true,opacity:0,
      blending:THREE.AdditiveBlending,depthWrite:false,fog:false
    });
    const flash=new THREE.Sprite(flashMaterial);
    flash.position.set(letter.centerX,letter.centerY,.08);flash.scale.set(4,4,1);flash.visible=false;group.add(flash);
    const burstPositions=new Float32Array(FIREWORK_BURST_SPARKS_PER_LETTER*3);
    const burstColors=new Float32Array(FIREWORK_BURST_SPARKS_PER_LETTER*3);
    const burstBase=new THREE.Color(letter.color),burstWhite=new THREE.Color(0xfff8e6);
    for(let i=0;i<FIREWORK_BURST_SPARKS_PER_LETTER;i++){
      const c=burstBase.clone().lerp(burstWhite,Math.random()*.5);burstColors.set([c.r,c.g,c.b],i*3);
    }
    const burstGeometry=new THREE.BufferGeometry();
    burstGeometry.setAttribute('position',new THREE.BufferAttribute(burstPositions,3));
    burstGeometry.setAttribute('color',new THREE.BufferAttribute(burstColors,3));
    const burstMaterial=new THREE.PointsMaterial({map:fireworkSparkTex,size:2.0,sizeAttenuation:true,vertexColors:true,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,alphaTest:.02});
    const burstMesh=new THREE.Points(burstGeometry,burstMaterial);burstMesh.visible=false;burstMesh.frustumCulled=false;group.add(burstMesh);
    letter.mesh=mesh;letter.flash=flash;letter.positions=positions;letter.burstMesh=burstMesh;
    letter.burstPositions=burstPositions;letter.burstVelocities=new Float32Array(FIREWORK_BURST_SPARKS_PER_LETTER*3);
    letter.velocities=new Float32Array(FIREWORK_PARTICLES_PER_LETTER*3);
    letter.assemblyStarts=new Float32Array(FIREWORK_PARTICLES_PER_LETTER*3);
    letter.fallingVelocities=new Float32Array(FIREWORK_PARTICLES_PER_LETTER*3);
    letter.assemblyDelays=new Float32Array(FIREWORK_PARTICLES_PER_LETTER);
  }
  scene.add(group);
  const sequence={group,letters,age:0,nextLetter:0,rockets:[],dropAt:null};
  activeFireworks.push(sequence);
  return sequence;
}
function makeFireworkRocket(sequence,letter,index){
  const shell=new THREE.Group();
  const start=new THREE.Vector3(letter.centerX,17-sequence.group.position.y,0);
  const target=new THREE.Vector3(letter.centerX,letter.centerY,0);
  shell.position.copy(start);
  const headMaterial=new THREE.SpriteMaterial({
    map:glowTex,color:letter.color,transparent:true,opacity:1,
    blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,fog:false
  });
  const head=new THREE.Sprite(headMaterial);head.scale.set(4.8,4.8,1);shell.add(head);
  const trailCount=12;
  const trailPositions=new Float32Array(trailCount*3);
  const trailGeometry=new THREE.BufferGeometry();
  trailGeometry.setAttribute('position',new THREE.BufferAttribute(trailPositions,3));
  const trailMaterial=new THREE.LineBasicMaterial({
    color:letter.color,transparent:true,opacity:.92,
    blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false
  });
  const trail=new THREE.Line(trailGeometry,trailMaterial);trail.frustumCulled=false;shell.add(trail);
  sequence.group.add(shell);
  return {
    group:shell,head,trail,trailGeometry,trailMaterial,trailPositions,
    history:[start.clone()],start,target,letter,index,age:0,duration:1.85+Math.random()*.2
  };
}
function disposeFireworkRocket(rocket,sequence){
  sequence.group.remove(rocket.group);
  rocket.trailGeometry.dispose();rocket.trailMaterial.dispose();rocket.head.material.dispose();
}
function launchFireworkLetter(sequence,index){
  const letter=sequence.letters[index];
  const rocket=makeFireworkRocket(sequence,letter,index);
  letter.phase='rocket';letter.rocket=rocket;
  sequence.rockets.push(rocket);
}
function burstLetter(letter){
  letter.phase='burst';letter.elapsed=0;letter.mesh.visible=true;letter.mesh.material.opacity=.95;
  letter.flash.visible=true;letter.flash.material.opacity=.95;letter.flash.scale.set(3,3,1);
  letter.burstMesh.visible=true;letter.burstMesh.material.opacity=1;
  for(let i=0;i<FIREWORK_BURST_SPARKS_PER_LETTER;i++){
    const n=i*3,azimuth=Math.random()*Math.PI*2,vertical=Math.random()*2-1;
    const horizontal=Math.sqrt(1-vertical*vertical),speed=30+Math.random()*26;
    letter.burstPositions[n]=letter.centerX;letter.burstPositions[n+1]=letter.centerY;letter.burstPositions[n+2]=0;
    letter.burstVelocities[n]=Math.cos(azimuth)*horizontal*speed;
    letter.burstVelocities[n+1]=vertical*speed;letter.burstVelocities[n+2]=Math.sin(azimuth)*horizontal*speed;
  }
  letter.burstMesh.geometry.attributes.position.needsUpdate=true;
  for(let i=0;i<FIREWORK_PARTICLES_PER_LETTER;i++){
    const n=i*3,azimuth=Math.random()*Math.PI*2,vertical=Math.random()*2-1;
    const horizontal=Math.sqrt(1-vertical*vertical),speed=15+Math.random()*17;
    letter.positions[n]=letter.centerX;letter.positions[n+1]=letter.centerY;letter.positions[n+2]=0;
    letter.velocities[n]=Math.cos(azimuth)*horizontal*speed;
    letter.velocities[n+1]=vertical*speed;
    letter.velocities[n+2]=Math.sin(azimuth)*horizontal*speed;
    letter.assemblyDelays[i]=Math.random()*.16;
  }
  letter.mesh.geometry.attributes.position.needsUpdate=true;
}
function updateFireworkRocket(rocket,sequence,dt){
  rocket.age+=dt;
  const progress=Math.min(1,rocket.age/rocket.duration);
  const eased=1-Math.pow(1-progress,2);
  const current=rocket.start.clone().lerp(rocket.target,eased);
  rocket.group.position.copy(current);
  rocket.history.push(current.clone());if(rocket.history.length>12)rocket.history.shift();
  const attr=rocket.trailGeometry.attributes.position;
  for(let i=0;i<12;i++){
    const p=rocket.history[Math.max(0,rocket.history.length-12+i)];
    attr.setXYZ(i,p.x-current.x,p.y-current.y,p.z-current.z);
  }
  attr.needsUpdate=true;
  rocket.trailMaterial.opacity=.92*(1-progress*.32);
  rocket.head.material.opacity=1-progress*.28;
  if(progress>=1){burstLetter(rocket.letter);disposeFireworkRocket(rocket,sequence);return true;}
  return false;
}
function updateFireworkLetter(letter,sequence,dt){
  if(letter.phase==='waiting'||letter.phase==='rocket')return;
  letter.elapsed+=dt;
  const positions=letter.positions;
  if(letter.phase==='burst'){
    if(letter.elapsed<.32){
      for(let i=0;i<FIREWORK_PARTICLES_PER_LETTER;i++){
        const n=i*3;
        letter.velocities[n+1]-=2.4*dt;
        const drag=Math.exp(-.3*dt);
        letter.velocities[n]*=drag;letter.velocities[n+1]*=drag;letter.velocities[n+2]*=drag;
        positions[n]+=letter.velocities[n]*dt;
        positions[n+1]+=letter.velocities[n+1]*dt;
        positions[n+2]+=letter.velocities[n+2]*dt;
      }
    }else{
      letter.phase='forming';letter.assemblyStarts.set(positions);
    }
    letter.flash.material.opacity=Math.max(0,.9-letter.elapsed*2.8);
    letter.flash.scale.setScalar(3+letter.elapsed*11);
    if(letter.elapsed>.34)letter.flash.visible=false;
  }
  if(letter.phase==='forming'){
    const formingTime=letter.elapsed-.32;
    for(let i=0;i<FIREWORK_PARTICLES_PER_LETTER;i++){
      const n=i*3;
      const raw=THREE.MathUtils.clamp((formingTime-letter.assemblyDelays[i])/.52,0,1);
      const ease=raw*raw*(3-2*raw);
      positions[n]=letter.assemblyStarts[n]+(letter.targets[n]-letter.assemblyStarts[n])*ease;
      positions[n+1]=letter.assemblyStarts[n+1]+(letter.targets[n+1]-letter.assemblyStarts[n+1])*ease;
      positions[n+2]=letter.assemblyStarts[n+2]+(letter.targets[n+2]-letter.assemblyStarts[n+2])*ease;
    }
    if(formingTime>=.7){letter.phase='formed';positions.set(letter.targets);}
  }else if(letter.phase==='formed'){
    const shimmer=sequence.age*8;
    for(let i=0;i<FIREWORK_PARTICLES_PER_LETTER;i++){
      const n=i*3;
      positions[n]=letter.targets[n]+Math.sin(shimmer+i*1.7)*.05;
      positions[n+1]=letter.targets[n+1]+Math.sin(shimmer*.8+i*.73)*.06;
      positions[n+2]=letter.targets[n+2];
    }
  }else if(letter.phase==='falling'){
    for(let i=0;i<FIREWORK_PARTICLES_PER_LETTER;i++){
      const n=i*3;
      letter.fallingVelocities[n+1]-=14*dt;
      positions[n]+=letter.fallingVelocities[n]*dt;
      positions[n+1]+=letter.fallingVelocities[n+1]*dt;
      positions[n+2]+=letter.fallingVelocities[n+2]*dt;
    }
  }
  if(letter.burstMesh.visible){
    for(let i=0;i<FIREWORK_BURST_SPARKS_PER_LETTER;i++){
      const n=i*3;letter.burstVelocities[n+1]-=15*dt;
      const drag=Math.exp(-.3*dt);
      letter.burstVelocities[n]*=drag;letter.burstVelocities[n+1]*=drag;letter.burstVelocities[n+2]*=drag;
      letter.burstPositions[n]+=letter.burstVelocities[n]*dt;
      letter.burstPositions[n+1]+=letter.burstVelocities[n+1]*dt;
      letter.burstPositions[n+2]+=letter.burstVelocities[n+2]*dt;
    }
    letter.burstMesh.material.opacity=Math.max(0,1-letter.elapsed/.84);
    letter.burstMesh.geometry.attributes.position.needsUpdate=true;
    if(letter.elapsed>.84)letter.burstMesh.visible=false;
  }
  letter.mesh.geometry.attributes.position.needsUpdate=true;
}
function scheduleLanternFireworks(){
  createFireworkSequence();
}
function updateFireworks(dt){
  for(let f=activeFireworks.length-1;f>=0;f--){
    const sequence=activeFireworks[f];sequence.age+=dt;
    while(sequence.nextLetter<sequence.letters.length&&sequence.age>=sequence.nextLetter*FIREWORK_LAUNCH_INTERVAL){
      launchFireworkLetter(sequence,sequence.nextLetter++);
    }
    for(let r=sequence.rockets.length-1;r>=0;r--){
      if(updateFireworkRocket(sequence.rockets[r],sequence,dt))sequence.rockets.splice(r,1);
    }
    for(const letter of sequence.letters)updateFireworkLetter(letter,sequence,dt);
    if(sequence.dropAt===null&&sequence.letters.every(letter=>letter.phase==='formed'))sequence.dropAt=sequence.age+2.2;
    if(sequence.dropAt!==null&&sequence.age>=sequence.dropAt){
      for(const letter of sequence.letters){
        if(letter.phase==='formed'){
          letter.phase='falling';letter.assemblyStarts.set(letter.positions);
          for(let i=0;i<FIREWORK_PARTICLES_PER_LETTER;i++){
            const n=i*3;
            letter.fallingVelocities[n]=(Math.random()-.5)*4.2;
            letter.fallingVelocities[n+1]=-1-Math.random()*3.8;
            letter.fallingVelocities[n+2]=(Math.random()-.5)*3.2;
          }
        }
        if(letter.phase==='falling'){
          const fade=Math.max(0,1-(sequence.age-sequence.dropAt)/2.6);
          letter.mesh.material.opacity=.95*fade;
        }
      }
    }
    if(sequence.dropAt!==null&&sequence.age>=sequence.dropAt+2.6){
      disposeFirework(sequence);activeFireworks.splice(f,1);
    }
  }
}

for (let i=0;i<32;i++){
  const wish = AMBIENT_WISHES[Math.floor(Math.random()*AMBIENT_WISHES.length)];
  const pos = randomSkyPosition();
  spawnLantern(wish, { position: pos, startY: 8 + Math.random()*220, age: 6 + Math.random()*45 });
}

// Recreate the newest saved user lanterns when the scene is opened again.
// The scene keeps a fixed budget so older wishes beyond that budget remain in
// the wishes list, but do not push the 3D scene past its existing limit.
const restoreSlots = Math.max(0, MAX_LANTERNS - lanterns.length);
const savedWishes = Array.isArray(userWishes)
  ? userWishes.filter(wish => wish && typeof wish.text === 'string' && wish.text.trim())
  : [];
const wishesToRestore = restoreSlots ? savedWishes.slice(-restoreSlots) : [];
for (let index=0; index<wishesToRestore.length; index++){
  const wish = wishesToRestore[index];
  const pos = getRestoredWishPosition(wish, index);
  const lantern = spawnLantern(wish.text, {
    isUser: true,
    hue: wish.hue,
    shape: wish.shape,
    dedication: wish.dedication,
    position: pos,
    startY: 42 + (index % 4) * 7,
    age: 4 + (index % 3) * 2,
    maxSpeed: 6.8,
    baseScale: prefs.size
  });
  lantern.blessings = Number(wish.blessings) || 0;
}

/* ═══════════════════════════════════════════
   CAMERA FOLLOW
   ═══════════════════════════════════════════ */
let cameraFollow = null;
function startCameraFollow(lantern, options={}){
  if (meteorCameraFocus){
    if (meteorCameraFocus.star && meteorCameraFocus.star.active) pendingMeteorFocus=meteorCameraFocus.star;
    meteorCameraFocus=null;
    controls.enabled=true;
  }
  const pagodaPos = new THREE.Vector3(0, 0, -70);
  const away = new THREE.Vector3().subVectors(lantern.group.position, pagodaPos);
  away.y = 0;
  if (away.lengthSq() < 1) away.set(0, 0, 1);
  away.normalize();
  const offsetDir = new THREE.Vector3(away.x*0.85 + 0.15, -0.12, away.z*0.85 + 0.15).normalize();
  cameraFollow = {
    lantern, phase: 'approach', phaseStart: clock.elapsedTime,
    approachDur: options.approachDur ?? 1.9, followDur: options.followDur ?? 5.0, returnDur: options.returnDur ?? 2.2,
    startCamPos: camera.position.clone(), startTarget: controls.target.clone(),
    offsetDir, followDistance: options.followDistance ?? (14 + Math.random()*2),
    targetOffset: new THREE.Vector3(0, options.focusOffsetY ?? .5, 0),
    badgeText: options.badgeText || 'မီးပုံးကို လိုက်ကြည့်နေသည်',
    onArrive: options.onArrive || null, onComplete: options.onComplete || null
  };
  controls.enabled = true; controls.enableDamping = true; controls.autoRotate = false;
  controls.minDistance = 4; controls.maxDistance = 60;
  const badge = document.getElementById('followBadge');
  badge.textContent = cameraFollow.badgeText;
  badge.classList.add('show');
  document.getElementById('launchFab').classList.add('following');
  document.getElementById('offerLampFab').classList.add('following');
  launchBtn.disabled = true;
}
function finishCameraFollow(){
  const completedFollow=cameraFollow;
  cameraFollow = null;
  controls.enabled = true; controls.enableDamping = true; controls.autoRotate = false;
  controls.minDistance = 48; controls.maxDistance = 330;
  const badge = document.getElementById('followBadge');
  badge.textContent = 'မီးပုံးကို လိုက်ကြည့်နေသည်';
  badge.classList.remove('show');
  document.getElementById('launchFab').classList.remove('following');
  document.getElementById('offerLampFab').classList.remove('following');
  launchBtn.disabled = false;
  if(completedFollow&&completedFollow.onComplete)completedFollow.onComplete();
}
function updateCameraFollow(t){
  if (!cameraFollow) return false;
  const cf = cameraFollow;
  const l = cf.lantern;
  if (!l.group.parent){ finishCameraFollow(); return false; }
  const elapsed = t - cf.phaseStart;
  if (cf.phase === 'approach'){
    const k = Math.min(1, elapsed / cf.approachDur);
    const e = 1 - Math.pow(1 - k, 3);
    const desiredPos = l.group.position.clone().addScaledVector(cf.offsetDir, cf.followDistance);
    const desiredTarget = l.group.position.clone().add(cf.targetOffset);
    camera.position.copy(cf.startCamPos).lerp(desiredPos, e);
    controls.target.copy(cf.startTarget).lerp(desiredTarget, e);
    if (k >= 1){
      cf.phase = 'follow'; cf.phaseStart = t;
      if (cf.onArrive){ const onArrive = cf.onArrive; cf.onArrive = null; onArrive(t); }
    }
  } else if (cf.phase === 'follow'){
    const desiredTarget = l.group.position.clone().add(cf.targetOffset);
    const camOffset = camera.position.clone().sub(controls.target);
    controls.target.lerp(desiredTarget, 0.22);
    camera.position.copy(controls.target).add(camOffset);
    if (elapsed > cf.followDur){
      cf.phase = 'return'; cf.phaseStart = t;
      cf.returnStartCamPos = camera.position.clone();
      cf.returnStartTarget = controls.target.clone();
    }
  } else if (cf.phase === 'return'){
    const k = Math.min(1, elapsed / cf.returnDur);
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.copy(cf.returnStartCamPos).lerp(cf.startCamPos, e);
    controls.target.copy(cf.returnStartTarget).lerp(cf.startTarget, e);
    if (k >= 1){ finishCameraFollow(); return false; }
  }
  camera.lookAt(controls.target);
  return true;
}

/* ═══════════════════════════════════════════
   UI + INTERACTIONS
   ═══════════════════════════════════════════ */
const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> toastEl.classList.remove('show'), 2600);
}
let meteorToastTimer = null;
function showMeteorWishHint(){
  showToast('ကြယ်ကြွေသွားပြီ — ဆုတောင်းပါ');
  toastEl.classList.add('meteor-wish');
  clearTimeout(meteorToastTimer);
  meteorToastTimer = setTimeout(() => toastEl.classList.remove('meteor-wish'), 2600);
}

/* TIME MODAL */
const timeBackdrop = document.getElementById('timeBackdrop');
const timeBtn = document.getElementById('timeBtn');
const timeClose = document.getElementById('timeClose');
const timeIcon = document.getElementById('timeIcon');
const bigTime = document.getElementById('bigTime');
const timeLabel = document.getElementById('timeLabel');
const timePhase = document.getElementById('timePhase');
const timeSlider = document.getElementById('timeSlider');
const sliderWrap = document.getElementById('sliderWrap');
const timeHint = document.getElementById('timeHint');

timeBtn.addEventListener('click', () => {
  updateTimeUI();
  timeBackdrop.classList.add('show');
});
timeClose.addEventListener('click', () => timeBackdrop.classList.remove('show'));
timeBackdrop.addEventListener('click', (e) => { if (e.target === timeBackdrop) timeBackdrop.classList.remove('show'); });

document.querySelectorAll('.mode-btn').forEach(b => {
  if (b.dataset.mode === environment.mode) b.classList.add('active');
  else b.classList.remove('active');
  b.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(s => s.classList.remove('active'));
    b.classList.add('active');
    environment.mode = b.dataset.mode;
    saveEnv();
    if (environment.mode === 'auto'){
      sliderWrap.classList.add('hidden');
      timeHint.textContent = 'အလိုမုဒ်တွင် ဖုန်း/ကွန်ပျူတာ၏ အချိန်အလိုက် နေ/လ ရွေ့လျားပါမည်။';
    } else {
      sliderWrap.classList.remove('hidden');
      timeHint.textContent = 'slider ကို ဆွဲပြီး နေ/လ အနေအထား ရွေးချယ်ကြည့်ပါ။';
      timeSlider.value = environment.manualTime;
    }
    updateTimeUI();
    showToast(environment.mode === 'auto' ? '🕐 အလိုမုဒ်' : '✋ ကိုယ်တိုင်မုဒ်');
  });
});

timeSlider.addEventListener('input', () => {
  environment.manualTime = parseFloat(timeSlider.value);
  saveEnv();
  updateTimeUI();
});

function updateTimeUI(){
  const h = getHours();
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  bigTime.textContent = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;

  let label, phaseText, phaseClass, icon;
  if (h >= 6 && h < 12){ label = 'မနက်'; phaseText = '☀️ နေ့'; phaseClass = 'day'; icon = '☀️'; }
  else if (h >= 12 && h < 17){ label = 'မွန်းတည့်'; phaseText = '☀️ နေ့'; phaseClass = 'day'; icon = '☀️'; }
  else if (h >= 17 && h < 19){ label = 'ညနေ'; phaseText = '🌅 နေဝင်'; phaseClass = 'sunset'; icon = '🌅'; }
  else if (h >= 19 && h < 21){ label = 'ည'; phaseText = '🌙 ည'; phaseClass = 'night'; icon = '🌙'; }
  else if (h >= 21 || h < 5){ label = 'ည'; phaseText = '🌙 ည'; phaseClass = 'night'; icon = '🌙'; }
  else { label = 'မနက်'; phaseText = '🌅 နေထွက်'; phaseClass = 'sunset'; icon = '🌅'; }

  timeLabel.textContent = label;
  timePhase.textContent = phaseText;
  timePhase.className = 'time-phase ' + phaseClass;
  timeIcon.textContent = icon;

  timeBtn.textContent = icon;
  timeBtn.classList.remove('sun-active', 'moon-active');
  if (phaseClass === 'day' || phaseClass === 'sunset') timeBtn.classList.add('sun-active');
  else timeBtn.classList.add('moon-active');

  if (environment.mode === 'manual'){
    timeSlider.value = environment.manualTime;
  }
}

/* initial */
if (environment.mode === 'manual'){
  sliderWrap.classList.remove('hidden');
  document.querySelectorAll('.mode-btn').forEach(b => {
    if (b.dataset.mode === 'manual') b.classList.add('active');
    else b.classList.remove('active');
  });
}
updateTimeUI();

/* SOUND */
const soundBtn = document.getElementById('soundBtn');
soundBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundBtn.classList.toggle('muted', !soundEnabled);
  soundBtn.textContent = soundEnabled ? '🔔' : '🔕';
  if (soundEnabled){
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    playBell(220, 2, 0.06);
    scheduleAmbientBell();
  }
});

/* SEASON (now only subtitle + lantern hues) */
const seasonBtn = document.getElementById('seasonBtn');
function applySeason(key){
  prefs.season = key;
  savePrefs();
  const s = SEASONS[key];
  document.getElementById('heroTitle').textContent = s.subtitle;
  showToast(`ရာသီ ပွဲတော်: ${s.name} 🌸`);
}
seasonBtn.addEventListener('click', () => {
  const keys = Object.keys(SEASONS);
  const idx = keys.indexOf(prefs.season);
  applySeason(keys[(idx+1) % keys.length]);
});
document.getElementById('heroTitle').textContent = SEASONS[prefs.season].subtitle;

/* COMPOSE MODAL */
const composeBackdrop = document.getElementById('composeBackdrop');
const composeClose = document.getElementById('composeClose');
const launchFab = document.getElementById('launchFab');
const offerLampFab = document.getElementById('offerLampFab');
const wishInput = document.getElementById('wish');
const launchBtn = document.getElementById('launchBtn');
const charCount = document.getElementById('charCount');

function openCompose(){
  if (cameraFollow) return;
  composeBackdrop.classList.add('show');
  setTimeout(() => wishInput.focus(), 350);
}
function closeCompose(){ composeBackdrop.classList.remove('show'); }
launchFab.addEventListener('click', openCompose);
offerLampFab.addEventListener('click', offerOilLamp);
composeClose.addEventListener('click', closeCompose);
composeBackdrop.addEventListener('click', (e) => { if (e.target === composeBackdrop) closeCompose(); });

/* swatches */
const swatchContainer = document.getElementById('swatches');
(function renderSwatches(){
  const colors = ['#ff9028','#ff5866','#ff4a8c','#a06aff','#4a9eff','#40d68c','#ffd24a','#ffb040'];
  colors.forEach(hex => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.color = hex;
    b.style.setProperty('--c', hex);
    const val = parseInt(hex.replace('#',''), 16);
    if (val === prefs.color) b.classList.add('active');
    b.addEventListener('click', () => {
      swatchContainer.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      prefs.color = val;
      savePrefs();
    });
    swatchContainer.appendChild(b);
  });
})();

/* shape chips */
document.querySelectorAll('#shapeChips .opt-chip').forEach(b => {
  if (b.dataset.shape === prefs.shape) b.classList.add('active');
  else b.classList.remove('active');
  b.addEventListener('click', () => {
    document.querySelectorAll('#shapeChips .opt-chip').forEach(s => s.classList.remove('active'));
    b.classList.add('active');
    prefs.shape = b.dataset.shape; savePrefs();
  });
});
/* size chips */
document.querySelectorAll('#sizeChips .opt-chip').forEach(b => {
  if (parseFloat(b.dataset.size) === prefs.size) b.classList.add('active');
  else b.classList.remove('active');
  b.addEventListener('click', () => {
    document.querySelectorAll('#sizeChips .opt-chip').forEach(s => s.classList.remove('active'));
    b.classList.add('active');
    prefs.size = parseFloat(b.dataset.size); savePrefs();
  });
});
/* font chips */
document.querySelectorAll('#fontChips .opt-chip').forEach(b => {
  if (b.dataset.font === prefs.font) b.classList.add('active');
  else b.classList.remove('active');
  b.addEventListener('click', () => {
    document.querySelectorAll('#fontChips .opt-chip').forEach(s => s.classList.remove('active'));
    b.classList.add('active');
    prefs.font = b.dataset.font;
    document.body.classList.remove('font-padauk', 'font-pyidaungsu');
    if (prefs.font) document.body.classList.add(prefs.font);
    savePrefs();
  });
});
/* dedication */
const dedicateInput = document.getElementById('dedicateInput');
dedicateInput.value = prefs.dedicate || '';
dedicateInput.addEventListener('input', () => {
  prefs.dedicate = dedicateInput.value.trim();
  savePrefs();
});
/* char count */
wishInput.addEventListener('input', () => {
  const len = Array.from(wishInput.value).length;
  charCount.textContent = `${len} / 80`;
  charCount.classList.toggle('warn', len > 68);
});
/* init body classes */
if (prefs.font) document.body.classList.add(prefs.font);

/* LAUNCH */
function launchWish(){
  if (cameraFollow) return;
  const text = wishInput.value.trim();
  if (!text){
    wishInput.focus();
    showToast('ဆုတောင်းစာ အရင်ရေးပါ ခင်ဗျာ ✍️');
    return;
  }
  const pos = getUserLaunchPosition();
  const l = spawnLantern(text, {
    isUser: true, hue: prefs.color, shape: prefs.shape,
    dedication: prefs.dedicate,
    position: { x: pos.x, z: pos.z }, startY: 2.0, age: 0, maxSpeed: 6.8,
    baseScale: prefs.size
  });
  l.swayAmp = 3.0; l.swayFreq = 0.4;
  l.label.position.y = -3.6;
  l.brightness = Math.min(1, 0.55 + text.length * 0.005);
  userWishes.push({
    id: 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    text, hue: prefs.color, shape: prefs.shape, dedication: prefs.dedicate,
    position: { x: pos.x, z: pos.z },
    blessings: 0, at: Date.now()
  });
  saveWishes();
  updateWishesBadge();
  wishInput.value = ''; charCount.textContent = '0 / 80'; charCount.classList.remove('warn');
  wishInput.blur(); closeCompose();
  showToast('သင့်ဆုတောင်း ကောင်းကင်ပေါ် ရောက်သွားပါပြီ 🏮');
  const st = updateStreak();
  if (st.count > 1) setTimeout(() => showToast(`🔥 နေ့စဉ် streak ${st.count} ရက်`), 1800);
  if (soundEnabled){
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    playBell(240, 3.2, 0.11);
  }
  startCameraFollow(l,{onComplete:scheduleLanternFireworks});
}
launchBtn.addEventListener('click', launchWish);
wishInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); launchWish(); }
});

/* WISH CARD */
const cardBackdrop = document.getElementById('cardBackdrop');
const cardText = document.getElementById('cardText');
const cardHeight = document.getElementById('cardHeight');
const cardClose = document.getElementById('cardClose');
const cardIcon = document.getElementById('cardIcon');
const cardLanternStyle = document.getElementById('cardLanternStyle');
const cardDedicate = document.getElementById('cardDedicate');
const cardBless = document.getElementById('cardBless');
const cardBlessLabel = document.getElementById('cardBlessLabel');
const cardDownload = document.getElementById('cardDownload');
const cardShare = document.getElementById('cardShare');

let currentLantern = null;
let currentUserWishRef = null;
let pointerDownAt = null;

canvas.addEventListener('pointerdown', (e) => {
  pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  if (!pointerDownAt) return;
  const dx = e.clientX - pointerDownAt.x;
  const dy = e.clientY - pointerDownAt.y;
  const dt = performance.now() - pointerDownAt.t;
  pointerDownAt = null;
  if (Math.hypot(dx, dy) > 6 || dt > 380) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(lanterns.map(l => l.hit), false);
  if (hits.length === 0) return;
  const lantern = hits[0].object.parent.userData.lantern;
  if (lantern) openCard(lantern);
});
function findUserWishRef(lantern){
  if (!lantern.isUser) return null;
  for (let i=userWishes.length-1; i>=0; i--){
    if (userWishes[i].text === lantern.wish) return userWishes[i];
  }
  return null;
}
function openCard(lantern){
  currentLantern = lantern;
  currentUserWishRef = findUserWishRef(lantern);
  cardText.textContent = lantern.wish || 'ဆုတောင်းစာ မရှိပါ';
  const shape = ['classic','cylinder','lotus'].includes(lantern.shape) ? lantern.shape : 'classic';
  const scale = Number(lantern.baseScale) || 1;
  const size = scale < 0.92 ? 'small' : scale > 1.36 ? 'large' : 'medium';
  const shapeNames = { classic:'Classic', cylinder:'Cylinder', lotus:'Lotus' };
  const sizeNames = { small:'သေး', medium:'အလတ်', large:'ကြီး' };
  cardIcon.dataset.shape = shape;
  cardIcon.dataset.size = size;
  cardLanternStyle.textContent = `${shapeNames[shape]} · ${sizeNames[size]}`;
  const h = Math.round(lantern.group.position.y);
  cardHeight.textContent = `အမြင့် ${h} m`;
  if (lantern.dedication){
    cardDedicate.style.display = 'block';
    cardDedicate.textContent = `— ${lantern.dedication} အတွက် ပူဇော်သည် —`;
  } else cardDedicate.style.display = 'none';
  const hueColor = new THREE.Color(lantern.hue || 0xff9028);
  const cssHue = `#${hueColor.getHexString()}`;
  cardIcon.style.background = `radial-gradient(ellipse at 50% 62%,#fff3ce 0%,${cssHue} 38%,${cssHue} 64%,rgba(60,22,6,.94) 100%)`;
  cardIcon.style.boxShadow = `0 0 28px 5px ${cssHue}66,0 0 62px 18px ${cssHue}22`;
  updateBlessUI();
  cardBackdrop.classList.add('show');
}
function updateBlessUI(){
  if (!currentLantern) return;
  const b = currentLantern.blessings || 0;
  if (b > 0){ cardBless.classList.add('blessed'); cardBlessLabel.textContent = `ကန်တော့ ${b}`; }
  else { cardBless.classList.remove('blessed'); cardBlessLabel.textContent = 'ကန်တော့'; }
}
function closeCard(){ cardBackdrop.classList.remove('show'); }
cardClose.addEventListener('click', closeCard);
cardBackdrop.addEventListener('click', (e) => { if (e.target === cardBackdrop) closeCard(); });
cardBless.addEventListener('click', () => {
  if (!currentLantern) return;
  currentLantern.blessings = (currentLantern.blessings || 0) + 1;
  const ud = currentLantern.body && currentLantern.body.userData;
  if (ud){
    ud.innerGlow.material.opacity = Math.min(0.9, ud.innerGlow.material.opacity + 0.12);
    ud.outerGlow.material.opacity = Math.min(0.6, ud.outerGlow.material.opacity + 0.07);
  }
  currentLantern.maxSpeed += 0.2;
  if (currentUserWishRef){
    currentUserWishRef.blessings = (currentUserWishRef.blessings || 0) + 1;
    saveWishes(); updateWishesBadge();
  }
  updateBlessUI();
  if (soundEnabled){ initAudio(); playBell(330, 1.2, 0.05); }
  showToast('🙏 ကောင်းချီး ပေးလိုက်ပါပြီ');
});

function makeWishShareUrl(lantern){
  const url = new URL(window.location.href);
  url.hash = '';
  if (!lantern || !lantern.wish) return url.href;
  const payload = {
    text: String(lantern.wish).slice(0,80),
    hue: Number(lantern.hue) || 0xff9028,
    shape: ['classic','cylinder','lotus'].includes(lantern.shape) ? lantern.shape : 'classic',
    size: Number(lantern.baseScale) || 1.15,
    dedication: String(lantern.dedication || '').slice(0,20)
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  const token = btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  url.hash = `wish=${token}`;
  return url.href;
}
async function copyShareText(text){
  try {
    if (navigator.clipboard && window.isSecureContext){ await navigator.clipboard.writeText(text); return true; }
  } catch(e){}
  try {
    const field = document.createElement('textarea');
    field.value = text; field.setAttribute('readonly','');
    field.style.position = 'fixed'; field.style.left = '-9999px'; field.style.top = '0';
    document.body.appendChild(field); field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  } catch(e){ return false; }
}
async function shareWishLink(lantern=null){
  const url = makeWishShareUrl(lantern);
  const text = lantern && lantern.wish ? lantern.wish : 'သီတင်းကျွတ် မီးပုံးကောင်းကင်ကို ကြည့်ရှုပါ';
  if (navigator.share){
    try {
      await navigator.share({ title:'သီတင်းကျွတ် ဆုတောင်း', text, url });
      showToast('လင့်ခ် မျှဝေပြီးပါပြီ');
      return;
    } catch(error){ if (error && error.name === 'AbortError') return; }
  }
  const copied = await copyShareText(url);
  if (copied) showToast('မျှဝေရန် လင့်ခ်ကို ကော်ပီကူးပြီးပါပြီ');
  else window.prompt('Copy this share link', url);
}
function showSharedWishFromUrl(){
  try {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('wish');
    if (!token || token.length > 3000) return;
    const base64 = token.replace(/-/g,'+').replace(/_/g,'/');
    const binary = atob(base64 + '='.repeat((4-base64.length%4)%4));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data.text !== 'string' || !data.text.trim()) return;
    const hue = Number.isFinite(Number(data.hue)) ? Math.max(0,Math.min(0xffffff,Number(data.hue))) : 0xff9028;
    const shape = ['classic','cylinder','lotus'].includes(data.shape) ? data.shape : 'classic';
    const size = THREE.MathUtils.clamp(Number(data.size)||1.15,.65,1.8);
    const lantern = spawnLantern(data.text.slice(0,80), {
      hue, shape, dedication: String(data.dedication||'').slice(0,20),
      position:{x:0,z:18}, startY:50, age:7, maxSpeed:.8, baseScale:size
    });
    setTimeout(() => openCard(lantern), 1250);
    setTimeout(() => showToast('မျှဝေထားသော ဆုတောင်းမီးပုံးကို ဖွင့်လိုက်ပါပြီ 🏮'), 1900);
  } catch(error){ console.warn('Shared wish link could not be read.'); }
}

/* card download */
function drawLanternIllustration(ctx, cx, cy, hueHex, shape, size){
  const scale = THREE.MathUtils.clamp((Number(size) || 1.15) / 1.15, 0.78, 1.2);
  const w = 130 * scale, h = 165 * scale;
  const left = cx - w/2, right = cx + w/2, top = cy - h/2, bottom = cy + h/2;
  const color = `#${new THREE.Color(hueHex).getHexString()}`;
  ctx.beginPath();
  if (shape === 'cylinder'){
    ctx.moveTo(cx-w*.30, top); ctx.lineTo(cx+w*.30, top);
    ctx.quadraticCurveTo(cx+w*.46, top+h*.05, cx+w*.47, top+h*.19);
    ctx.lineTo(cx+w*.47, bottom-h*.17);
    ctx.quadraticCurveTo(cx+w*.44, bottom-h*.04, cx+w*.30, bottom);
    ctx.lineTo(cx-w*.30, bottom);
    ctx.quadraticCurveTo(cx-w*.44, bottom-h*.04, cx-w*.47, bottom-h*.17);
    ctx.lineTo(cx-w*.47, top+h*.19);
    ctx.quadraticCurveTo(cx-w*.46, top+h*.05, cx-w*.30, top);
  } else if (shape === 'lotus'){
    const points = [[50,0],[57,7],[64,3],[70,12],[80,8],[85,19],[96,20],[92,34],[100,43],[94,55],[100,67],[92,77],[87,90],[74,91],[65,100],[50,93],[35,100],[26,91],[13,90],[8,77],[0,67],[6,55],[0,43],[8,34],[4,20],[15,19],[20,8],[30,12],[36,3],[43,7]];
    points.forEach(([x,y], index) => {
      const px = left + w*x/100, py = top + h*y/100;
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
  } else {
    ctx.moveTo(cx-w*.34, top);
    ctx.bezierCurveTo(cx-w*.57, top+h*.08, cx-w*.61, cy+h*.13, cx-w*.43, cy+h*.34);
    ctx.bezierCurveTo(cx-w*.27, bottom-h*.07, cx-w*.13, bottom-h*.02, cx, bottom);
    ctx.bezierCurveTo(cx+w*.13, bottom-h*.02, cx+w*.27, bottom-h*.07, cx+w*.43, cy+h*.34);
    ctx.bezierCurveTo(cx+w*.61, cy+h*.13, cx+w*.57, top+h*.08, cx+w*.34, top);
    ctx.closePath();
  }

  const bodyGradient = ctx.createRadialGradient(cx-w*.12, cy-h*.06, 5, cx, cy, w*.78);
  bodyGradient.addColorStop(0, '#fff5d5');
  bodyGradient.addColorStop(.24, color);
  bodyGradient.addColorStop(.78, color);
  bodyGradient.addColorStop(1, '#612a19');
  ctx.save();
  ctx.shadowColor = `${color}bb`; ctx.shadowBlur = 68; ctx.fillStyle = bodyGradient; ctx.fill();
  ctx.clip();
  const ribCount = shape === 'lotus' ? 8 : 6;
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(89,42,17,.42)';
  for (let i=0; i<ribCount; i++){
    const x = left + w*(i+1)/(ribCount+1);
    ctx.beginPath(); ctx.moveTo(x, top-4); ctx.quadraticCurveTo(cx+(x-cx)*.86, cy, x, bottom+4); ctx.stroke();
  }
  const flame = ctx.createRadialGradient(cx, cy+h*.3, 1, cx, cy+h*.3, w*.24);
  flame.addColorStop(0, 'rgba(255,255,220,.98)'); flame.addColorStop(.24, 'rgba(255,215,117,.9)'); flame.addColorStop(1, 'rgba(255,151,42,0)');
  ctx.fillStyle = flame; ctx.beginPath(); ctx.ellipse(cx, cy+h*.3, w*.23, h*.17, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,231,177,.82)'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.ellipse(cx, top+5, shape === 'cylinder' ? w*.3 : w*.34, 8*scale, 0, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = 'rgba(114,61,27,.82)'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.ellipse(cx, bottom-5, shape === 'cylinder' ? w*.3 : w*.43, 11*scale, 0, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,225,164,.62)'; ctx.lineWidth = 4;
  const beltY = shape === 'cylinder' ? cy+h*.03 : cy+h*.13;
  ctx.beginPath(); ctx.ellipse(cx, beltY, shape === 'cylinder' ? w*.47 : w*.41, 8*scale, 0, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}

function drawWishCardToCanvas(wishText, hueHex, dedication, shape='classic', size=1.15){
  const W = 1080, H = 1350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const bg = ctx.createRadialGradient(W/2, H*0.15, 0, W/2, H*0.15, H*0.9);
  bg.addColorStop(0,'#30234d'); bg.addColorStop(0.55,'#15102b'); bg.addColorStop(1,'#03040b');
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
  const cssHue = `#${new THREE.Color(hueHex).getHexString()}`;
  const glowColor = `${cssHue}99`;
  const glow = ctx.createRadialGradient(W/2, 240, 0, W/2, 240, 520);
  glow.addColorStop(0, glowColor); glow.addColorStop(1, 'rgba(255,140,30,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 640);
  ctx.strokeStyle = 'rgba(255,208,129,0.48)'; ctx.lineWidth = 2;
  const pad = 42; ctx.beginPath(); ctx.roundRect(pad, pad, W-pad*2, H-pad*2, 42); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,208,129,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([5, 11]);
  ctx.beginPath(); ctx.roundRect(pad+16, pad+16, W-(pad+16)*2, H-(pad+16)*2, 30); ctx.stroke();
  ctx.setLineDash([]);
  const cx = W/2, cy = 294;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,212,145,.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 126, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,212,145,.22)'; ctx.setLineDash([4,10]);
  ctx.beginPath(); ctx.arc(cx, cy, 111, 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ffe2a9';
  for (const angle of [-Math.PI/2, 0, Math.PI/2, Math.PI]){
    const x = cx + Math.cos(angle)*126, y = cy + Math.sin(angle)*126;
    ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
  drawLanternIllustration(ctx, cx, cy, hueHex, shape, size);
  const shapeNames = { classic:'CLASSIC', cylinder:'CYLINDER', lotus:'LOTUS' };
  const sizeNames = { small:'သေး', medium:'အလတ်', large:'ကြီး' };
  const sizeClass = size < .92 ? 'small' : size > 1.36 ? 'large' : 'medium';
  ctx.fillStyle = '#f5cf91';
  ctx.font = '700 19px "Noto Sans Myanmar","Padauk",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`${shapeNames[shape] || 'CLASSIC'}  ·  ${sizeNames[sizeClass]}`, W/2, 445);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,208,129,.36)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W/2 - 92, 484); ctx.lineTo(W/2 - 18, 484); ctx.moveTo(W/2 + 18, 484); ctx.lineTo(W/2 + 92, 484); ctx.stroke();
  ctx.fillStyle = '#ffdda0'; ctx.beginPath(); ctx.moveTo(W/2,476); ctx.lineTo(W/2+8,484); ctx.lineTo(W/2,492); ctx.lineTo(W/2-8,484); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#a08cc4';
  ctx.font = '600 22px "Noto Sans Myanmar","Padauk",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ဆုတောင်းစာ', W/2, 530);
  ctx.strokeStyle = 'rgba(255,190,90,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W/2 - 80, 566); ctx.lineTo(W/2 + 80, 566); ctx.stroke();
  const maxWidth = W - 200;
  const fontSize = 44;
  const lineH = fontSize * 1.7;
  ctx.font = `700 ${fontSize}px "Noto Sans Myanmar","Padauk",sans-serif`;
  const lines = []; let line = '';
  for (const ch of Array.from(wishText)){
    if (ch === '\n'){ lines.push(line); line=''; continue; }
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0){
      const sp = line.lastIndexOf(' ');
      if (sp > line.length*0.4){ lines.push(line.slice(0, sp)); line = line.slice(sp+1) + ch; }
      else { lines.push(line); line = ch; }
    } else line = test;
  }
  if (line) lines.push(line);
  ctx.font = `700 60px serif`;
  ctx.fillStyle = 'rgba(255,190,90,0.5)';
  const startY = 660;
  ctx.fillText('❝', W/2, startY - 60);
  ctx.font = `700 ${fontSize}px "Noto Sans Myanmar","Padauk",sans-serif`;
  ctx.shadowColor = cssHue; ctx.shadowBlur = 40; ctx.fillStyle = '#ffe6b8';
  lines.forEach((ln, i) => ctx.fillText(ln, W/2, startY + i * lineH));
  ctx.shadowColor = 'rgba(255,230,180,0.6)'; ctx.shadowBlur = 12; ctx.fillStyle = '#fff8d8';
  lines.forEach((ln, i) => ctx.fillText(ln, W/2, startY + i * lineH));
  ctx.shadowBlur = 0;
  let endY = startY + lines.length * lineH + 60;
  if (dedication){
    ctx.fillStyle = '#a08cc4';
    ctx.font = 'italic 600 24px "Noto Sans Myanmar","Padauk",sans-serif';
    ctx.fillText(`— ${dedication} အတွက် ပူဇော်သည် —`, W/2, endY);
    endY += 50;
  }
  ctx.fillStyle = 'rgba(255,190,90,0.35)';
  ctx.fillRect(W/2 - 40, endY, 80, 1);
  ctx.fillStyle = '#8b86a8';
  ctx.font = '400 20px "Noto Sans Myanmar","Padauk",sans-serif';
  ctx.fillText('သီတင်းကျွတ် အခါတော်နေ့', W/2, H - 130);
  ctx.fillStyle = 'rgba(255,210,130,0.75)';
  ctx.font = '600 22px "Noto Sans Myanmar","Padauk",sans-serif';
  ctx.fillText('ဆုတောင်းပြည့်ပါစေ 🏮', W/2, H - 90);
  return c;
}
cardDownload.addEventListener('click', () => {
  if (!currentLantern) return;
  const c = drawWishCardToCanvas(currentLantern.wish, currentLantern.hue, currentLantern.dedication, currentLantern.shape, currentLantern.baseScale);
  c.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ဆုတောင်းစာ_${Date.now()}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast('ဆုတောင်းစာကဒ် ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ 📥');
  }, 'image/png');
});
cardShare.addEventListener('click', async () => {
  if (!currentLantern) return;
  const link = makeWishShareUrl(currentLantern);
  const text = currentLantern.wish + (currentLantern.dedication ? ` (${currentLantern.dedication} အတွက်)` : '');
  const c = drawWishCardToCanvas(currentLantern.wish, currentLantern.hue, currentLantern.dedication, currentLantern.shape, currentLantern.baseScale);
  c.toBlob(async blob => {
    if (blob && navigator.canShare){
      const file = new File([blob], 'wish.png', { type:'image/png' });
      if (navigator.canShare({ files:[file] })){
        try {
          await navigator.share({ title:'သီတင်းကျွတ် ဆုတောင်းစာ', text, url:link, files:[file] });
          showToast('ဆုတောင်းစာနှင့် လင့်ခ် မျှဝေပြီးပါပြီ');
          return;
        } catch(error){ if (error && error.name === 'AbortError') return; }
      }
    }
    await shareWishLink(currentLantern);
  }, 'image/png');
});

/* Photo mode captures the WebGL scene only; no device camera permission is needed. */
const photoBtn = document.getElementById('photoBtn');
const photoTools = document.getElementById('photoTools');
const photoCaptureBtn = document.getElementById('photoCaptureBtn');
const photoShareBtn = document.getElementById('photoShareBtn');
const photoExitBtn = document.getElementById('photoExitBtn');
function setPhotoMode(enabled){
  document.body.classList.toggle('photo-mode', enabled);
  photoTools.setAttribute('aria-hidden', String(!enabled));
}
photoBtn.addEventListener('click', () => setPhotoMode(true));
photoExitBtn.addEventListener('click', () => setPhotoMode(false));
photoShareBtn.addEventListener('click', () => shareWishLink(currentLantern));
photoCaptureBtn.addEventListener('click', () => {
  const original = photoCaptureBtn.innerHTML;
  photoCaptureBtn.disabled = true;
  photoCaptureBtn.textContent = 'သိမ်းဆည်းနေသည်…';
  const finish = (message) => {
    photoCaptureBtn.innerHTML = original;
    photoCaptureBtn.disabled = false;
    photoCaptureBtn.title = message;
    setTimeout(() => { photoCaptureBtn.title = 'Save scene photo'; }, 1800);
  };
  try {
    canvas.toBlob(blob => {
      if (!blob){ finish('Photo could not be saved'); return; }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `thadingyut-photo-${new Date().toISOString().slice(0,10)}.png`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      finish('Photo saved');
    }, 'image/png');
  } catch(error){ finish('Photo could not be saved'); }
});
document.getElementById('linkShareBtn').addEventListener('click', () => shareWishLink(null));
setTimeout(showSharedWishFromUrl, 1050);

/* INFO MODAL */
const infoBackdrop = document.getElementById('infoBackdrop');
const infoBtn = document.getElementById('infoBtn');
const infoClose = document.getElementById('infoClose');
infoBtn.addEventListener('click', () => infoBackdrop.classList.add('show'));
infoClose.addEventListener('click', () => infoBackdrop.classList.remove('show'));
infoBackdrop.addEventListener('click', (e) => { if (e.target === infoBackdrop) infoBackdrop.classList.remove('show'); });

/* WISHES LIST */
const wishesBackdrop = document.getElementById('wishesBackdrop');
const wishesBtn = document.getElementById('wishesBtn');
const wishesClose = document.getElementById('wishesClose');
const wishesBadge = document.getElementById('wishesBadge');
wishesBtn.addEventListener('click', () => { renderWishesPanel(); wishesBackdrop.classList.add('show'); });
wishesClose.addEventListener('click', () => wishesBackdrop.classList.remove('show'));
wishesBackdrop.addEventListener('click', (e) => { if (e.target === wishesBackdrop) wishesBackdrop.classList.remove('show'); });

function updateWishesBadge(){
  const n = userWishes.length;
  if (n > 0){ wishesBadge.style.display = 'flex'; wishesBadge.textContent = n; }
  else wishesBadge.style.display = 'none';
}
function renderWishesPanel(){
  const list = document.getElementById('wishesList');
  const st = getStreak();
  document.getElementById('statTotal').textContent = userWishes.length;
  document.getElementById('statBlessed').textContent = userWishes.reduce((a,w) => a + (w.blessings||0), 0);
  document.getElementById('statFlying').textContent = userWishes.filter(w => Date.now() - w.at < 3*3600*1000).length;
  const streakEl = document.getElementById('streakText');
  if (st.count > 0){
    streakEl.innerHTML = `🔥 နေ့စဉ် streak <b style="color:#ffd894">${st.count}</b> ရက်<small>စုစုပေါင်း ${st.total||0} ကြိမ် ဆုတောင်းခဲ့ပြီ</small>`;
  } else {
    streakEl.innerHTML = `🔥 နေ့စဉ် ဆုတောင်း streak<small>ဒီနေ့ ဆုတောင်းတစ်ခု လွှတ်ကြည့်ပါ</small>`;
  }
  if (userWishes.length === 0){
    list.innerHTML = `<div class="empty"><span class="icon">🏮</span>သင် ဆုတောင်းတစ်ခုမှ မလွှတ်ရသေးပါ<br>မီးပုံးတစ်လုံး လွှတ်ကြည့်ပါ</div>`;
    return;
  }
  list.innerHTML = '';
  for (let i=userWishes.length-1; i>=0; i--){
    const w = userWishes[i];
    const hueColor = new THREE.Color(w.hue || 0xff9028);
    const cssHue = `rgb(${Math.round(hueColor.r*255)},${Math.round(hueColor.g*255)},${Math.round(hueColor.b*255)})`;
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <span class="swatch-dot" style="background:${cssHue};color:${cssHue}"></span>
      <div class="info">
        <div class="wish">${escapeHtml(w.text)}</div>
        <div class="meta-row2">
          <span>${timeAgo(w.at)}</span>
          ${w.blessings ? `<span class="bl">🙏 ${w.blessings}</span>` : ''}
          ${w.dedication ? `<span>— ${escapeHtml(w.dedication)}</span>` : ''}
        </div>
      </div>
    `;
    el.addEventListener('click', () => {
      const live = lanterns.find(l => l.isUser && l.wish === w.text);
      if (live){ wishesBackdrop.classList.remove('show'); openCard(live); }
      else showToast('ဒီမီးပုံး ကောင်းကင်ပေါ် မရှိတော့ပါ 🏮');
    });
    list.appendChild(el);
  }
}
function timeAgo(ts){
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'အခုလေးတင်';
  if (m < 60) return `${m} မိနစ်က`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} နာရီက`;
  return `${Math.floor(h / 24)} ရက်က`;
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
updateWishesBadge();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){
    closeCard(); closeCompose();
    infoBackdrop.classList.remove('show');
    wishesBackdrop.classList.remove('show');
    timeBackdrop.classList.remove('show');
    setPhotoMode(false);
  }
});

/* POEM */
const poemBox = document.getElementById('poemBox');
let poemIdx = 0;
function rotatePoem(){
  poemBox.classList.remove('show');
  setTimeout(() => {
    poemBox.textContent = POEMS[poemIdx];
    poemBox.classList.add('show');
    poemIdx = (poemIdx + 1) % POEMS.length;
  }, 900);
}
setTimeout(rotatePoem, 1400);
setInterval(rotatePoem, 11000);

/* ═══════════════════════════════════════════
   POST-PROCESSING
   ═══════════════════════════════════════════ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.65, 0.78);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ═══════════════════════════════════════════
   WIND
   ═══════════════════════════════════════════ */
const wind = {
  dirX: 1, dirZ: 0, strength: 0,
  targetStrength: 0, targetDirX: 1, targetDirZ: 0, nextChange: 0
};
function updateWind(t){
  if (t > wind.nextChange){
    wind.nextChange = t + 20 + Math.random() * 25;
    const angle = Math.random() * Math.PI * 2;
    wind.targetDirX = Math.cos(angle);
    wind.targetDirZ = Math.sin(angle);
    wind.targetStrength = Math.random() < 0.35 ? 0.2 + Math.random()*0.4 : 0.02 + Math.random()*0.1;
  }
  wind.dirX += (wind.targetDirX - wind.dirX) * 0.02;
  wind.dirZ += (wind.targetDirZ - wind.dirZ) * 0.02;
  wind.strength += (wind.targetStrength - wind.strength) * 0.02;
}

/* ═══════════════════════════════════════════
   DAY/NIGHT ENVIRONMENT UPDATE
   ═══════════════════════════════════════════ */
const _hemiDay = new THREE.Color(0xa8c8f0);
const _hemiNight = new THREE.Color(0x35406e);
const _hemiGroundDay = new THREE.Color(0x8090b0);
const _hemiGroundNight = new THREE.Color(0x07070f);
const _ambDay = new THREE.Color(0x8098c0);
const _ambNight = new THREE.Color(0x1c2038);

let _lastTimeUIUpdate = 0;
let _lastDayMode = false;
let currentDayFactor = 0;

function updateEnvironment(t){
  const hours = getHours();
  const sunPos = getCelestialPosition(hours);
  const moonPos = getCelestialPosition(hours + 12);

  /* Sun mesh + glows */
  sun.position.set(sunPos.x, sunPos.y, sunPos.z);
  sunGlow1.position.copy(sun.position);
  sunGlow2.position.copy(sun.position);
  sunGlow3.position.copy(sun.position);

  const sunOpacity = smoothstep(-150, 100, sunPos.y);
  sun.material.opacity = sunOpacity;
  sunGlow1.material.opacity = sunOpacity * 0.9;
  sunGlow2.material.opacity = sunOpacity * 0.5;
  sunGlow3.material.opacity = sunOpacity * 0.24;
  const sunVis = sunOpacity > 0.02;
  sun.visible = sunVis;
  sunGlow1.visible = sunVis;
  sunGlow2.visible = sunVis;
  sunGlow3.visible = sunVis;

  /* Moon mesh + glow */
  moon.position.set(moonPos.x, moonPos.y, moonPos.z);
  const moonOpacity = smoothstep(-150, 100, moonPos.y);
  moon.material.opacity = moonOpacity;
  moonGlow.material.opacity = moonOpacity * 0.18;
  const moonVis = moonOpacity > 0.02;
  moon.visible = moonVis;
  moonGlow.visible = moonVis;

  /* Sky colors */
  const dayFactor = smoothstep(-150, 250, sunPos.y);
  const sunsetFactor = Math.max(0, 1 - Math.abs(sunPos.y) / 400);

  const topC = SKY_NIGHT.top.clone().lerp(SKY_DAY.top, dayFactor);
  const midC = SKY_NIGHT.mid.clone().lerp(SKY_DAY.mid, dayFactor);
  const botC = SKY_NIGHT.bottom.clone().lerp(SKY_DAY.bottom, dayFactor);

  topC.lerp(SKY_SUNSET.top, sunsetFactor * 0.7);
  midC.lerp(SKY_SUNSET.mid, sunsetFactor * 0.8);
  botC.lerp(SKY_SUNSET.bottom, sunsetFactor * 0.85);

  /* Smoothly lerp current sky uniforms toward target */
  skyUniforms.cTop.value.lerp(topC, 0.08);
  skyUniforms.cMid.value.lerp(midC, 0.08);
  skyUniforms.cBottom.value.lerp(botC, 0.08);

  /* Lighting */
  const df = smoothstep(-150, 250, sunPos.y);
  currentDayFactor = df;
  hemiLight.color.copy(_hemiNight).lerp(_hemiDay, df);
  hemiLight.groundColor.copy(_hemiGroundNight).lerp(_hemiGroundDay, df);
  hemiLight.intensity = 0.32 + df * 0.5;

  ambientLight.color.copy(_ambNight).lerp(_ambDay, df);
  ambientLight.intensity = 0.5 + df * 0.4;

  moonLight.intensity = 0.35 * (1 - df);
  sunLight.position.copy(sun.position);
  sunLight.intensity = df * 1.5;

  warmLight.intensity = (1.3 + Math.sin(t * 1.3) * 0.18) * (1 - df * 0.7);
  pagodaCore.intensity = (0.85 + Math.sin(t * 1.7 + 1.2) * 0.15) * (1 - df * 0.6);

  /* Fog color follows sky */
  scene.fog.color.copy(midC).multiplyScalar(0.45);

  /* Daytime clouds drift softly across the same sky; night clears them away. */
  cloudMaterial.opacity = df * .62;
  cloudSprites.forEach(cloud => {
    cloud.visible = df > .015;
    cloud.position.x += cloud.userData.drift * .035;
    if (cloud.position.x > 760) cloud.position.x = -760;
  });

  /* Stars visibility */
  starMaterial.uniforms.uOpacity.value = 1 - df;
  /* Embers only at night */
  embersMaterial.uniforms.uOpacity.value = 1 - df * 0.85;

  /* Ground color: darker by night, lighter by day */
  groundMat.color.setRGB(
    0.03 + df * 0.15,
    0.035 + df * 0.17,
    0.10 + df * 0.20
  );

  /* Ring opacities: dimmer by day */
  groundRings.forEach((r, i) => {
    r.material.opacity = (0.07 - i*0.013) * (1 - df * 0.6);
  });

  /* Body class for UI theming */
  const isDay = df > 0.5;
  if (isDay !== _lastDayMode){
    _lastDayMode = isDay;
    document.body.classList.toggle('day-mode', isDay);
  }

  /* Time UI update every 500ms */
  if (t - _lastTimeUIUpdate > 0.5){
    _lastTimeUIUpdate = t;
    if (timeBackdrop.classList.contains('show')){
      updateTimeUI();
    }
  }
}

/* ═══════════════════════════════════════════
   ANIMATION LOOP
   ═══════════════════════════════════════════ */
const clock = new THREE.Clock();

function updateLanternLocalPhysics(l,dt,t){
  l.age+=dt;
  const speed=l.maxSpeed*(1-Math.exp(-l.age*.55));
  l.group.position.y+=speed*dt;
  const sway=l.swayAmp*(1-Math.exp(-l.age*.25));
  const windPush=wind.strength*8*(1-Math.exp(-l.age*.4));
  l.group.position.x=l.baseX+Math.sin(t*l.swayFreq+l.phase)*sway+wind.dirX*windPush*l.age*.06;
  l.group.position.z=l.baseZ+Math.cos(t*l.swayFreq*.78+l.phase)*sway+wind.dirZ*windPush*l.age*.06;
  l.group.rotation.z=Math.sin(t*.85+l.phase)*.09+wind.dirX*wind.strength*.4;
  l.group.rotation.x=Math.cos(t*.62+l.phase)*.065+wind.dirZ*wind.strength*.4;
  const progress=Math.min(1,l.age/1.3);
  const ease=1-Math.pow(1-progress,3);
  l.group.scale.setScalar(l.baseScale*ease);
  if(l.group.position.y>280&&!cameraFollow){
    const p=randomSkyPosition();
    l.baseX=p.x;l.baseZ=p.z;
    l.group.position.set(p.x,6+Math.random()*20,p.z);
    l.phase=Math.random()*Math.PI*2;
  }
}
function updateLanternVisuals(l,dt,t){
  const ud=l.body&&l.body.userData;
  if(ud&&ud.flameCore){
    const f1=1+Math.sin(t*11+l.phase)*.13;
    const f2=1+Math.sin(t*21+l.phase*2.1)*.07;
    const flick=f1*f2;
    ud.flameCore.scale.set(1,1.7*flick,1);
    ud.flameOuter.scale.set(flick,1.9*flick,1);
    ud.flameOuter.material.opacity=.30+Math.sin(t*14+l.phase)*.06;
    ud.innerGlow.material.opacity=(.34+Math.sin(t*8+l.phase)*.07)*(1+(l.brightness||0)*.4);
    ud.outerGlow.material.opacity=.20+Math.sin(t*6+l.phase)*.05;
  }
  if(l.label)l.label.material.opacity=Math.min(1,l.age/1.8)*l.labelOpacity;
  if(l.smokeTrail)updateSmoke(l.smokeTrail,l.group.position,dt,t);
}
function updateLantern(l,dt,t){
  if(!lanternPhysicsWorkerEnabled)updateLanternLocalPhysics(l,dt,t);
  updateLanternVisuals(l,dt,t);
}

function updateOilLamps(t){
  const mats = pagoda.userData.flameMats;
  if (!mats) return;
  for (let i=0;i<mats.length;i++){
    mats[i].opacity = 0.82 + Math.sin(t*3.4 + i*1.7)*0.12 + Math.sin(t*7.1 + i*0.9)*0.06;
  }
}
function updateEmbers(dt, t){
  const pts = scene.userData.embers;
  if (!pts) return;
  const pos = pts.geometry.attributes.position;
  const spd = pts.geometry.userData.spd;
  for (let i=0;i<pos.count;i++){
    let y = pos.getY(i) + spd[i] * dt * 1.5;
    if (y > 180) y = 2;
    pos.setY(i, y);
    pos.setX(i, pos.getX(i) + Math.sin(t*0.5 + i)*dt*0.3);
  }
  pos.needsUpdate = true;
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateWind(t);
  updateEnvironment(t);
  updateShootingStars(dt, t, 1-currentDayFactor);
  tickLanternPhysicsWorker(dt,t);

  for (let i=0;i<lanterns.length;i++) updateLantern(lanterns[i], dt, t);
  updateFireworks(dt);
  updateEmbers(dt, t);
  updateOilLamps(t);
  updateOfferingLamps(t);

  for (const s of spotPivots) s.pivot.rotation.y += s.speed * dt * s.dir;
  moon.rotation.y += dt * 0.005;

  const following = updateCameraFollow(t);
  const trackingMeteor = !following && updateMeteorCameraFocus(t);
  if (!following && !trackingMeteor) controls.update();

  composer.render();
}

/* ═══════════════════════════════════════════
   RESIZE
   ═══════════════════════════════════════════ */
function onResize(){
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

/* ═══════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════ */
animate();
setTimeout(() => document.getElementById('loader').classList.add('hide'), 900);

['pointerdown','keydown','touchstart'].forEach(evt => {
  window.addEventListener(evt, () => {
    if (!audioCtx) initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (soundEnabled) scheduleAmbientBell();
  }, { once: true, passive: true });
});

window.addEventListener('touchstart', (e) => {
  if (e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON'){
    if (document.activeElement === wishInput) wishInput.blur();
  }
}, { passive: true });
