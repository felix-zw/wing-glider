import {World} from '../src/world';
import {BUILTIN_DOCUMENTS,cloneDocument} from '../src/level-document';
import {registerLevel} from '../src/levels';

import {createState,advance,neutralInput} from '../src/simulation';
import * as THREE from 'three';
const world=new World(document.getElementById('viewport')!);
const run=document.getElementById('run') as HTMLButtonElement,stop=document.getElementById('stop') as HTMLButtonElement,status=document.getElementById('status')!,results=document.getElementById('results')!,report=document.getElementById('report') as HTMLTextAreaElement;
const frame=()=>new Promise<number>(r=>requestAnimationFrame(r));let cancelled=false;
world.ready.then(()=>{run.disabled=false;status.textContent='Bereit. Während der Messung diesen Tab sichtbar lassen.';});
stop.onclick=()=>cancelled=true;
run.onclick=async()=>{
  run.disabled=true;stop.disabled=false;cancelled=false;results.textContent='';
  const gl=world.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
  const data={date:new Date().toISOString(),browser:navigator.userAgent,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),resolution:[1920,1080],warmupSeconds:3,measurementSeconds:15,samples:[] as object[],completed:false};
  const dense=cloneDocument(BUILTIN_DOCUMENTS[1]);dense.id='performance-dense';dense.name='Dense asteroid study';dense.deposits=[];dense.bounds=210;dense.base.x=-160;dense.base.z=-160;dense.spawn={x:0,z:0};
  const current=BUILTIN_DOCUMENTS[1].objects;
  dense.objects=Array.from({length:12},(_,i)=>({id:'dense-'+i,assetId:'sculpt-asteroid',x:(i%4-1.5)*58,z:(Math.floor(i/4)-1)*66,rotation:i*.72,scale:.65,parameters:{...current[i%5].parameters}}));registerLevel(dense);
  try{
    for(const quality of ['high','standard'] as const)for(const workload of ['aster-flight','belt-mining','dense-editor'] as const){
      if(cancelled)break;world.setQuality(quality);world.renderer.setPixelRatio(1);world.resize(1920,1080);world.renderer.domElement.style.width='100vw';world.renderer.domElement.style.height='100vh';
      const state=createState(workload==='aster-flight'?'aster':workload==='belt-mining'?'belt':dense.id);
      const ore=state.resources.deposits[1];if(workload==='belt-mining'){state.x=ore.x+ore.surface!.nx*10;state.z=ore.z+ore.surface!.nz*10;state.turret=Math.atan2(ore.x-state.x,-(ore.z-state.z));}
      if(workload==='dense-editor'&&state.environment.kind==='space')state.environment.asteroids=[];
      world.reset(state);world.setEditorView(workload==='dense-editor'?{x:0,z:0,zoom:.42}:null);
      let previous=await frame(),start=previous,frames=0,calls=0,triangles=0;const times:number[]=[];
      while(!cancelled){const now=await frame(),elapsed=(now-start)/1000,dt=Math.min(.05,(now-previous)/1000);
        if(elapsed>18)break;
        if(elapsed>=3){times.push(now-previous);frames++;calls+=world.renderer.info.render.calls;triangles+=world.renderer.info.render.triangles;}
        if(workload==='dense-editor')state.elapsed+=dt;
        else{state.health=100;state.dead=false;if(workload==='belt-mining'){ore.remaining=12;state.resources.cargo={ferrite:0,copper:0,crystal:0};}
          advance(state,{...neutralInput(),thrust:workload==='aster-flight'?.65:0,steer:workload==='aster-flight'?.2:0,mine:workload==='belt-mining',aim:state.turret},dt);}
        world.render(state,dt,workload==='aster-flight'?.65:0);previous=now;
        status.textContent=`${quality} · ${workload} · ${Math.min(15,Math.max(0,elapsed-3)).toFixed(1)} / 15 s`;
      }
      if(!frames)continue;times.sort((a,b)=>a-b);const sum=times.reduce((a,b)=>a+b,0),sample={quality,workload,frames,averageFps:frames*1000/sum,p95FrameMs:times[Math.floor(times.length*.95)],drawCalls:calls/frames,triangles:triangles/frames,memory:{...world.renderer.info.memory}};
      data.samples.push(sample);results.textContent+=`${quality} / ${workload}: ${sample.averageFps.toFixed(2)} FPS · p95 ${sample.p95FrameMs.toFixed(2)} ms · ${Math.round(sample.drawCalls)} calls\n`;
    }
    if(!cancelled){status.textContent='RAF-Baseline · Rendering und Simulation aus';let previous=await frame(),start=previous;const times:number[]=[];while(previous-start<12000&&!cancelled){const now=await frame();if(now-start>2000)times.push(now-previous);previous=now;}times.sort((a,b)=>a-b);data.samples.push({workload:'raf-baseline',averageFps:times.length*1000/times.reduce((a,b)=>a+b,0),p95FrameMs:times[Math.floor(times.length*.95)]});}
    data.completed=!cancelled;report.value=JSON.stringify(data,null,2);status.textContent=cancelled?'Abgebrochen':'Messung abgeschlossen';
  }catch(error){status.textContent='Fehler: '+String(error);console.error(error);}
  finally{world.setEditorView(null);run.disabled=false;stop.disabled=true;}
};
