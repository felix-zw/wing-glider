import * as THREE from 'three';
import {World} from '../src/world';
import {LevelEditor} from '../src/editor';
import {BUILTIN_DOCUMENTS,cloneDocument,validateDocument} from '../src/level-document';
import {newSculpt} from '../src/sculpt';
import {type ResourceId} from '../src/resources';
import {saveLevel,savedLevels,saveTemplate,savedTemplates} from '../src/level-storage';
import {packageLevel,parsePackage} from '../src/level-document';

const output=document.querySelector<HTMLElement>('#result')!,button=document.querySelector<HTMLButtonElement>('#run')!;
const world=new World(document.querySelector<HTMLElement>('#viewport')!),editor=new LevelEditor(world,{play:()=>{},close:()=>{},changed:()=>{}}),api=editor as any;
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
function render(){if(editor.active)editor.render();requestAnimationFrame(render);}requestAnimationFrame(render);
const check=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);output.textContent+='\nPASS '+label;};
const pointer=(type:string,p:{x:number;y:number},extra:PointerEventInit={})=>{
  const e=new PointerEvent(type,{clientX:p.x,clientY:p.y,pointerId:77,button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true,...extra});world.renderer.domElement.dispatchEvent(e);return e;
};
async function ready(){await editor.whenReady();for(let i=0;i<300&&api.sculptBusy;i++)await frame();if(api.sculptBusy)throw new Error('Worker timeout');}
function target(){const p=new THREE.Vector3(10,9,21).applyMatrix4(world.editorObjects[0].matrixWorld).project(world.camera),r=world.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};}
function visuals(id:string){const list:THREE.Mesh[]=[];world.scene.traverse(o=>{if(o instanceof THREE.Mesh&&o.userData.depositId===id)list.push(o);});return list;}
const visible=(o:THREE.Object3D):boolean=>o.visible&&(!o.parent||visible(o.parent));
function rendered(id:string,label:string){
  const authored=editor.document.deposits.find(o=>o.id===id),compiled=world.levelWorld.deposits.find(o=>o.id===id),meshes=visuals(id);
  check(!!compiled&&compiled.surface!.cells!.some(c=>c.valid),label+': committed world contains supported ore');
  check(authored?.paint?.cells.length===compiled?.surface?.cells?.length&&Math.abs(authored!.amount-compiled!.remaining)<1e-8,label+': current samples and mass reach the world');
  check(meshes.length===2&&meshes.every(visible),label+': both ore meshes stay visible');
  let draws=0;for(const mesh of meshes)mesh.onBeforeRender=()=>draws++;
  editor.render();check(draws>0,label+': ore reaches the renderer without another click');
}
async function painted(resource:ResourceId,radius:number){
  api.brush.tool='ore';api.brush.resource=resource;api.brush.radius=radius;
  const p=target();pointer('pointerdown',p);for(let i=0;i<22;i++)await frame();
  const pending=api.workingOres?.find((o:any)=>o.id===api.oreLayerId);check(pending?.paint?.cells.length>0,resource+': spray creates surface samples');
  const id=pending.id;pointer('pointerup',p);await ready();editor.render();await frame();
  check(!validateDocument(editor.document).some(i=>i.severity==='error'),resource+' / '+radius+': committed document is valid');
  rendered(id,resource+' / '+radius+' after release');
  return id;
}
async function gestures(){
  const canvas=world.renderer.domElement,p=target(),before=JSON.stringify(editor.document);let bubbled=0;const observe=()=>bubbled++;
  const events=['pointerdown','pointermove','pointerup','mousedown','mousemove','mouseup','contextmenu','auxclick','dragstart'];
  for(const event of events)window.addEventListener(event,observe);
  try{
    for(const input of [{button:2,buttons:2},{button:1,buttons:4},{button:0,buttons:1,altKey:true}]){
      const initial=api.sculptView.yaw;
      const down=pointer('pointerdown',p,input),move=pointer('pointermove',{x:p.x+35,y:p.y+15},input),up=pointer('pointerup',p,{...input,buttons:0});
      check(down.defaultPrevented&&move.defaultPrevented&&up.defaultPrevented,'camera '+input.button+': defaults suppressed throughout gesture');
      check(api.sculptView.yaw!==initial&&!api.sculptDrag&&!api.workingOres,'camera '+input.button+': orbit ends cleanly without spraying');
    }
    for(const type of events.slice(3)){
      const event=new MouseEvent(type,{button:2,bubbles:true,cancelable:true});canvas.dispatchEvent(event);check(event.defaultPrevented,type+': default suppressed');
    }
    check(bubbled===0,'editor gestures do not reach page mouse handlers');
    check(JSON.stringify(editor.document)===before,'camera gestures leave form and ore unchanged');
    pointer('pointerdown',p,{button:2,buttons:2});window.dispatchEvent(new Event('blur'));
    check(!api.sculptDrag,'focus loss releases camera drag');
    api.leaveSculpt();const levelView=api.cameraView.x;api.pendingAsset='sculpt-asteroid';
    pointer('pointerdown',p,{altKey:true});pointer('pointermove',{x:p.x+35,y:p.y+15},{altKey:true});pointer('pointerup',p,{altKey:true});
    check(api.cameraView.x!==levelView&&api.pendingAsset==='sculpt-asteroid'&&JSON.stringify(editor.document)===before,'Alt drag pans the level without placing or moving objects');
    api.pendingAsset=null;editor.active=false;const inactive=pointer('pointerdown',p,{button:2,buttons:2});
    check(!inactive.defaultPrevented&&bubbled===1,'mouse behavior outside the editor is preserved');editor.active=true;
    api.enterSculpt();await ready();editor.render();
  }finally{for(const event of events)window.removeEventListener(event,observe);}
}
async function historyAndCancel(id:string){
  const committed=JSON.stringify(editor.document.deposits);
  api.undo();await ready();check(JSON.stringify(editor.document.deposits)!==committed,'undo removes exactly the last spray stroke');
  api.redo();await ready();check(JSON.stringify(editor.document.deposits)===committed,'redo restores the entire committed layer');rendered(id,'redo');
  for(const cancel of ['Escape','pointercancel','lostpointercapture','blur']){
    const before=JSON.stringify(editor.document.deposits),p=target();pointer('pointerdown',p);for(let i=0;i<4;i++)await frame();
    if(cancel==='Escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    else if(cancel==='blur')window.dispatchEvent(new Event('blur'));else world.renderer.domElement.dispatchEvent(new PointerEvent(cancel,{pointerId:77}));
    await ready();check(JSON.stringify(editor.document.deposits)===before&&!api.sculptDrag,cancel+': unfinished paint is discarded');rendered(id,cancel);
  }
  // Rejected edits keep the previous world; temporary hiding must be undone too.
  const p=target(),name=editor.document.name;pointer('pointerdown',p);for(let i=0;i<4;i++)await frame();
  editor.document.name='x'.repeat(101);api.cancelStroke();let rejected=false;try{await editor.whenReady();}catch(error){rejected=String(error).includes('Ungültiges Leveldokument');}check(rejected,'invalid draft is rejected by the background compiler');while(api.sculptBusy)await frame();
  check(visuals(id).every(visible)&&api.hiddenOre.size===0,'invalid draft fallback restores the previously visible ore');
  editor.document.name=name;api.rebuild();await ready();
}
async function savedEdgeRepair(){
  const pack=packageLevel(editor.document),ore=pack.level.deposits[0],expected=JSON.stringify(ore.paint);
  ore.paint!.cells.push({...structuredClone(ore.paint!.cells[0]),thickness:0});
  await saveLevel(pack);const restored=(await savedLevels()).find(p=>p.level.id===pack.level.id)!;
  check(JSON.stringify(restored.level.deposits[0].paint)===expected,'previously saved empty edge cells are repaired without losing ore');
  check(JSON.stringify(parsePackage(JSON.stringify(pack)).level.deposits[0].paint)===expected,'JSON imports repair the same empty edge cells');
  const template={version:2 as const,id:'editor-interaction-template',name:'Editor-Prüfung',sculpt:pack.level.sculpts!.form,ores:[{resource:ore.resource,amount:ore.amount,paint:ore.paint}]};
  await saveTemplate(template);check(JSON.stringify((await savedTemplates()).find(t=>t.id===template.id)!.ores[0].paint)===expected,'saved templates repair only empty edge cells');
  const objectId=editor.selection;await editor.open(pack.level);api.history.current.selection=objectId;api.enterSculpt();await ready();editor.render();
  check(JSON.stringify(editor.document.deposits[0].paint)===expected,'opening an affected draft restores the complete valid layer');rendered(ore.id,'reopened draft');
}
world.ready.then(()=>{button.disabled=false;output.textContent='Bereit';});
async function cleanup(){
  // These fixed IDs belong exclusively to this QA fixture, never to user drafts.
  if(api.saveTimer)clearTimeout(api.saveTimer);
  const request=indexedDB.open('wing-glider-workshop',3);
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['levels','templates'],'readwrite');
    tx.objectStore('levels').delete('editor-interaction-check');tx.objectStore('templates').delete('editor-interaction-template');
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}
  api.drawUI();
}
button.onclick=async()=>{button.disabled=true;output.textContent='Editor interaction checks';try{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.id='editor-interaction-check';doc.name='Editor-Interaktionsprüfung';
  doc.objects=[{...doc.objects[0],x:0,z:0,rotation:.43,scale:1.25,parameters:{sculptId:'form'}}];doc.sculpts={form:newSculpt('form','block')};doc.deposits=[];doc.delivery={ferrite:0,copper:0,crystal:0};doc.base.x=-90;doc.base.z=-90;doc.spawn={x:65,z:0};
  await editor.open(doc);api.history.current.selection=doc.objects[0].id;api.enterSculpt();await ready();editor.render();
  await gestures();let id='';
  for(const quality of ['high','standard'] as const){output.textContent+='\nQUALITY '+quality;api.leaveSculpt();world.setQuality(quality);api.enterSculpt();await ready();editor.render();
    for(const radius of [7,14.5])for(const resource of ['ferrite','copper','crystal'] as const)id=await painted(resource,radius);
  }
  await historyAndCancel(id);await savedEdgeRepair();
  output.textContent+='\nALL INTERACTION CHECKS PASSED';
}catch(e){output.textContent+='\nFAIL '+String(e);console.error(e);}finally{await cleanup();button.disabled=false;}};
