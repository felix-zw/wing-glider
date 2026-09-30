import * as THREE from 'three';
import {World} from '../src/world';
import {LevelEditor} from '../src/editor';
import {BUILTIN_DOCUMENTS,cloneDocument,packageLevel,parsePackage} from '../src/level-document';
import {newSculpt} from '../src/sculpt';
import {newSkyBody,themeLighting,minimumSkyDistance} from '../src/lighting';
import {THEMES} from '../src/themes';
import {saveLevel,savedLevels} from '../src/level-storage';

const output=document.querySelector<HTMLElement>('#results')!,button=document.querySelector<HTMLButtonElement>('#run')!;
const world=new World(document.querySelector<HTMLElement>('#viewport')!),editor=new LevelEditor(world,{play:()=>{},close:()=>{},changed:()=>{}}),api=editor as any;
const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
function render(){if(editor.active)editor.render();requestAnimationFrame(render);}requestAnimationFrame(render);
const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);output.textContent+='\nPASS '+label;};
const click=(selector:string)=>{const el=document.querySelector<HTMLButtonElement>(selector)!;if(!el)throw Error('Missing '+selector);el.click();};
function field(selector:string,value:string){const el=document.querySelector<HTMLInputElement>(selector)!;el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}
function pointer(type:string,p:{x:number;y:number},extra:PointerEventInit={}){return world.renderer.domElement.dispatchEvent(new PointerEvent(type,{clientX:p.x,clientY:p.y,pointerId:88,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true,...extra}));}
function screen(point:THREE.Vector3){return api.skyView.screen(point);}
function selected(){return editor.document.lighting!.bodies.find(b=>b.id===editor.selection)!;}
function startBody(){editor.render();const p=screen(api.skyView.bodies.get(editor.selection).position);pointer('pointerdown',p);check(api.skyView.editing,'selected celestial body starts a drag');return p;}
document.querySelector<HTMLButtonElement>('#hide')!.onclick=()=>document.querySelector<HTMLElement>('#test-controls')!.hidden=true;
world.ready.then(()=>button.disabled=false);
button.onclick=async()=>{button.disabled=true;output.textContent='Spatial sky integration';try{
  const d=cloneDocument(BUILTIN_DOCUMENTS[1]);d.id='sky-qa-'+crypto.randomUUID();d.name='Räumliche Himmelswerkstatt';d.objects=[{...d.objects[0],x:0,z:0,parameters:{sculptId:'demo'}}];d.sculpts={demo:newSculpt('demo','block')};d.deposits=[];d.delivery={ferrite:0,copper:0,crystal:0};d.spawn={x:65,z:0};d.base.x=-85;d.base.z=-65;
  d.lighting=themeLighting(THEMES.belt);const planet=newSkyBody('demo-planet','planet');Object.assign(planet,{azimuth:110,elevation:35,distance:1800,size:32});d.lighting.bodies.push(planet);
  await editor.open(d);const levelView=JSON.stringify(api.cameraView);click('[data-light-select="demo-planet"]');editor.render();await frame();
  check(api.skyMode&&!!document.querySelector('.editor-sky')&&!document.querySelector('#sky-map'),'planet selection opens full spatial viewport instead of SVG');
  check(api.skyView.camera instanceof THREE.PerspectiveCamera&&api.skyView.radius===1800,'perspective camera and hemisphere use the selected distance');
  check(api.skyView.labels.get('sky-main').textContent.includes('unsichtbar'),'hidden illumination source has an editor marker');
  const original=JSON.stringify(editor.document),mesh=world.editorObjects[0],miniature=api.skyView.miniature,revision=world.levelWorld.revision;
  let p=startBody();pointer('pointermove',{x:p.x+35,y:p.y-22});editor.render();
  check(JSON.stringify(editor.document)===original,'live drag leaves the authored document untouched until release');
  check(world.editorObjects[0]===mesh&&api.skyView.miniature===miniature&&world.levelWorld.revision===revision,'live direction preview does not rebuild world or miniature');
  pointer('pointerup',{x:p.x+35,y:p.y-22});const moved=JSON.stringify(editor.document);check(moved!==original&&selected().distance===1800&&selected().elevation>=0,'direction drag commits on the upper shell at fixed distance');
  click('#editor-undo');check(JSON.stringify(editor.document)===original,'direction gesture is exactly one global undo step');click('#editor-redo');check(JSON.stringify(editor.document)===moved,'redo restores the exact direction');
  p=startBody();pointer('pointermove',{x:p.x-45,y:p.y+20});window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));pointer('pointerup',p);check(api.skyMode&&JSON.stringify(editor.document)===moved&&!api.skyView.dragging,'Escape cancels the gesture and stays in sky view');
  p=startBody();pointer('pointermove',{x:p.x+20,y:p.y+15});pointer('pointercancel',p);check(JSON.stringify(editor.document)===moved,'pointer cancellation restores the authored lighting');
  p=startBody();pointer('pointermove',{x:p.x+22,y:p.y});pointer('lostpointercapture',p);check(JSON.stringify(editor.document)===moved,'lost capture restores the authored lighting');
  editor.render();p=screen(api.skyView.distanceHandle.position);const camera=api.skyView.camera.position.clone(),physical=api.skyView.bodies.get('demo-planet').scale.x;
  pointer('pointerdown',p);check(api.skyView.gesture?.kind==='distance','golden rim handle starts a distance gesture');pointer('pointermove',{x:p.x+65,y:p.y});editor.render();
  check(api.skyView.radius>1800&&api.skyView.camera.position.distanceTo(camera)<1e-8,'distance grows while the camera framing stays fixed');
  pointer('pointerup',{x:p.x+65,y:p.y});const farther=JSON.stringify(editor.document);check(selected().distance!>1800&&api.skyView.bodies.get('demo-planet').scale.x===physical,'distance gesture preserves physical planet size');
  check(selected().azimuth===JSON.parse(moved).lighting.bodies.at(-1).azimuth&&selected().intensity===planet.intensity,'distance preserves direction and global light strength');
  click('#editor-undo');check(JSON.stringify(editor.document)===moved,'distance gesture is one undo step');click('#editor-redo');check(JSON.stringify(editor.document)===farther,'distance redo restores the exact radius');
  click('#sky-lower');const mirrored=JSON.stringify(editor.document);check(api.skyView.side===-1&&selected().elevation<0&&selected().distance===JSON.parse(farther).lighting.bodies.at(-1).distance,'lower hemisphere immediately mirrors the selected body at fixed distance');
  const beforeMirrorDrag=JSON.stringify(editor.document);p=startBody();pointer('pointermove',{x:p.x+14,y:p.y-9});pointer('pointercancel',p);check(JSON.stringify(editor.document)===beforeMirrorDrag,'mirrored body is immediately draggable without touching the horizon');
  click('#editor-undo');check(JSON.stringify(editor.document)===farther&&api.skyView.side===1,'mirror undo restores both position and the matching hemisphere');click('#editor-redo');check(JSON.stringify(editor.document)===mirrored&&api.skyView.side===-1,'mirror redo restores position and matching hemisphere');
  const skyCamera=api.skyView.camera.position.clone();click('#editor-sky');check(JSON.stringify(api.cameraView)===levelView&&!api.skyMode,'return to level restores its independent camera');click('#editor-sky');editor.render();check(api.skyView.side===-1&&api.skyView.camera.position.distanceTo(skyCamera)<1e-8,'sky camera and hemisphere survive a level-view round trip');
  const beforeCamera=JSON.stringify(editor.document);p={x:innerWidth/2,y:innerHeight*.7};pointer('pointerdown',p,{altKey:true});pointer('pointermove',{x:p.x+50,y:p.y+18},{altKey:true});pointer('pointerup',p,{altKey:true});check(api.skyView.camera.position.distanceTo(skyCamera)>1,'Alt-left rotates the camera');
  const target=api.skyView.target.clone();pointer('pointerdown',p,{button:1,buttons:4});pointer('pointermove',{x:p.x+20,y:p.y},{button:1,buttons:4});pointer('pointerup',p,{button:1,buttons:0});check(api.skyView.target.distanceTo(target)>1&&JSON.stringify(editor.document)===beforeCamera,'middle drag pans without a document edit');
  click('#editor-undo');check(JSON.stringify(editor.document)===farther,'view gestures introduce no global undo entries');click('#editor-redo');
  for(const distance of [800,20000]){field('[data-light-field="distance"]',String(distance));click('#sky-fit');editor.render();check(api.skyView.radius===distance&&Math.abs(api.skyView.bodies.get('demo-planet').position.length()-distance)<1e-6,'numeric distance and fit at '+distance+' m');}
  field('[data-light-field="distance"]','1800');click('#sky-fit');editor.render();p=screen(api.skyView.distanceHandle.position);pointer('pointerdown',p);pointer('pointermove',{x:p.x+10000,y:p.y});pointer('pointerup',p);check(selected().distance===20000,'radial drag clamps at maximum distance');click('#editor-undo');
  editor.render();p=screen(api.skyView.distanceHandle.position);pointer('pointerdown',p);pointer('pointermove',{x:p.x-10000,y:p.y});pointer('pointerup',p);check(selected().distance===minimumSkyDistance(selected()),'radial drag clamps at minimum distance');click('#editor-undo');
  click('[data-light-select="sky-main"]');check(editor.selection==='sky-main'&&api.skyView.side===1,'hidden light selects its hemisphere and camera');click('[data-light-select="demo-planet"]');
  const beforePlay=JSON.stringify(editor.document),cameraBeforePlay=api.skyView.camera.position.clone(),sideBeforePlay=api.skyView.side;click('#editor-play');check(!editor.active&&editor.testing,'sky design can start a separate play session');api.returnFromTest();editor.render();check(api.skyMode&&api.skyView.side===sideBeforePlay&&api.skyView.camera.position.distanceTo(cameraBeforePlay)<1e-8&&JSON.stringify(editor.document)===beforePlay,'play return preserves sky view, camera, document and selection');
  await saveLevel(packageLevel(editor.document));const saved=(await savedLevels()).find(p=>p.level.id===editor.document.id)!;check(JSON.stringify(saved.level)===beforePlay&&JSON.stringify(parsePackage(JSON.stringify(saved)).level)===beforePlay,'IndexedDB and JSON preserve spatial celestial edits');
  await editor.open(saved.level);click('[data-light-select="demo-planet"]');editor.render();check(selected().elevation<0&&api.skyView.side===-1&&api.skyView.radius===1800,'reloading a lower celestial body restores the correct shell');
  click('#sky-upper');check(selected().elevation>0&&api.skyView.side===1,'upper hemisphere mirrors the body back above the horizon');click('#editor-undo');click('[data-light-select="demo-planet"]');check(api.skyView.side===-1,'reselecting a body focuses its actual hemisphere after undo');
  const memory:number[]=[];for(let i=0;i<5;i++){click('#editor-sky');editor.render();click('#editor-sky');editor.render();await frame();memory.push(world.renderer.info.memory.geometries);}check(memory.at(-1)!<=memory[1]+1,'repeated sky switches do not accumulate GPU geometries');
  const samples:number[]=[];for(let i=0;i<90;i++){const start=performance.now();await frame();samples.push(performance.now()-start);}output.textContent+='\nFRAME '+JSON.stringify({width:innerWidth,height:innerHeight,medianMs:samples.sort((a,b)=>a-b)[45],p95Ms:samples[85],drawCalls:world.renderer.info.render.calls,geometries:memory});
  check(!world.renderer.info.programs?.some((p:any)=>p.diagnostics&&!p.diagnostics.runnable),'shared celestial shaders compile');
  const planetDoc=cloneDocument(BUILTIN_DOCUMENTS[0]);planetDoc.id='sky-planet-qa-'+crypto.randomUUID();await editor.open(planetDoc);click('[data-light-select="sky-main"]');editor.render();check(api.skyMode&&api.skyView.scene.children.length>0,'spatial sky editing also works on Aster');
  await editor.open(saved.level);click('[data-light-select="demo-planet"]');editor.render();output.textContent+='\nALL SPATIAL SKY CHECKS PASSED';
}catch(e){output.textContent+='\nFAIL '+String(e);console.error(e);}finally{if(api.saveTimer)clearTimeout(api.saveTimer);button.disabled=false;}};
