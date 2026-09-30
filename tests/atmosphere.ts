import {World} from '../src/world';
import {LevelEditor} from '../src/editor';
import {BUILTIN_DOCUMENTS,cloneDocument,packageLevel,parsePackage} from '../src/level-document';
import {newSkyBody,newAtmosphere,themeLighting} from '../src/lighting';
import {THEMES} from '../src/themes';
import {saveLevel,savedLevels} from '../src/level-storage';

const output=document.querySelector<HTMLElement>('#results')!,run=document.querySelector<HTMLButtonElement>('#run')!;
const world=new World(document.querySelector<HTMLElement>('#viewport')!),editor=new LevelEditor(world,{play:()=>{},close:()=>{},changed:()=>{}}),api=editor as any;
const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);output.textContent+='\nPASS '+label;};
const click=(id:string)=>document.querySelector<HTMLButtonElement>('#'+id)!.click();
const field=(key:string,value:string)=>{const input=document.querySelector<HTMLInputElement>('[data-light-field="'+key+'"]')!;input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));};
function render(){if(editor.active)editor.render();requestAnimationFrame(render);}requestAnimationFrame(render);
world.ready.then(()=>run.disabled=false);
document.querySelector<HTMLButtonElement>('#hide')!.onclick=()=>document.querySelector<HTMLElement>('#test-controls')!.hidden=true;
run.onclick=async()=>{run.disabled=true;output.textContent='Planet atmosphere integration';try{
  const doc=cloneDocument(BUILTIN_DOCUMENTS[1]);doc.id='atmosphere-qa-'+crypto.randomUUID();doc.name='Ozeanplanet · Atmosphäre';doc.objects=[];doc.deposits=[];doc.sculpts={};doc.delivery={ferrite:0,copper:0,crystal:0};doc.spawn={x:0,z:0};doc.base.x=-90;doc.base.z=60;
  doc.lighting=themeLighting(THEMES.belt);doc.lighting.bodies[0].azimuth=25;doc.lighting.bodies[0].elevation=20;
  const planet=newSkyBody('planet','planet');Object.assign(planet,{azimuth:-90,elevation:-35,size:36,distance:850,illuminates:false,color:'#b8cbd0',air:{...newAtmosphere(),extent:.12,strength:1.5}});doc.lighting.bodies.push(planet);
  await editor.open(doc);document.querySelector<HTMLButtonElement>('[data-light-select="planet"]')!.click();editor.render();
  check(!!document.querySelector('[data-light-field="air.extent"]'),'atmosphere height, strength and color are exposed in planet properties');
  const selected=()=>editor.document.lighting!.bodies.find(b=>b.id==='planet')!,host=world.editorObjects[0],initial=JSON.stringify(selected());
  field('air.extent','25');editor.render();let mesh=api.skyView.bodies.get('planet').children[1];check(selected().air!.extent===.25&&mesh.scale.x===1.25,'percentage height updates the real shell immediately');
  check(selected().size===36&&selected().distance===850&&selected().intensity===.7,'atmosphere editing preserves body size, distance and global light');
  click('editor-undo');check(JSON.stringify(selected())===initial,'atmosphere undo restores exact settings');click('editor-redo');check(selected().air!.extent===.25,'atmosphere redo restores height');
  field('air.strength','2.2');field('air.color','#8ebcff');editor.render();check(mesh.material.uniforms.strength.value===2.2&&mesh.material.uniforms.tint.value.getHexString()==='8ebcff','strength and independent scattering color update existing material');
  const geometry=mesh.geometry;field('air.extent','12');world.setQuality('standard');editor.render();check(mesh.material.uniforms.samples.value===8&&mesh.geometry===geometry,'Standard reduces integration samples without reallocating the shell');world.setQuality('high');editor.render();check(mesh.material.uniforms.samples.value===12,'High restores atmospheric integration detail');
  document.querySelector<HTMLInputElement>('[data-light-field="atmosphere"]')!.click();editor.render();check(!mesh.visible,'disabling atmosphere removes its entire shell');document.querySelector<HTMLInputElement>('[data-light-field="atmosphere"]')!.click();field('air.strength','1.5');
  click('light-duplicate');const duplicate=editor.document.lighting!.bodies.find(b=>b.id===editor.selection)!;check(duplicate.air!==selected().air,'duplicated atmosphere settings are independent');field('air.extent','40');check(selected().air!.extent===.12,'editing a duplicate leaves the original atmosphere unchanged');click('light-delete');document.querySelector<HTMLButtonElement>('[data-light-select="planet"]')!.click();
  const pack=packageLevel(editor.document);await saveLevel(pack);const saved=(await savedLevels()).find(p=>p.level.id===doc.id)!;check(JSON.stringify(saved.level)===JSON.stringify(editor.document)&&JSON.stringify(parsePackage(JSON.stringify(pack)).level)===JSON.stringify(editor.document),'IndexedDB and JSON retain complete atmosphere settings');
  click('sky-game-angle');click('sky-preview');editor.render();await frame();check(api.skyView.preview&&api.skyPreviewState.deployment===null,'atmosphere uses the actual stationary gameplay camera and postprocessing');
  const memories:number[]=[];for(let i=0;i<5;i++){click('sky-preview');editor.render();click('sky-preview');editor.render();await frame();memories.push(world.renderer.info.memory.geometries);}check(memories.at(-1)!<=memories[0]+1,'overview and preview switches retain a stable geometry count');output.textContent+='\nMEMORY '+JSON.stringify(memories);
  for(const quality of ['high','standard'] as const){world.setQuality(quality);for(let i=0;i<15;i++)await frame();const times:number[]=[];for(let i=0;i<90;i++){const start=performance.now();await frame();times.push(performance.now()-start);}times.sort((a,b)=>a-b);output.textContent+='\nFRAME '+JSON.stringify({quality,width:innerWidth,height:innerHeight,medianMs:times[45],p95Ms:times[85],calls:world.renderer.info.render.calls,memory:world.renderer.info.memory});}
  world.setQuality('high');editor.render();check(!world.renderer.info.programs?.some((p:any)=>p.diagnostics&&!p.diagnostics.runnable),'atmosphere and unchanged solar shaders compile on real WebGL');
  output.textContent+='\nALL ATMOSPHERE CHECKS PASSED';
}catch(e){output.textContent+='\nFAIL '+String(e);console.error(e);}finally{if(api.saveTimer)clearTimeout(api.saveTimer);run.disabled=false;}};
