import {oreMass} from '../src/ore-paint';
import {World} from '../src/world';
import {Color} from 'three';
import {LevelEditor} from '../src/editor';
import {BUILTIN_DOCUMENTS,cloneDocument,packageLevel} from '../src/level-document';
import {THEMES} from '../src/themes';
import {savedLevels,saveLevel,exportLevel,importLevel,savedTemplates,deleteTemplate,upgradeWorkshop} from '../src/level-storage';
import {createState,type State} from '../src/simulation';
import {getLevelWorld,registerLevel} from '../src/levels';

const output=document.getElementById('results')!,run=document.getElementById('run') as HTMLButtonElement;
const world=new World(document.getElementById('viewport')!);
let play:State|null=null,closed=false;
const editor=new LevelEditor(world,{play:id=>{play=createState(id);world.reset(play);},close:()=>{closed=true;},changed:()=>{}});
const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
function check(c:unknown,m:string){if(!c)throw new Error(m);output.textContent+='\nPASS '+m;}
function click(selector:string){const e=document.querySelector<HTMLButtonElement>(selector);if(!e)throw new Error('Missing control '+selector);e.click();}
async function field(selector:string,value:string){const e=document.querySelector<HTMLInputElement|HTMLSelectElement>(selector);if(!e)throw new Error('Missing field '+selector);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));await editor.whenReady();}
const originals=new Set<string>();
async function cleanup(ids:Set<string>){const open=indexedDB.open('wing-glider-workshop',3);const db=await new Promise<IDBDatabase>((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('levels','readwrite');ids.forEach(id=>tx.objectStore('levels').delete(id));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();}
world.ready.then(()=>{output.textContent='Ready · editor, local persistence, live renderer and isolated play state.';run.disabled=false;});
function render(){if(editor.active)editor.render();else if(play)world.render(play,0,0);requestAnimationFrame(render);}requestAnimationFrame(render);
run.onclick=async()=>{
  run.disabled=true;output.textContent='Editor integration checks';const ids=new Set<string>(),templateIds=new Set<string>();
  try{
    const migrationDb='wing-glider-migration-qa-'+crypto.randomUUID();
    const create=indexedDB.open(migrationDb,2);
    create.onupgradeneeded=()=>{create.result.createObjectStore('levels',{keyPath:'level.id'});create.result.createObjectStore('templates',{keyPath:'id'});};
    const oldDb=await new Promise<IDBDatabase>((resolve,reject)=>{create.onsuccess=()=>resolve(create.result);create.onerror=()=>reject(create.error);});
    await new Promise<void>((resolve,reject)=>{const tx=oldDb.transaction(['levels','templates'],'readwrite');
      tx.objectStore('levels').put({version:1,level:{...cloneDocument(BUILTIN_DOCUMENTS[0]),version:1,id:'keep-planet'}});
      tx.objectStore('levels').put({version:1,level:{...cloneDocument(BUILTIN_DOCUMENTS[1]),version:1,id:'retire-space'}});
      tx.objectStore('templates').put({id:'retire-template',version:1});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});oldDb.close();
    const upgraded=indexedDB.open(migrationDb,3);upgraded.onupgradeneeded=e=>upgradeWorkshop(upgraded.result,upgraded.transaction!,e.oldVersion);
    const nextDb=await new Promise<IDBDatabase>((resolve,reject)=>{upgraded.onsuccess=()=>resolve(upgraded.result);upgraded.onerror=()=>reject(upgraded.error);});
    const get=(store:string)=>new Promise<any[]>((resolve,reject)=>{const r=nextDb.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const kept=await get('levels'),retired=await get('templates');
    check(kept.length===1&&kept[0].level.id==='keep-planet'&&kept[0].level.version===2&&kept[0].level.deposits.length===18&&retired.length===0,'Schema upgrade removes old asteroid drafts/templates and preserves the entire planet');
    nextDb.close();indexedDB.deleteDatabase(migrationDb);
    await editor.open(BUILTIN_DOCUMENTS[1]);ids.add(editor.document.id);await frame();
    check(editor.document.id!=='belt'&&editor.document.themeId!== 'belt','Built-in level and theme open as an independent draft');
    click('[data-select="asteroid-0"]');await field('[data-field="rotation"]','30');await field('[data-field="scale"]','1.1');
    check(Math.abs(editor.document.objects[0].rotation-Math.PI/6)<1e-8,'Rotation applies through the visible property control');
    check(editor.document.objects[0].scale===1.1,'Scale applies to the placed asset');
    click('#editor-undo');check(editor.document.objects[0].scale===1.25,'Undo restores scale');click('#editor-redo');check(editor.document.objects[0].scale===1.1,'Redo restores edited scale');
    await field('[data-theme="sunIntensity"]','2.8');await field('[data-theme="background"]','#112233');
    check(THEMES[editor.document.themeId].sunIntensity===2.8&&world.lighting.skyScene.background instanceof Color&&(world.lighting.skyScene.background as Color).getHexString()==='112233','Theme updates the shared game renderer');
    click('#editor-duplicate');check(editor.document.objects.length===6,'Duplicate creates an independent asteroid');
    click('#editor-delete');check(editor.document.objects.length===5,'Delete removes the selected instance and its ores');
    await field('#editor-name','Workshop QA');await editor.persist();
    const saved=(await savedLevels()).find(p=>p.level.id===editor.document.id)!;
    check(saved.level.name==='Workshop QA'&&saved.themes[0].background==='#112233','IndexedDB retains level and custom theme');
    const roundtrip=importLevel(exportLevel(saved));check(JSON.stringify(roundtrip)===JSON.stringify(saved),'JSON import/export preserves the complete package');
    const before=JSON.stringify(editor.document);
    registerLevel({...structuredClone(editor.document),name:'Older storage snapshot'});
    await editor.whenReady();click('#editor-play');await frame();
    check(getLevelWorld(editor.document.id).definition.name===editor.document.name,'Playtest compiles the current document even after an older registry snapshot');
    check(editor.testing&&play?.levelId===editor.document.id,'Playtest starts the current authored level');
    play!.resources.deposits[0].remaining=0;play!.resources.cargo.copper=12;
    click('.editor-resume');await editor.whenReady();await frame();check(editor.active&&JSON.stringify(editor.document)===before,'Returning from play preserves the document and does not save mined ore');
    await editor.whenReady();click('#editor-play');await frame();check(play!.resources.deposits[0].remaining===editor.document.deposits[0].amount&&play!.resources.cargo.copper===0,'Second playtest starts fresh');click('.editor-resume');
    // Rebuild the same world repeatedly; retain shared assets, dispose per-level resources.
    const usage:{geometries:number;textures:number}[]=[];
    for(let i=0;i<6;i++){await field('[data-theme="sunIntensity"]',String(2.8+(i%2)*.1));editor.render();await frame();usage.push({...world.renderer.info.memory});}
    check(usage.slice(2).every(m=>m.geometries===usage[2].geometries&&m.textures===usage[2].textures),'Geometry and texture counts remain stable across repeated editor rebuilds');
    const importData=exportLevel(packageLevel(editor.document));document.querySelector<HTMLTextAreaElement>('#editor-import-text')!.value=importData;click('#editor-import-paste');
    for(let i=0;i<120&&editor.document.id===saved.level.id;i++)await frame();ids.add(editor.document.id);await editor.whenReady();await frame();
    check(editor.document.id!==saved.level.id&&editor.document.name==='Workshop QA','Pasted JSON imports as an independent local level');
    const baseCount=editor.document.objects.length;
    (editor as any).place('sculpt-asteroid',122,94);
    const own=editor.document.objects.at(-1)!;
    editor.document.deposits.push({...structuredClone(BUILTIN_DOCUMENTS[1].deposits[0]),id:'qa-ore',structureId:own.id,paint:structuredClone(BUILTIN_DOCUMENTS[1].deposits[0].paint!)});
    // Use the matching starter so the copied painted surface remains supported.
    const ownSource=editor.document.sculpts![String(own.parameters.sculptId)];Object.assign(ownSource,structuredClone(Object.values(BUILTIN_DOCUMENTS[1].sculpts!)[0]),{id:ownSource.id});
    editor.document.deposits.at(-1)!.amount=oreMass(editor.document.deposits.at(-1)!.paint!);
    await (editor as any).rebuild();
    check(editor.document.objects.length===baseCount+1&&!!editor.document.sculpts?.[String(own.parameters.sculptId)],'A new asteroid owns its editable form inside the level');
    const ownOre=editor.document.deposits.find(d=>d.structureId===own.id)!;
    check(!!ownOre.paint?.cells.length,'Authored ore stores a local surface anchor');
    const templateName='Workshop QA Sculpt '+crypto.randomUUID();
    document.querySelector<HTMLInputElement>('#editor-template-name')!.value=templateName;
    click('#editor-template-save');
    let template=(await savedTemplates()).find(t=>t.name===templateName);
    for(let i=0;i<120&&!template;i++){await frame();template=(await savedTemplates()).find(t=>t.name===templateName);}
    check(!!template&&!!template.ores[0].paint?.cells.length,'Optional template retains shape and anchored ore independently');
    templateIds.add(template!.id);
    for(let i=0;i<120&&!(editor as any).templates.some((t:{id:string})=>t.id===template!.id);i++)await frame();
    (editor as any).place('template:'+template!.id,82,100);
    const first=editor.document.objects.at(-1)!;
    (editor as any).place('template:'+template!.id,-96,100);
    const second=editor.document.objects.at(-1)!;
    const firstSource=editor.document.sculpts![String(first.parameters.sculptId)],secondSource=editor.document.sculpts![String(second.parameters.sculptId)];
    check(first.id!==second.id&&firstSource.id!==secondSource.id&&firstSource.id!==template!.sculpt.id,'Placed templates create independent object and form IDs');
    const ores=editor.document.deposits.filter(d=>d.structureId===first.id||d.structureId===second.id);
    check(ores.length===2&&ores[0].id!==ores[1].id&&ores.every(d=>!!d.paint?.cells.length),'Each template copy owns distinct ore IDs and surface anchors');
    firstSource.strokes.push({tool:'add',center:[12,2,4],radius:6,strength:.8});
    check(secondSource.strokes.length===0&&(await savedTemplates()).find(t=>t.id===template!.id)!.sculpt.strokes.length===0,'Sculpting one placement leaves the other and saved template untouched');
    await deleteTemplate(template!.id);templateIds.delete(template!.id);
    check(editor.document.sculpts?.[firstSource.id]===firstSource&&editor.document.sculpts?.[secondSource.id]===secondSource,'Deleting a template retains both level-owned forms');
    const sculptRoundtrip=importLevel(exportLevel(packageLevel(editor.document)));
    check(JSON.stringify(sculptRoundtrip.level.sculpts)===JSON.stringify(editor.document.sculpts)&&sculptRoundtrip.level.deposits.filter(d=>d.structureId===first.id||d.structureId===second.id).length===2,'JSON imports all local shapes and ore without a template store');
    await editor.persist();
    check(!!(await savedLevels()).find(p=>p.level.id===editor.document.id)?.level.sculpts?.[firstSource.id],'IndexedDB reload retains a sculpted form');
    const orphan=editor.document.deposits.find(d=>d.structureId===second.id)!;orphan.paint!.cells[0].position=[0,0,0];
    click('[data-select="'+second.id+'"]');await (editor as any).rebuild();
    check(!!world.scene.getObjectByName('invalid-ore-support')&&editor.element.textContent!.includes('Stellen ohne Träger'),'Lost ore support is marked in the scene and properties');
    const oldCells=orphan.paint!.cells.length;click('[data-prune-ore="'+orphan.id+'"]');
    check(editor.document.deposits.find(d=>d.id===orphan.id)!.paint!.cells.length<oldCells,'Repair removes unsupported samples only');
    click('#editor-undo');check(editor.document.deposits.find(d=>d.id===orphan.id)!.paint!.cells.length===oldCells,'Repair can be undone without losing ore anchors');
    await editor.open(BUILTIN_DOCUMENTS[0]);ids.add(editor.document.id);await frame();
    click('[data-select="hill-0"]');await field('[data-field="parameter.height"]','35');click('#editor-add-ore');
    check(editor.document.deposits.length===19,'Planet hills and their ore placements can be edited');
    click('[data-select="cliff-0"]');await field('[data-field="rotation"]','15');editor.render();await frame();
    check(Math.abs(getLevelWorld(editor.document.id).solids[0].rotation!-Math.PI/12)<1e-8,'Planet formation rotation reaches terrain and collision data');
    click('#editor-close');await editor.persist();check(closed&&!editor.active,'Editor returns to the game');
    output.textContent+='\n\nALL EDITOR CHECKS PASSED\nGPU memory samples: '+JSON.stringify(usage);
  }catch(error){output.textContent+='\nFAIL '+String(error);console.error(error);}
  finally{
    // Only delete the exact disposable IDs created by this test, never user drafts.
    await new Promise(r=>setTimeout(r,800));for(const id of templateIds)await deleteTemplate(id);await cleanup(ids);run.disabled=false;
  }
};
