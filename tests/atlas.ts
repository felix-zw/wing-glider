import * as THREE from 'three';
import { World } from '../src/world';
import { createState, advance, neutralInput } from '../src/simulation';
import { deploymentActive } from '../src/deployment';
import { atlasPlacement, atlasDriveSurface, atlasPoint, atlasLocal } from '../src/atlas-rig';
import { getLevelWorld, groundHeight } from '../src/levels';
import { GameAudio } from '../src/audio';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const world=new World(el('viewport')),audio=new GameAudio({volume:0});
const params=new URLSearchParams(location.search);
let level=params.get('level')==='belt'?'belt':'aster',time=Number(params.get('t')??0),playing=false,loaded=false,busy=false;
let state=createState(level,{arrival:true}),previous=performance.now();
function pose(t:number) {state=createState(level,{arrival:true});advance(state,neutralInput(),t);time=t;render();}
function render() {
  world.camera.up.set(0,0,-1);
  world.render(state,0,0);
  if(el<HTMLInputElement>('side').checked) {
    const p=atlasPlacement(world.levelWorld),target=atlasPoint(p,0,2,6),eye=atlasPoint(p,44,32,48);
    world.camera.zoom=1.65;world.camera.position.set(eye.x,eye.y,eye.z);world.camera.up.set(0,1,0);world.camera.lookAt(target.x,target.y,target.z);world.camera.updateProjectionMatrix();world.renderer.render(world.scene,world.camera);
  } else world.camera.up.set(0,0,-1);
  el<HTMLInputElement>('time').value=String(time);el('status').textContent=`${level} · ${time.toFixed(2)} s · ${state.deployment?.phase} · Missionszeit ${state.elapsed.toFixed(2)} s`;
}
function changeLevel(id:string) {level=id;playing=false;state=createState(id,{arrival:true});world.reset(state);pose(time);}
el('aster').onclick=()=>changeLevel('aster');el('belt').onclick=()=>changeLevel('belt');
el('play').onclick=()=>{if(!loaded)return;if(time>=8)pose(0);playing=!playing;};
el<HTMLInputElement>('time').oninput=()=>{playing=false;pose(Number(el<HTMLInputElement>('time').value));};
document.querySelectorAll<HTMLButtonElement>('[data-time]').forEach(b=>b.onclick=()=>{playing=false;pose(Number(b.dataset.time));});
el<HTMLInputElement>('side').onchange=()=>render();
el<HTMLSelectElement>('quality').onchange=()=>{world.setQuality(el<HTMLSelectElement>('quality').value as 'high'|'standard');render();};
el('hide').onclick=()=>{el('panel').hidden=true;el('show').hidden=false;};el('show').onclick=()=>{el('panel').hidden=false;el('show').hidden=true;};
function frame(now:number) {const dt=Math.min(.05,(now-previous)/1000);previous=now;if(loaded&&playing&&!busy&&!document.hidden){advance(state,neutralInput(),dt);time=state.deployment!.time;render();if(!deploymentActive(state.deployment))playing=false;}requestAnimationFrame(frame);}
requestAnimationFrame(frame);
const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
function check(ok:unknown,label:string){if(!ok)throw new Error(label);el('results').textContent+='PASS '+label+'\n';}
function clearance(object:THREE.Object3D,surface:(x:number,z:number)=>number) {
  let minimum=Infinity,detail='';const point=new THREE.Vector3();object.updateMatrixWorld(true);
  object.traverse(node=>{if(!(node instanceof THREE.Mesh)||!node.geometry.userData.shared)return;const positions=node.geometry.getAttribute('position');
    for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(node.matrixWorld);const d=point.y-surface(point.x,point.z);if(d<minimum){minimum=d;detail=node.name+' @ '+point.toArray().map(n=>n.toFixed(2)).join(',');}}
  });return {minimum,detail};
}
el('checks').onclick=async()=>{
  if(!loaded||busy)return;busy=true;playing=false;el('results').textContent='';el<HTMLButtonElement>('checks').disabled=true;
  try {
    await audio.unlock();
    for(const id of ['aster','belt'])for(const quality of ['high','standard'] as const) {
      level=id;world.setQuality(quality);state=createState(id,{arrival:true});world.reset(state);
      const terrain=getLevelWorld(id),p=atlasPlacement(terrain);
      let atlasMinimum=Infinity,vehicleMinimum=Infinity;
      for(const t of [0,.5,1,1.5,2,2.25,2.5,3,3.5,3.75,4,4.25,4.5,5,5.5,6,6.5,7,7.5,8]) {
        pose(t);const ship=world.scene.getObjectByName('ATLAS')!,player=world.scene.getObjectByName('player-speeder')!;
        if(id==='aster') {
          const ground=(x:number,z:number)=>groundHeight(terrain,x,z);
          const atlas=clearance(ship,ground),speeder=clearance(player,(x,z)=>t<4?ground(x,z):atlasDriveSurface(terrain,p,x,z));
          check(atlas.minimum>=0,`${id}/${quality} ${t}s ATLAS ground clearance ${atlas.minimum.toFixed(3)}m (${atlas.detail})`);
          check(speeder.minimum>.3,`${id}/${quality} ${t}s Speeder clearance ${speeder.minimum.toFixed(3)}m (${speeder.detail})`);
          atlasMinimum=Math.min(atlasMinimum,atlas.minimum);vehicleMinimum=Math.min(vehicleMinimum,speeder.minimum);
        } else check(!world.scene.getObjectByName('atlas-touchdown-dust')!.visible,`space ${t}s has no ground dust`);
        if(t>=2.5&&t<7) {
          let ceilingClear=true,wallClear=true;const v=new THREE.Vector3();
          player.traverse(node=>{if(!(node instanceof THREE.Mesh)||!node.geometry.userData.shared)return;const a=node.geometry.getAttribute('position');for(let i=0;i<a.count;i++){
            v.fromBufferAttribute(a,i).applyMatrix4(node.matrixWorld);const l=atlasLocal(p,v.x,v.z);
            if(l.z>=-8&&l.z<=10){ceilingClear&&=v.y<p.height+5.2;wallClear&&=Math.abs(l.x)<3.95;}
          }});
          check(ceilingClear&&wallClear,`${t}s entire speeder clears the hangar walls and ceiling`);
        }
        if(t===4) {
          const door=new THREE.Box3().setFromObject(ship.getObjectByName('hangar_door')!);
          check(door.min.y>player.position.y+1.25,'open hangar clears the complete speeder');
        }
        if(t===1||t===3||t===5){audio.reset(state);audio.update(state,neutralInput(),true);const diag=audio.diagnostics();check(Object.values(diag.loops).some(v=>v>0),'deployment audio is active');audio.pause();check(Object.values(audio.diagnostics().loops).every(v=>v===0),'pause mutes deployment audio');}
        const transforms=ship.matrixWorld.clone(),before=structuredClone(state);world.render(state,0,0);
        check(ship.matrixWorld.equals(transforms)&&JSON.stringify(state)===JSON.stringify(before),'paused render leaves transforms and simulation frozen');
        await nextFrame();
      }
      check(state.elapsed===0&&state.health===100&&state.distance===0,`${id}/${quality} start has no gameplay cost`);
      if(id==='aster')el('results').textContent+=`Minimum terrain clearance: ATLAS ${atlasMinimum.toFixed(3)} m, Speeder ${vehicleMinimum.toFixed(3)} m\n`;
    }
    const memory=new Map<string,string>();
    for(let i=0;i<12;i++){level=i%2?'belt':'aster';world.setQuality(i%4<2?'high':'standard');world.reset(createState(level,{arrival:true}));pose(2);pose(5);await nextFrame();
      const key=level+'/'+world.quality,now=JSON.stringify(world.renderer.info.memory);if(i>=4&&memory.has(key))check(memory.get(key)===now,'ATLAS resources stable '+key);memory.set(key,now);}
    el('results').textContent+='ALL ATLAS CHECKS PASSED';
  } catch(error){el('results').textContent+='FAIL '+String(error);console.error(error);}
  finally {busy=false;audio.pause();el<HTMLButtonElement>('checks').disabled=false;level='aster';world.reset(createState(level,{arrival:true}));pose(4);}
};
world.ready.then(()=>{loaded=true;world.reset(state);pose(time);}).catch(error=>el('status').textContent=String(error));
window.addEventListener('pagehide',()=>audio.dispose());
