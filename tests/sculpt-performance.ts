import * as THREE from 'three';
import {World} from '../src/world';
import {LevelEditor} from '../src/editor';
import {BUILTIN_DOCUMENTS,cloneDocument} from '../src/level-document';
import {newSculpt,SCULPT_SHAPES,type SculptDefinition} from '../src/sculpt';
import {getSculpt} from '../src/sculpt-runtime';
import {THEMES} from '../src/themes';

const button=document.querySelector<HTMLButtonElement>('#run')!,study=document.querySelector<HTMLButtonElement>('#study')!,result=document.querySelector<HTMLElement>('#result')!;
const world=new World(document.querySelector<HTMLElement>('#viewport')!);
const editor=new LevelEditor(world,{play:()=>{},close:()=>{},changed:()=>{}}),api=editor as any;
const plain=document.querySelector<HTMLInputElement>('#plain')!,clay=new THREE.MeshStandardMaterial({color:'#8b9298',roughness:.83});
function showBaseForm(){
  for(const root of world.editorObjects)root.traverse(mesh=>{if(!(mesh instanceof THREE.Mesh))return;
    if(plain.checked){mesh.userData.reviewMaterial??=mesh.material;mesh.userData.reviewDepth??=mesh.customDepthMaterial;mesh.material=clay;mesh.customDepthMaterial=undefined;}
    else if(mesh.userData.reviewMaterial){mesh.material=mesh.userData.reviewMaterial;mesh.customDepthMaterial=mesh.userData.reviewDepth;delete mesh.userData.reviewMaterial;delete mesh.userData.reviewDepth;}
  });
}
plain.onchange=showBaseForm;
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const check=(ok:unknown,label:string)=>{if(!ok)throw new Error(label);result.textContent+='\nPASS '+label;};
function render(){if(editor.active)editor.render();requestAnimationFrame(render);}requestAnimationFrame(render);
async function waitReady(){await editor.whenReady();for(let i=0;i<300&&api.sculptBusy;i++)await frame();if(api.sculptBusy)throw new Error('Worker did not finalize');}
async function open(shape:SculptDefinition['shape']='block'){
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.id='sculpt-study';doc.name='Gesteinsstudie';doc.objects=[{...doc.objects[0],x:0,z:0,scale:1,rotation:0,parameters:{sculptId:'study-form'}}];doc.deposits=[];doc.delivery={ferrite:0,copper:0,crystal:0};doc.base.x=-90;doc.base.z=-90;doc.spawn={x:65,z:0};
  const source=newSculpt('study-form',shape);source.seed=7113;source.name=shape in SCULPT_SHAPES?SCULPT_SHAPES[shape as keyof typeof SCULPT_SHAPES]:shape;doc.sculpts={[source.id]:source};
  await editor.open(doc);api.history.current.selection=doc.objects[0].id;api.enterSculpt();await waitReady();api.sculptView={yaw:.62,pitch:.48};showBaseForm();editor.render();
}
function pointer(type:string,x:number,y:number,extra:PointerEventInit={}){world.renderer.domElement.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:71,button:0,buttons:type==='pointerup'?0:1,bubbles:true,...extra}));}
function target(){const p=new THREE.Vector3(10,9,21).project(world.camera),rect=world.renderer.domElement.getBoundingClientRect();return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};}
async function hold(milliseconds:number,moving=false){const p=target();pointer('pointerdown',p.x,p.y);const start=performance.now();while(performance.now()-start<milliseconds){if(moving)pointer('pointermove',p.x+Math.sin((performance.now()-start)*.015)*30,p.y);await frame();}pointer('pointerup',p.x,p.y);await waitReady();}
world.ready.then(()=>{button.disabled=study.disabled=false;result.textContent='Bereit · einschließlich Mesh-Upload und GPU-Fence.';});
study.onclick=async()=>{await open(document.querySelector<HTMLSelectElement>('#shape')!.value as SculptDefinition['shape']);result.textContent='Form, Material und Erze direkt mit dem Pinsel bearbeiten.';};
document.querySelector<HTMLSelectElement>('#quality')!.onchange=e=>{api.leaveSculpt();world.setQuality((e.target as HTMLSelectElement).value as 'high'|'standard');api.enterSculpt();};
document.querySelector<HTMLButtonElement>('#game')!.onclick=()=>{api.leaveSculpt();api.cameraView={x:0,z:0,zoom:1.1};api.drawUI();};
button.onclick=async()=>{
  button.disabled=true;result.textContent='Echtzeit-Prüfung';
  try{
    await open();world.renderer.setPixelRatio(1);world.resize(1920,1080);world.renderer.domElement.style.width='100vw';world.renderer.domElement.style.height='100vh';editor.render();
    api.brush.tool='subtract';const source=()=>editor.document.sculpts!['study-form'],before=JSON.stringify(source());
    const p=target(),revision=world.levelWorld.revision,mesh=world.editorObjects[0];pointer('pointerdown',p.x,p.y);const start=performance.now();
    while(performance.now()-start<1500)await frame();
    check(api.workingSource?.strokes.length>15,'Stillstehender Pinsel erzeugt laufend Volumenänderungen');
    check(mesh===world.editorObjects[0]&&world.levelWorld.revision===revision,'Vorschau ersetzt nur Objektabschnitte, keine Weltrevision');
    const preview=JSON.stringify(api.previewChunks);for(let i=0;i<20;i++)await frame();
    check(preview!==JSON.stringify(api.previewChunks),'Kuhle vertieft sich bei weiter gehaltenem Pinsel');
    pointer('pointerup',p.x,p.y);await waitReady();const after=JSON.stringify(source());check(after!==before,'Fertiger Strich übernimmt seine aktuelle Revision');
    api.undo();await waitReady();check(JSON.stringify(source())===before,'Ein Rückgängig-Schritt stellt den ganzen Strich zurück');
    api.redo();await waitReady();check(JSON.stringify(source())===after,'Wiederholen stellt den kompletten Strich wieder her');
    pointer('pointerdown',p.x,p.y);for(let i=0;i<8;i++)await frame();api.cancelStroke();await waitReady();
    check(JSON.stringify(source())===after,'Abbrechen verwirft den Strich und ignoriert verspätete Ergebnisse');
    api.brush.tool='add';pointer('pointerdown',p.x,p.y);for(let i=0;i<5;i++)await frame();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',ctrlKey:true}));for(let i=0;i<5;i++)await frame();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',shiftKey:true,ctrlKey:true}));for(let i=0;i<5;i++)await frame();
    check(['add','subtract','smooth'].every(tool=>api.workingSource.strokes.some((s:any)=>s.tool===tool)),'Strg und Umschalt wechseln das Werkzeug auch ohne Mausbewegung');
    window.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift'}));api.cancelStroke();await waitReady();
    api.brush.tool='grab';pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+700,p.y);
    const grabs=api.workingSource.strokes.filter((s:any)=>s.tool==='grab');
    check(grabs.length>1&&grabs.every((s:any)=>s.delta.every((v:number)=>Math.abs(v)<=15)),'Schnelle Ziehbewegung wird vollständig in gültige Teilbewegungen aufgeteilt');
    api.cancelStroke();await waitReady();
    api.brush.tool='paint';api.brush.layer='weathered';await hold(600,true);
    check(source().strokes.some(s=>s.tool==='paint'),'Oberflächenmalerei wird im Formdokument gespeichert');
    api.brush.tool='ore';api.brush.resource='copper';await hold(1200);
    check(editor.document.deposits.some(d=>d.paint?.cells.length&&d.amount>0),'Freies Erzspray erzeugt Schicht, Vorschau und Rohstoffmenge');
    const ores=JSON.stringify(editor.document.deposits);api.undo();await waitReady();check(editor.document.deposits.length===0,'Erzmalerei bildet einen Rückgängig-Schritt');api.redo();await waitReady();check(JSON.stringify(editor.document.deposits)===ores,'Erzschicht wird vollständig wiederhergestellt');
    const compiled=getSculpt(editor.document.id,editor.document.objects[0].id)!,metrics=(window as any).__sculptMetrics;
    check(compiled.high.indices.length/3<=40000&&compiled.standard.indices.length/3<=12000,'Beide Qualitätsstufen halten die Dreiecksgrenzen ein');
    result.textContent+='\n\n'+JSON.stringify({viewport:[world.renderer.domElement.width,world.renderer.domElement.height],inputToGpuP95Ms:metrics.p95,samples:metrics.samples,triangles:{high:compiled.high.indices.length/3,standard:compiled.standard.indices.length/3},drawCalls:world.renderer.info.render.calls,memory:world.renderer.info.memory},null,2);
    result.textContent+='\nALL SCULPT CHECKS PASSED';
  }catch(error){result.textContent+='\nFAIL '+String(error);console.error(error);}finally{button.disabled=false;}
};
