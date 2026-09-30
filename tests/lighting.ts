import * as THREE from 'three';
import {World} from '../src/world';
import {LevelEditor} from '../src/editor';
import {BUILTIN_DOCUMENTS,cloneDocument,packageLevel,parsePackage} from '../src/level-document';
import {newSculpt} from '../src/sculpt';
import {themeLighting,newRockGlow,newSkyBody,newLamp} from '../src/lighting';
import {THEMES} from '../src/themes';
import {saveLevel,savedLevels,savedTemplates,deleteTemplate} from '../src/level-storage';
import {getSculpt} from '../src/sculpt-runtime';
import {createState} from '../src/simulation';
const output=document.querySelector<HTMLElement>('#results')!,button=document.querySelector<HTMLButtonElement>('#run')!;
const world=new World(document.querySelector<HTMLElement>('#viewport')!),editor=new LevelEditor(world,{play:id=>world.reset(createState(id)),close:()=>{},changed:()=>{}}),api=editor as any;
const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));let play:any=null;
function render(){if(editor.active)editor.render();else if(play)world.render(play,.016,0);requestAnimationFrame(render);}requestAnimationFrame(render);
const check=(condition:unknown,label:string)=>{if(!condition)throw Error(label);output.textContent+='\nPASS '+label;};
const click=(selector:string)=>{const b=document.querySelector<HTMLButtonElement>(selector);if(!b)throw Error('Missing '+selector);b.click();};
function field(selector:string,value:string|boolean){const el=document.querySelector<HTMLInputElement|HTMLSelectElement>(selector)!;if(!el)throw Error('Missing '+selector);if(typeof value==='boolean')(el as HTMLInputElement).checked=value;else el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}
async function ready(){await editor.whenReady();for(let i=0;i<400&&api.sculptBusy;i++)await frame();if(api.sculptBusy)throw Error('Worker timeout');editor.render();await frame();}
function select(id:string){api.history.current.selection=id;api.drawUI();}
async function measure(quality:'high'|'standard'){
  world.setQuality(quality);for(let i=0;i<60;i++)await frame();const times:number[]=[];let last=performance.now();for(let i=0;i<120;i++){await frame();const now=performance.now();times.push(now-last);last=now;}
  const sorted=[...times].sort((a,b)=>a-b),stats=world.lighting.stats;
  output.textContent+='\nPERF '+JSON.stringify({quality,fps:1000/(times.reduce((a,b)=>a+b,0)/times.length),p95:sorted[Math.floor(sorted.length*.95)],calls:world.renderer.info.render.calls,memory:world.renderer.info.memory,lights:stats});
  check(stats.point<=(quality==='high'?4:2)&&stats.spot<=(quality==='high'?2:1),quality+': local light budget enforced');
}
document.querySelector<HTMLButtonElement>('#hide')!.onclick=e=>(e.currentTarget as HTMLElement).parentElement!.hidden=true;
world.ready.then(()=>button.disabled=false);
button.onclick=async()=>{button.disabled=true;output.textContent='Lighting integration';const templateIds:string[]=[];try{
  const d=cloneDocument(BUILTIN_DOCUMENTS[1]);d.id='lighting-qa';d.name='Lichtwerkstatt';d.objects=[{...d.objects[0],x:0,z:0,rotation:.2,scale:1,parameters:{sculptId:'demo'}}];d.sculpts={demo:newSculpt('demo','split')};d.deposits=[];d.delivery={ferrite:0,copper:0,crystal:0};d.spawn={x:65,z:0};d.base.x=-90;d.base.z=-90;
  const s=d.sculpts.demo;s.glow=newRockGlow();s.glow.core.enabled=true;s.glow.core.radii=[21,20,22];s.glow.core.intensity=2;s.glow.intensity=2;s.glow.color='#4bc4ff';s.strokes=[{tool:'paint',layer:'glow',center:[-15,10,12],radius:15,strength:1,seconds:.25}];
  d.lighting=themeLighting(THEMES.belt);const planet=newSkyBody('demo-planet','planet');Object.assign(planet,{azimuth:-60,elevation:-34,size:29,intensity:.35});d.lighting.bodies.push(planet);
  const sun=newSkyBody('demo-sun','sun');Object.assign(sun,{azimuth:-135,elevation:-45,size:5,intensity:.3});d.lighting.bodies.push(sun);
  for(const [i,kind] of (['buoy','beacon','floodlight','reactor'] as const).entries()){const p=newLamp('lamp-'+i,kind,-30+i*21,34);p.azimuth=-90;p.elevation=-10;d.lighting.lamps.push(p);}
  await editor.open(d);select(d.objects[0].id);api.enterSculpt();await ready();api.cameraView.zoom=.65;editor.render();
  const mesh=world.editorObjects[0],geometry=mesh.geometry,revision=world.levelWorld.revision;
  field('[data-glow-field="core.intensity"]','3');check(world.editorObjects[0]===mesh&&mesh.geometry===geometry&&world.levelWorld.revision===revision,'emission settings update without rebuilding terrain or collision');
  check((mesh.material as THREE.MeshStandardMaterial).userData.glowUniforms.corePower.value===3,'core shader uniform changes immediately');
  world.setQuality('standard');editor.render();await frame();check((mesh.material as THREE.MeshStandardMaterial).userData.glowUniforms.corePower.value===3,'quality switch preserves uncompiled live glow edits');world.setQuality('high');
  api.leaveSculpt();const lampMesh=world.editorObjects[0];select('lamp-0');field('[data-light-field="intensity"]','260');check(world.editorObjects[0]===lampMesh,'lamp edits retain the existing terrain mesh');
  const before=JSON.stringify(editor.document.lighting);api.undo();check(world.editorObjects[0]===lampMesh,'light undo retains terrain mesh');check(JSON.stringify(editor.document.lighting)!==before,'lamp edit undo');api.redo();check(JSON.stringify(editor.document.lighting)===before,'lamp edit redo');
  click('[data-light-select="demo-planet"]');check(api.skyMode&&!!document.querySelector('.editor-sky'),'planet selection opens spatial sky view');
  field('[data-light-field="size"]','18');editor.render();check(Math.abs((world.lighting as any).bodies.get('demo-planet').scale.x-Math.tan(Math.PI/20)*1000)<.001,'planet angular size updates immediately');
  field('[data-light-field="visible"]',false);check(editor.document.lighting!.bodies.find(b=>b.id==='demo-planet')!.illuminates,'invisible planet keeps its lighting');field('[data-light-field="visible"]',true);
  click('#editor-sky');check(!api.skyMode,'sky view returns to level camera');
  select(d.objects[0].id);api.enterSculpt();await ready();api.cameraView.zoom=.65;editor.render();
  const n=getSculpt(editor.document.id,d.objects[0].id)!.high.positions.length;api.brush.tool='paint';api.brush.layer='glow';api.brush.radius=10;
  const canvas=world.renderer.domElement,r=canvas.getBoundingClientRect(),p=new THREE.Vector3(-15,10,12).applyMatrix4(world.editorObjects[0].matrixWorld).project(world.camera),x=r.left+(p.x+1)*r.width/2,y=r.top+(1-p.y)*r.height/2;
  const pointer=(type:string,ctrl=false)=>canvas.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:88,button:0,buttons:type==='pointerup'?0:1,ctrlKey:ctrl,bubbles:true,cancelable:true}));
  pointer('pointerdown');for(let i=0;i<25;i++)await frame();pointer('pointerup');await ready();
  check(editor.document.sculpts!.demo.strokes.length>1,'glow brush stroke commits');check(getSculpt(editor.document.id,d.objects[0].id)!.high.positions.length===n,'glow brush preserves geometry');
  pointer('pointerdown',true);for(let i=0;i<8;i++)await frame();pointer('pointerup',true);await ready();check(editor.document.sculpts!.demo.strokes.some(p=>p.erase),'Ctrl commits an erase mask stroke');
  api.brush.tool='ore';api.brush.resource='crystal';pointer('pointerdown');for(let i=0;i<20;i++)await frame();pointer('pointerup');await ready();
  const ore=editor.document.deposits[0];check(!!ore,'spray creates an ore layer in lit scene');api.lightChange((doc:any)=>doc.deposits[0].emission={color:'#58ffbd',intensity:4});
  const cells=api.state.resources.deposits[0].surface.cells;cells[0].mass*=.5;api.state.resources.deposits[0].remaining-=cells[0].initialMass*.5;editor.render();
  let oreMesh:THREE.InstancedMesh|undefined;world.scene.traverse(o=>{if(o instanceof THREE.InstancedMesh&&o.userData.depositId===ore.id)oreMesh=o;});
  check(oreMesh?.geometry.getAttribute('oreEmission').getX(0)===.5,'only mined ore cells reduce their emitted light');check(ore.paint!.cells[0].thickness>0,'mining preview does not mutate the authored ore');
  const original=JSON.stringify(editor.document);await saveLevel(packageLevel(editor.document));const saved=(await savedLevels()).find(p=>p.level.id==='lighting-qa')!;check(JSON.stringify(saved.level)===original,'IndexedDB preserves complete lighting and glow');check(JSON.stringify(parsePackage(JSON.stringify(saved)).level)===original,'JSON light package round trip');
  await api.saveSelectedTemplate();const template=(await savedTemplates()).find(t=>t.name===editor.document.sculpts!.demo.name)!;templateIds.push(template.id);check(!!template.sculpt.glow&&template.ores[0].emission?.intensity===4,'template stores rock and ore glow');
  api.leaveSculpt();api.templates=[template];api.place('template:'+template.id,85,85);const copy=editor.document.objects.at(-1)!;check(editor.document.sculpts![String(copy.parameters.sculptId)].glow!.core.intensity===3,'inserted template retains independent core glow');check(editor.document.deposits.at(-1)!.emission!.intensity===4,'inserted template retains ore glow');
  await deleteTemplate(template.id);templateIds.length=0;check(!!editor.document.sculpts![String(copy.parameters.sculptId)].glow,'deleting template does not change inserted glow');
  api.remove();select(d.objects[0].id);api.enterSculpt();await ready();api.cameraView.zoom=.65;
  for(const quality of ['high','standard'] as const)await measure(quality);
  const authoredLights=structuredClone(editor.document.lighting!);
  api.leaveSculpt();api.lightChange((doc:any)=>{for(let i=0;i<32;i++){const p=newLamp('dense-'+i,i%6===0?'floodlight':'buoy',Math.cos(i*2.4)*65,Math.sin(i*2.4)*65);p.height=5+i%7;doc.lighting.lamps.push(p);}});
  api.play();check(!editor.active&&editor.testing,'valid design starts an isolated play session');play=createState(editor.document.id);play.x=0;play.z=50;
  output.textContent+='\nDENSE PLAY '+innerWidth+'x'+innerHeight;
  for(const quality of ['high','standard'] as const)await measure(quality);
  play=null;api.returnFromTest();api.lightChange((doc:any)=>doc.lighting=authoredLights);
  const spacePack=packageLevel(editor.document),planetDoc=cloneDocument(BUILTIN_DOCUMENTS[0]);planetDoc.id='lighting-planet-qa';planetDoc.lighting=themeLighting(THEMES.aster);planetDoc.lighting.lamps=[newLamp('planet-beacon','beacon',planetDoc.spawn.x+10,planetDoc.spawn.z)];await editor.open(planetDoc);editor.render();
  check(world.lighting.objects.length===1&&world.levelWorld.definition.environment==='planet','local lamps and sky lighting also render on Aster');await editor.open(spacePack.level);select(d.objects[0].id);

  const memory:number[]=[];for(let i=0;i<4;i++){api.leaveSculpt();api.play();check(!editor.active,'play cycle starts');play=createState(editor.document.id);for(let f=0;f<4;f++)await frame();play=null;api.returnFromTest();select(d.objects[0].id);api.enterSculpt();await ready();editor.render();memory.push(world.renderer.info.memory.geometries);}check(memory[3]<=memory[1]+2,'repeated editor/play returns do not accumulate geometry');
  output.textContent+='\nMEMORY '+JSON.stringify(memory);api.cameraView.zoom=.65;world.setQuality('high');editor.render();
  check(!world.renderer.info.programs?.some((p:any)=>p.diagnostics&&!p.diagnostics.runnable),'all lighting and glow shaders compile');output.textContent+='\nALL LIGHTING CHECKS PASSED';
}catch(e){output.textContent+='\nFAIL '+String(e);console.error(e);}finally{if(api.saveTimer)clearTimeout(api.saveTimer);for(const id of templateIds)await deleteTemplate(id);button.disabled=false;}};
