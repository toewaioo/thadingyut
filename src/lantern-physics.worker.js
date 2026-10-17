const lanterns = new Map();
const STRIDE = 11;

function randomSkyPosition(){
  let x=0,z=0;
  for(let i=0;i<16;i++){
    const angle=Math.random()*Math.PI*2;
    const radius=40+Math.random()*150;
    x=Math.cos(angle)*radius;
    z=Math.sin(angle)*radius;
    if(Math.hypot(x,z+70)>75)break;
  }
  return {x,z};
}

self.onmessage = (event) => {
  const message=event.data;
  if(!message)return;

  if(message.type==='add'){
    lanterns.set(message.state.id,{...message.state});
    return;
  }
  if(message.type==='remove'){
    lanterns.delete(message.id);
    return;
  }
  if(message.type!=='tick')return;

  const dt=Math.max(0,Math.min(message.dt||0,.08));
  const t=message.t||0;
  const wind=message.wind||{strength:0,dirX:0,dirZ:0};
  const output=new Float32Array(lanterns.size*STRIDE);
  let offset=0;

  for(const state of lanterns.values()){
    state.age+=dt;
    const speed=state.maxSpeed*(1-Math.exp(-state.age*.55));
    state.y+=speed*dt;
    const sway=state.swayAmp*(1-Math.exp(-state.age*.25));
    const windPush=wind.strength*8*(1-Math.exp(-state.age*.4));
    state.x=state.baseX+Math.sin(t*state.swayFreq+state.phase)*sway+wind.dirX*windPush*state.age*.06;
    state.z=state.baseZ+Math.cos(t*state.swayFreq*.78+state.phase)*sway+wind.dirZ*windPush*state.age*.06;
    state.rotationZ=Math.sin(t*.85+state.phase)*.09+wind.dirX*wind.strength*.4;
    state.rotationX=Math.cos(t*.62+state.phase)*.065+wind.dirZ*wind.strength*.4;

    if(state.y>280&&!message.suspendRecycle){
      const position=randomSkyPosition();
      state.baseX=position.x;
      state.baseZ=position.z;
      state.x=position.x;
      state.y=6+Math.random()*20;
      state.z=position.z;
      state.phase=Math.random()*Math.PI*2;
    }

    const progress=Math.min(1,state.age/1.3);
    const ease=1-Math.pow(1-progress,3);
    output[offset++]=state.id;
    output[offset++]=state.age;
    output[offset++]=state.x;
    output[offset++]=state.y;
    output[offset++]=state.z;
    output[offset++]=state.rotationX;
    output[offset++]=state.rotationZ;
    output[offset++]=state.baseScale*ease;
    output[offset++]=state.baseX;
    output[offset++]=state.baseZ;
    output[offset++]=state.phase;
  }

  self.postMessage({type:'frame',frameId:message.frameId,buffer:output.buffer},[output.buffer]);
};

self.postMessage({type:'ready'});
