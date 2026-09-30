import './editor.css';
import {themeLighting,newRockGlow,newLamp,type LampKind,lightingErrors} from './lighting';
import {lightingPalette,lightProperties,glowProperties,skyOverlay,bindLightEditor} from './lighting-editor';
import {SkyEditor} from './sky-editor';
import * as THREE from 'three';
import {World} from './world';
import {disposeObject} from './assets';
import {ASSET_CATALOG} from './asset-catalog';
import {BUILTIN_DOCUMENTS,cloneDocument,newDocument,packageLevel,validateDocument,type LevelDocument,type PlacedObject,type LevelPackage} from './level-document';
import {THEMES,type ThemeDefinition} from './themes';
import {installLevel,getLevelWorld,groundHeight,getSolidFootprint,type LevelWorld} from './levels';
import {createState,type State} from './simulation';
import {RESOURCES,type ResourceId} from './resources';
import {oreMass,sprayOre,resolveOreCell,pruneEmptyOreCells,type Triple} from './ore-paint';
import {createPaintedOre} from './painted-ore';
import {crystalGeometry} from './ore-outcrop';
import {EditorHistory,inspectLevel} from './editor-model';
import {saveLevel,savedLevels,exportLevel,importLevel,saveTemplate,savedTemplates,deleteTemplate,type SculptTemplate} from './level-storage';
import {newSculpt,SCULPT_SHAPES,type SculptDefinition,type SculptStroke,type SculptTool,type PaintLayer,type SculptCompiled,type SculptMesh} from './sculpt';
import {installSculpt,sculptGeometry,getSculpt,registeredSculptKey} from './sculpt-runtime';
import {unpackSculpt} from './sculpt-transfer';
import type {EditorWorldRequest,EditorWorldResult} from './editor-world-worker';
import {SnapshotWriter} from './snapshot-writer';
import {DEFAULT_GENERATOR,type GeneratorAction,type GenerationRequest,type GenerationResult} from './asteroid-generator';
import {generatorPalette,generatorSelection,type GeneratorSettings} from './generator-editor';

export const escapeHtml=(value:unknown)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const uid=(prefix:string)=>prefix+'-'+crypto.randomUUID();
export class LevelEditor {
  readonly element=document.createElement('section');
  active=false;testing=false;
  private history!:EditorHistory;private state!:State;private markers=new THREE.Group();
  private ray=new THREE.Raycaster();private plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  private cameraView={x:0,z:0,zoom:.32};private pendingAsset:string|null=null;
  private drag:{id:string|null;start:THREE.Vector3;last:THREE.Vector3;camera:THREE.Camera;view:{x:number;z:number;zoom:number}}|null=null;
  private saveTimer:ReturnType<typeof setTimeout>|null=null;private rebuildTimer:ReturnType<typeof setTimeout>|null=null;
  private returnButton=document.createElement('button');private issues:ReturnType<typeof inspectLevel>=[];
  private sculptMode=false;private sculptView={yaw:.55,pitch:.35};private levelCamera={x:0,z:0,zoom:.32};
  private brush:{tool:SculptTool;layer:PaintLayer;radius:number;strength:number;falloff:number;resource:ResourceId;thickness:number}={tool:'add',layer:'coarse',radius:7,strength:.7,falloff:.5,resource:'ferrite',thickness:1};
  private sculptDrag:{points:SculptStroke[];last:THREE.Vector3;normal:[number,number,number];startX:number;startY:number;button:number}|null=null;
  private sculptCursor=new THREE.Mesh(new THREE.SphereGeometry(1,16,12),new THREE.MeshBasicMaterial({color:'#d8f1bf',wireframe:true,transparent:true,opacity:.72,depthTest:false}));
  private sculptWorker:Worker|null=null;private sculptRevision=0;private sculptBusy=false;
  private workerInFlight=false;private workerReady=false;private sequence=0;
  private strokeQueue:SculptStroke[]=[];private workingSource:SculptDefinition|null=null;private workingOres:LevelDocument['deposits']|null=null;
  private previewChunks:Record<string,SculptMesh>={};private pointer:PointerEvent|null=null;private lastBrushTime=0;
  private modifiers={shift:false,ctrl:false};
  private inputStarted=0;private queuedAt=0;private previewReadyAt=0;private previewSamples:number[]=[];private previewFences:{sync:WebGLSync;start:number}[]=[];
  private orePreview=new THREE.Group();private oreLayerId:string|null=null;
  private hiddenOre=new Map<THREE.Object3D,boolean>();
  private templates:SculptTemplate[]=[];
  private skyMode=false;private skyReturn={x:0,z:0,zoom:.32};private skyView:SkyEditor;private skyBeforeTest=false;private skyPreviewState:State|null=null;
  private generator:GeneratorSettings={...DEFAULT_GENERATOR,seed:7113,autoSeed:true,extras:true};
  private generation:{worker:Worker;object:PlacedObject;source:SculptDefinition;newObject:boolean;action:GeneratorAction;options:GeneratorSettings;targetBefore:string;selectionBefore:string|null;result?:GenerationResult;finish?:(result:GenerationResult)=>void}|null=null;
  private worldWorker:Worker;private worldRevision=0;private appliedWorldRevision=0;private worldInFlight=false;
  private queuedWorld:EditorWorldRequest|null=null;private completedWorld:EditorWorldResult|null=null;
  private worldWaiters:{revision:number;resolve:()=>void;reject:(error:unknown)=>void}[]=[];
  private storageWorker:Worker;private writer:SnapshotWriter<LevelPackage>;private saveRevision=0;private maxSaveTimer:ReturnType<typeof setTimeout>|null=null;
  private savedPacks:LevelPackage[]=[];
  private openEpoch=0;private opening=false;
  private cookedWorld:LevelWorld|null=null;
  get pendingWorld(){return this.appliedWorldRevision!==this.worldRevision;}
  whenReady(){if(!this.pendingWorld)return Promise.resolve();return new Promise<void>((resolve,reject)=>this.worldWaiters.push({revision:this.worldRevision,resolve,reject}));}
  constructor(private world:World,private callbacks:{play:(id:string)=>void;close:()=>void;changed:()=>void;failed?:(error:unknown)=>void}){
    this.worldWorker=new Worker(new URL('./editor-world-worker.ts',import.meta.url),{type:'module'});
    this.worldWorker.onmessage=(event:MessageEvent<EditorWorldResult>)=>{this.worldInFlight=false;if(this.active&&event.data.revision===this.worldRevision){this.completedWorld=event.data;this.applyCompletedWorld();}this.pumpWorld();};
    this.worldWorker.onerror=()=>{this.worldInFlight=false;this.completedWorld={revision:this.worldRevision,issues:[],sculpts:[],computeMs:0,error:'Die Hintergrundberechnung ist fehlgeschlagen.'};this.applyCompletedWorld();};
    this.storageWorker=new Worker(new URL('./editor-storage-worker.ts',import.meta.url),{type:'module'});
    this.writer=new SnapshotWriter((pack,revision)=>new Promise<void>((resolve,reject)=>{this.storageWorker.onmessage=(event:MessageEvent<{revision:number;error?:string}>)=>{if(event.data.revision!==revision)return;event.data.error?reject(new Error(event.data.error)):resolve();};this.storageWorker.onerror=()=>reject(new Error('Speicher-Worker fehlgeschlagen.'));this.storageWorker.postMessage({revision,pack});}),pack=>pack.level.id);
    this.skyView=new SkyEditor({select:id=>this.selectSkyBody(id),preview:body=>{const d=structuredClone(this.document);Object.assign(d.lighting!.bodies.find(b=>b.id===body.id)!,body);this.lightPreview(d);},commit:body=>this.lightChange(d=>Object.assign(d.lighting!.bodies.find(b=>b.id===body.id)!,body)),restore:()=>this.lightPreview(this.document)});
    this.element.className='editor-shell';this.element.hidden=true;this.element.setAttribute('aria-label','Level-Editor');document.body.append(this.element);
    this.returnButton.className='editor-resume';this.returnButton.textContent='↩ Zurück zum Editor';this.returnButton.hidden=true;document.body.append(this.returnButton);
    this.returnButton.onclick=()=>this.returnFromTest();world.scene.add(this.markers);
    this.sculptCursor.visible=false;this.sculptCursor.renderOrder=30;world.scene.add(this.sculptCursor);
    const canvas=world.renderer.domElement;
    // Claim the gesture from pointerdown, before compatibility mouse events can
    // start browser/extension gestures. Context-menu cancellation alone is late.
    for(const type of ['pointerdown','pointermove','pointerup'] as const)canvas.addEventListener(type,e=>{
      if(!this.active||this.opening)return;e.preventDefault();e.stopPropagation();
      if(type==='pointerdown')this.pointerDown(e);else if(type==='pointermove')this.pointerMove(e);else this.pointerUp(e);
    },{capture:true,passive:false});
    for(const type of ['mousedown','mousemove','mouseup','contextmenu','auxclick','dragstart'])canvas.addEventListener(type,e=>{
      if(this.active){e.preventDefault();e.stopImmediatePropagation();}
    },{capture:true,passive:false});
    canvas.addEventListener('pointercancel',()=>{this.skyView.cancel();this.cancelPlacement();this.cancelStroke();});
    canvas.addEventListener('lostpointercapture',()=>{this.skyView.cancel();this.cancelPlacement();if(this.sculptDrag?.button===0)this.cancelStroke();else this.sculptDrag=null;});
    canvas.addEventListener('wheel',e=>{if(!this.active||this.opening)return;e.preventDefault();if(this.skyMode){this.skyView.wheel(e.deltaY);return;}if(!this.sculptMode&&this.cameraView.zoom<=.19&&e.deltaY>0){this.toggleSky();return;}this.cameraView.zoom=THREE.MathUtils.clamp(this.cameraView.zoom*Math.exp(-e.deltaY*.001),this.sculptMode?.45:.18,this.sculptMode?4:3);this.world.setEditorView(this.view());},{passive:false});
    window.addEventListener('keydown',e=>{this.modifiers={shift:e.shiftKey,ctrl:e.ctrlKey};this.key(e);});
    window.addEventListener('keyup',e=>{this.modifiers={shift:e.shiftKey,ctrl:e.ctrlKey};});
    window.addEventListener('blur',()=>{this.skyView.cancel();this.modifiers={shift:false,ctrl:false};this.cancelPlacement();if(this.sculptDrag?.button===0)this.cancelStroke();else this.sculptDrag=null;});
    if(typeof Worker!=='undefined'){
      this.sculptWorker=new Worker(new URL('./sculpt-worker.ts',import.meta.url),{type:'module'});
      this.sculptWorker.onmessage=(event:MessageEvent<{epoch:number;sequence:number;kind:string;chunks?:Record<string,SculptMesh>;compiled?:SculptCompiled;error?:string}>)=>{
        const data=event.data;if(data.epoch!==this.sculptRevision)return;
        this.workerInFlight=false;
        if(data.error){this.cancelStroke();this.setStatus(data.error);return;}
        this.workerReady=true;
        if(data.chunks){this.applyPreview(data.chunks);if(data.kind==='append'&&this.inputStarted)this.previewReadyAt=this.inputStarted;}
        this.sculptBusy=!!this.workingSource||!!this.workingOres;this.pumpSculpt();if(data.kind==='reset'){const play=this.element.querySelector<HTMLButtonElement>('#editor-play');if(play)play.disabled=this.pendingWorld||this.issues.some(i=>i.severity==='error');this.setStatus('Pinsel bereit');}
      };
    }
  }
  private view(){return {...this.cameraView,...(this.sculptMode?{orbit:this.sculptView}:{})};}
  get document(){return this.history.current.level;}
  get selection(){return this.history.current.selection;}
  private launch(source:LevelDocument){void this.open(source).catch(error=>{if(this.callbacks.failed)this.callbacks.failed(error);else{console.error(error);this.callbacks.close();}});}
  async open(source:LevelDocument=BUILTIN_DOCUMENTS[1]){
    if(this.history&&!this.opening)void this.persist();this.opening=true;this.element.inert=true;this.element.setAttribute('aria-busy','true');this.drag=null;this.pendingAsset=null;const epoch=++this.openEpoch;
    this.cancelWorld();
    this.cancelGeneration();
    this.skyView.reset();this.skyBeforeTest=false;
    this.cancelPendingSculpt();this.clearOrePreview();this.sculptDrag=null;
    let level=cloneDocument(source),theme=structuredClone(THEMES[level.themeId]);
    level.deposits.forEach(ore=>pruneEmptyOreCells(ore.paint));level.lighting??=themeLighting(theme);this.skyMode=false;
    if(BUILTIN_DOCUMENTS.some(d=>d.id===level.id)){level.id=uid('level');level.name+=' · Entwurf';}
    // Every edited document owns its theme variant; built-ins remain immutable.
    if(!level.themeId.startsWith('theme-')){theme.id=uid('theme');theme.name+=' · Variante';level.themeId=theme.id;}
    this.history=new EditorHistory({level,theme,selection:null});this.cameraView={x:level.spawn.x,z:level.spawn.z,zoom:.32};this.sculptMode=false;this.sculptCursor.visible=false;
    this.active=true;this.testing=false;
    try{await this.rebuild(true);if(epoch!==this.openEpoch)return;this.opening=false;this.element.inert=false;this.element.removeAttribute('aria-busy');this.element.hidden=false;document.body.classList.add('editor-open');this.scheduleSave();void this.refreshLibrary();}
    catch(error){if(epoch!==this.openEpoch)return;this.abort();throw error;}
  }
  /** An incomplete launch must never leave an empty shell hiding the menus. */
  abort(){this.opening=false;this.element.inert=false;this.element.removeAttribute('aria-busy');this.openEpoch++;this.cancelWorld();this.cancelGeneration();this.cancelPendingSculpt();this.clearOrePreview();this.skyView.cancel();if(this.saveTimer)clearTimeout(this.saveTimer);if(this.maxSaveTimer)clearTimeout(this.maxSaveTimer);this.active=false;this.testing=false;this.element.hidden=true;this.returnButton.hidden=true;this.markers.visible=false;this.sculptCursor.visible=false;this.world.setEditorView(null);document.body.classList.remove('editor-open');}
  private cancelWorld(){this.appliedWorldRevision=++this.worldRevision;this.queuedWorld=this.completedWorld=null;const waiters=this.worldWaiters.splice(0);waiters.forEach(w=>w.reject(new Error('Bearbeitung abgebrochen.')));}
  private cancelPlacement(){if(!this.drag)return;this.drag=null;this.world.clearEditorPlacement();this.previewDraft();this.drawMarkers();this.applyCompletedWorld();}
  private toggleSky(force?:boolean){
    if(this.sculptBusy)return;const next=force??!this.skyMode;if(next===this.skyMode)return;
    this.skyView.cancel();if(!next){this.skyView.alignRing(false);this.skyView.setPreview(false);}
    if(next){if(this.sculptMode)this.leaveSculpt();this.skyReturn={...this.cameraView};if(!this.document.lighting!.bodies.some(b=>b.id===this.selection))this.history.current.selection=this.document.lighting!.bodies[0]?.id??null;}else this.cameraView={...this.skyReturn};
    this.skyMode=next;this.world.setEditorView(this.view());this.drawUI();
  }
  private selectSkyBody(id:string){
    if(this.sculptBusy)return;this.skyView.alignRing(false);if(this.sculptMode)this.leaveSculpt();this.history.current.selection=id;this.pendingAsset=null;this.toggleSky(true);this.world.lighting.select(id);this.skyView.sync(this.document,id);this.skyView.focus();this.drawUI();this.drawMarkers();
  }
  private mirrorSkySide(side:1|-1){this.skyView.cancel();const body=this.document.lighting!.bodies.find(b=>b.id===this.selection);if(body&&body.elevation*side<0)this.lightChange(doc=>{doc.lighting!.bodies.find(b=>b.id===body.id)!.elevation=Math.abs(body.elevation)*side;});this.skyView.setSide(side);this.drawUI();}
  private lightChange(edit:(doc:LevelDocument)=>void){
    if(this.sculptBusy)return;this.skyView.cancel();const next=structuredClone(this.document);edit(next);const errors=lightingErrors(next.lighting!);if(errors.length){this.drawUI();this.setStatus(errors[0]);return;}
    this.history.change(s=>{s.level=next;});this.lightPreview(this.document);this.drawUI();this.scheduleSave();
  }
  private lightPreview(doc:LevelDocument){
    this.world.previewLighting(doc);this.world.lighting.select(this.selection);
    if(!this.skyView.dragging)this.skyView.sync(doc,this.selection);
    for(const ore of this.state.resources.deposits)ore.emission=structuredClone(doc.deposits.find(o=>o.id===ore.id)?.emission);
  }
  private setStatus(message:string){const el=this.element.querySelector('#editor-save-status');if(el)el.textContent=message;}
  private scheduleSave(){this.saveRevision++;if(this.saveTimer)clearTimeout(this.saveTimer);this.setStatus('Änderungen …');this.saveTimer=setTimeout(()=>void this.persist(),650);this.maxSaveTimer??=setTimeout(()=>void this.persist(),2500);}
  async persist(){
    if(!this.history)return;if(this.saveTimer)clearTimeout(this.saveTimer);if(this.maxSaveTimer)clearTimeout(this.maxSaveTimer);this.saveTimer=this.maxSaveTimer=null;
    const revision=this.saveRevision,pack:LevelPackage={version:2,level:this.document,themes:[this.history.current.theme]};
    try{await this.writer.save(pack,revision);if(revision!==this.saveRevision)return;this.savedPacks=this.savedPacks.filter(p=>p.level.id!==pack.level.id).concat(pack);if(!this.sculptDrag&&!this.opening)this.setStatus('Lokal gespeichert');this.drawLibrary();this.callbacks.changed();}
    catch{if(revision===this.saveRevision)this.setStatus('Speichern fehlgeschlagen · bitte JSON exportieren');}
  }
  private change(edit:(doc:LevelDocument,theme:ThemeDefinition)=>void,refresh=true){
    if(this.workingSource||this.workingOres)return;
    const previous=this.history.current;this.history.change(s=>edit(s.level,s.theme));if(this.history.current===previous)return;THEMES[this.document.themeId]=structuredClone(this.history.current.theme);
    if(refresh){this.rebuild();if(this.sculptMode)this.resetWorker();}else{if(this.rebuildTimer)clearTimeout(this.rebuildTimer);this.rebuildTimer=setTimeout(()=>this.rebuild(),180);}
    this.scheduleSave();
  }
  private rebuild(initial=false){
    this.skyPreviewState=null;
    THEMES[this.document.themeId]=structuredClone(this.history.current.theme);
    this.issues=validateDocument(this.document);this.previewDraft();if(this.state?.levelId===this.document.id)this.lightPreview(this.document);
    const revision=++this.worldRevision;this.queuedWorld={revision,document:this.document,theme:this.history.current.theme,known:Object.fromEntries(this.document.objects.map(o=>[o.id,registeredSculptKey(this.document.id,o.id)]))};this.completedWorld=null;
    this.drawUI();if(this.opening)this.setStatus('Level wird vorbereitet …');this.drawMarkers();this.pumpWorld();const ready=this.whenReady();return initial?ready:ready.catch(()=>{});
  }
  private pumpWorld(){if(this.worldInFlight||!this.queuedWorld)return;const job=this.queuedWorld;this.queuedWorld=null;this.worldInFlight=true;this.worldWorker.postMessage(job);}
  private previewDraft(){const job=this.generation;this.world.previewEditorDraft(job?.newObject?{...this.document,objects:[...this.document.objects,job.object],sculpts:{...this.document.sculpts,[job.source.id]:job.source}}:this.document);}
  private applyCompletedWorld(){
    const result=this.completedWorld;if(!result||result.revision!==this.worldRevision||this.workingSource||this.workingOres||this.drag||this.skyView.dragging||this.sculptMode&&(this.workerInFlight||this.strokeQueue.length))return;this.completedWorld=null;
    this.appliedWorldRevision=result.revision;const waiters=this.worldWaiters.filter(w=>w.revision<=result.revision);this.worldWaiters=this.worldWaiters.filter(w=>w.revision>result.revision);
    if(result.error){this.issues=[{severity:'error',message:result.error}];this.drawUI();this.setStatus(result.error);waiters.forEach(w=>w.reject(new Error(result.error)));return;}
    try{
      if(result.anchors?.length){const updates=result.anchors;this.history.current.level={...this.document,deposits:this.document.deposits.map(ore=>{const update=updates.find(u=>u.id===ore.id);if(!update||!ore.paint)return ore;const copy=structuredClone(ore);for(const cell of update.cells){copy.paint!.cells[cell.index].position=cell.position;copy.paint!.cells[cell.index].normal=cell.normal;}return copy;})};this.scheduleSave();}
      for(const entry of result.sculpts){const object=this.document.objects.find(o=>o.id===entry.objectId)!;installSculpt(this.document.id,object.id,this.sculptSource(object)!,unpackSculpt(entry.compiled),object.scale);}
      const cooked=result.world!;cooked.lighting=structuredClone(this.document.lighting!);this.cookedWorld=installLevel(this.document,cooked);this.issues=result.issues;this.state=createState(this.document.id);
      this.world.applyEditorWorld(this.state,this.document);this.previewDraft();this.clearOrePreview();this.world.setEditorView(this.view());this.lightPreview(this.document);this.updateCookedUI();this.drawMarkers();waiters.forEach(w=>w.resolve());
    }catch(error){waiters.forEach(w=>w.reject(error));this.setStatus(String(error));}
  }
  private updateCookedUI(){
    const play=this.element.querySelector<HTMLButtonElement>('#editor-play');if(play)play.disabled=!!this.generation||this.sculptBusy||this.issues.some(i=>i.severity==='error');
    const title=this.element.querySelector('#editor-issue-title');if(title)title.textContent='Prüfung · '+this.issues.length;
    const list=this.element.querySelector('#editor-issues');if(list)list.innerHTML=this.issues.length?this.issues.map(i=>'<li class="'+i.severity+'">'+escapeHtml(i.message)+'</li>').join(''):'<li>Start, ATLAS und Erzstellen sind erreichbar.</li>';
    const object=this.document.objects.find(o=>o.id===this.selection),ores=this.element.querySelector('#editor-ore-panel');if(object&&ores){ores.innerHTML=this.oreUI(object);this.bindOres(object);}
    this.element.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(b=>b.classList.toggle('has-warning',this.issues.some(i=>i.objectId===b.dataset.select)));
    if(!this.sculptDrag&&!this.generation)this.setStatus(this.writer.savedRevision>=this.saveRevision?'Lokal gespeichert':'Änderungen …');
  }
  render(){if(this.active&&this.state){
    if(this.generation?.result&&!this.workingSource&&!this.workingOres&&!this.drag){const job=this.generation;job.finish!(job.result!);}
    this.applyCompletedWorld();
    if(this.skyMode){this.markers.visible=false;if(this.skyView.preview){this.skyPreviewState??=structuredClone(this.state);const state=this.skyPreviewState;state.deployment=null;state.x=this.document.spawn.x;state.z=this.document.spawn.z;state.elapsed=performance.now()/1000;const region=this.element.querySelector('.editor-sky')?.getBoundingClientRect();if(region)this.world.renderGamePreview(state,region);}else this.skyView.render(this.world.renderer,this.world.quality==='high');return;}
    this.markers.visible=true;
    this.tickBrush();this.world.setEditorView(this.view());this.world.render(this.state,0,0);
    const gl=this.world.renderer.getContext() as WebGL2RenderingContext;
    if(this.previewReadyAt){const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(sync){gl.flush();this.previewFences.push({sync,start:this.previewReadyAt});}this.previewReadyAt=0;}
    this.previewFences=this.previewFences.filter(f=>{const result=gl.clientWaitSync(f.sync,0,0);if(result===gl.TIMEOUT_EXPIRED)return true;
      gl.deleteSync(f.sync);this.previewSamples.push(performance.now()-f.start);if(this.previewSamples.length>300)this.previewSamples.shift();return false;});
    if(import.meta.env.DEV)(window as any).__sculptMetrics={samples:[...this.previewSamples],p95:[...this.previewSamples].sort((a,b)=>a-b)[Math.floor(this.previewSamples.length*.95)]??0};
  }}
  private resetWorker(){
    const object=this.document.objects.find(o=>o.id===this.selection),source=object&&this.sculptSource(object);if(!source||!this.sculptWorker)return;
    this.sculptRevision++;this.previewChunks={};this.workerReady=false;this.workerInFlight=true;this.sculptBusy=true;
    this.sculptWorker.postMessage({kind:'reset',epoch:this.sculptRevision,sequence:++this.sequence,source});
  }
  private applyPreview(chunks:Record<string,SculptMesh>){
    Object.assign(this.previewChunks,chunks);
    const root=this.world.editorObjects.find(m=>m.userData.structure?.id===this.selection);if(!root||!this.sculptMode)return;
    if(!root.userData.preview){root.geometry.dispose();root.geometry=new THREE.BufferGeometry();root.userData.preview=true;chunks=this.previewChunks;}
    for(const [key,data] of Object.entries(chunks)){
      let mesh=root.children.find(m=>m.name===key) as THREE.Mesh|undefined;
      if(!mesh){mesh=new THREE.Mesh(new THREE.BufferGeometry(),root.material);mesh.name=key;mesh.castShadow=mesh.receiveShadow=true;mesh.customDepthMaterial=root.customDepthMaterial;mesh.userData.structure=root.userData.structure;root.add(mesh);}
      mesh.geometry.dispose();mesh.geometry=sculptGeometry(data);
    }
  }
  private pumpSculpt(){
    if(this.workerInFlight||!this.workerReady||!this.sculptWorker)return;
    if(this.strokeQueue.length){const strokes=this.strokeQueue.splice(0);this.inputStarted=this.queuedAt;this.queuedAt=0;this.workerInFlight=true;
      this.sculptWorker.postMessage({kind:'append',epoch:this.sculptRevision,sequence:++this.sequence,strokes});
    }
  }
  private drawUI(){
    const leftScroll=this.element.querySelector('.editor-left')?.scrollTop??0,rightScroll=this.element.querySelector('.editor-right')?.scrollTop??0;
    const expanded=new Map(Array.from(this.element.querySelectorAll('details')).map(d=>[d.querySelector('summary')?.textContent,d.open]));
    const d=this.document,t=this.history.current.theme,esc=escapeHtml;
    const selected=d.objects.find(o=>o.id===this.selection), shelter=d.shelters.find(s=>s.id===this.selection);
    const item=selected??(this.selection==='spawn'?d.spawn:this.selection==='base'?d.base:shelter);
    const number=(label:string,key:string,value:number,step=1,min?:number,max?:number)=>`<label>${label}<input aria-label="${label}" type="number" data-field="${key}" value="${value}" step="${step}" ${min===undefined?'':`min="${min}"`} ${max===undefined?'':`max="${max}"`}></label>`;
    const objectButton=(id:string,name:string)=>`<button data-select="${esc(id)}" aria-pressed="${this.selection===id}" class="${this.issues.some(i=>i.objectId===id)?'has-warning':''}">${esc(name)}</button>`;
    this.element.innerHTML=`<header class="editor-bar"><div class="editor-brand">WING GLIDER<small>LEVEL WORKSHOP</small></div><button id="editor-close">← Spiel</button><button id="editor-save">Speichern</button><button id="editor-export">JSON exportieren</button><button id="editor-undo" ${this.history.canUndo||this.generation?'':'disabled'} title="Strg Z">↶ Rückgängig</button><button id="editor-redo" ${this.history.canRedo?'':'disabled'} title="Strg Umschalt Z / Strg Y">↷ Wiederholen</button><button id="editor-play" class="editor-play" ${this.pendingWorld||this.generation||this.sculptBusy||this.issues.some(i=>i.severity==='error')?'disabled':''}>▷ Probespielen</button></header>
      <aside class="editor-side editor-left"><h3 class="editor-section-title">Expedition</h3><label>Levelname<input id="editor-name" maxlength="100" value="${esc(d.name)}"></label><div class="editor-actions"><button id="editor-new-space">Neuer Gürtel</button><button id="editor-new-planet">Neuer Planet</button></div><details><summary>Gespeicherte Entwürfe & Import</summary><div class="saved-list" id="editor-saved"></div><label>JSON importieren<input class="editor-file" id="editor-import" type="file" accept=".json,application/json"></label><textarea class="editor-json" id="editor-import-text" aria-label="Level-JSON zum Importieren" placeholder="Oder Level-JSON hier einfügen"></textarea><button id="editor-import-paste">JSON übernehmen</button></details>
      ${d.environment==='space'?generatorPalette(this.generator,!!this.generation):''}${lightingPalette(d,this.selection,this.skyMode)}<h3>Asset-Palette</h3><div class="editor-palette">${Object.values(ASSET_CATALOG).filter(a=>a.environment===d.environment&&a.kind!=='asteroid').map(a=>`<button data-asset="${a.id}">＋ ${esc(a.name)}</button>`).join('')}${d.environment==='planet'?'<button data-asset="shelter">＋ Schutzbereich</button>':Object.entries(SCULPT_SHAPES).map(([id,name])=>`<button data-asset="shape:${id}">＋ ${name}</button>`).join('')}</div><p class="editor-note">Asset wählen, dann im Flugraum platzieren.</p>${d.environment==='space'?'<details open><summary>Eigene Vorlagen</summary><div class="saved-list" id="editor-templates"></div></details>':''}<h3>Objekte · ${d.objects.length}</h3><div class="editor-objects">${objectButton('spawn','◎ Startpunkt')}${objectButton('base','▣ ATLAS')}${d.shelters.map(s=>objectButton(s.id,'◯ '+s.name)).join('')}${d.objects.map(o=>objectButton(o.id,this.sculptSource(o)?.name??ASSET_CATALOG[o.assetId]?.name??o.assetId)).join('')}</div></aside>
      <aside class="editor-side editor-right">${lightProperties(d,this.selection,this.skyView.ringMode)}<h3 class="editor-section-title">${item?'Auswahl':'Level-Einstellungen'}</h3>${item?`<strong class="editor-selected-name">${esc(selected?(this.sculptSource(selected)?.name??ASSET_CATALOG[selected.assetId].name):this.selection==='spawn'?'Startpunkt':this.selection==='base'?'ATLAS':shelter?.name)}</strong><div class="editor-pair">${number('Position X','x',Math.round(item.x*100)/100,.5)}${number('Position Z','z',Math.round(item.z*100)/100,.5)}</div>${selected?`<div class="editor-pair">${number('Drehung °','rotation',Math.round(selected.rotation*180/Math.PI),5)}${number('Skalierung','scale',selected.scale,.05,...ASSET_CATALOG[selected.assetId].scaleRange as [number,number])}</div>${selected.assetId==='hill'?number('Radius','parameter.radius',Number(selected.parameters.radius),1,4,120)+number('Höhe','parameter.height',Number(selected.parameters.height),1,1,120):selected.assetId==='cliff'?number('Halbe Breite','parameter.halfX',Number(selected.parameters.halfX),1,2,80)+number('Halbe Länge','parameter.halfZ',Number(selected.parameters.halfZ),1,2,80)+number('Höhe','parameter.height',Number(selected.parameters.height),1,4,120):''}<div class="editor-actions"><button id="editor-duplicate">Duplizieren</button><button id="editor-delete" class="editor-danger">Löschen</button></div>`:shelter?number('Schutzradius','radius',shelter.radius,1,5,30)+'<button id="editor-delete">Schutzbereich löschen</button>':''}<button id="editor-focus">Auswahl zentrieren</button>${selected?(d.environment==='space'?generatorSelection(!!this.generation):'')+'<div id="editor-ore-panel">'+this.oreUI(selected)+'</div>'+this.oreGlowUI(selected):''}`:'<p>Wähle einen Felsen, ATLAS oder den Startpunkt. Ziehen verschiebt die Auswahl.</p>'}
      ${selected&&d.environment==='space'?this.sculptUI(selected)+glowProperties(this.sculptSource(selected)!):''}
      <label><span><input id="editor-snap" type="checkbox" ${this.snap?'checked':''}> Rasterfang · 2 m</span></label><details ${item?'':'open'}><summary>Level & Lieferauftrag</summary>${number('Levelradius','bounds',d.bounds,10,100,400)}${number('Seed','seed',d.seed,1)}${(['ferrite','copper','crystal'] as const).map(r=>number('Lieferziel '+RESOURCES[r].name,'delivery.'+r,d.delivery[r],1,0,10000)).join('')}</details>
      <details open><summary>Theme gestalten</summary><label>Theme-Variante<select id="editor-theme-select">${Object.values(THEMES).filter(v=>v.environment===d.environment).map(v=>`<option value="${esc(v.id)}" ${v.id===d.themeId?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label><label>Name der Variante<input id="editor-theme-name" value="${esc(t.name)}"></label>${(['background','rockTint','sunColor','ambientColor','rimColor'] as const).map((k,i)=>`<label>${['Hintergrund','Felsfarbe','Hauptlicht','Umgebungslicht','Streiflicht'][i]}<input type="color" data-theme="${k}" aria-label="${['Hintergrund','Felsfarbe','Hauptlicht','Umgebungslicht','Streiflicht'][i]}" value="${t[k]}"></label>`).join('')}${[['sunIntensity','Lichtstärke',0,8,.1],['sunAzimuth','Lichtrichtung °',-180,180,1],['sunElevation','Lichthöhe °',10,85,1],['ambientIntensity','Umgebungsstärke',0,4,.05],['rimIntensity','Streiflichtstärke',0,6,.1],['decorationDensity','Dekorationsdichte',0,2,.1],...(d.environment==='planet'?[['fogDensity','Nebeldichte',0,.006,.0001]]:[])].map(([k,label,min,max,step])=>`<label>${label}<input type="number" data-theme="${k}" aria-label="${label}" value="${t[k as keyof ThemeDefinition]}" min="${min}" max="${max}" step="${step}"></label>`).join('')}${d.environment==='planet'?`<label>Nebelfarbe<input type="color" data-theme="fogColor" value="${t.fogColor}"></label>`:''}</details>
      <h3 id="editor-issue-title">Prüfung · ${this.issues.length}</h3><ul id="editor-issues" class="editor-issues">${this.issues.map(i=>`<li class="${i.severity}">${esc(i.message)}</li>`).join('')||'<li>Start, ATLAS und Erzstellen sind erreichbar.</li>'}</ul></aside>
      ${this.skyMode?skyOverlay(d,this.selection,this.skyView.side,this.skyView.preview,this.skyView.ringMode):''}<div class="editor-tip">${this.sculptMode?'Links: Pinsel · Alt + Ziehen / Mitte / Rechts: Kamera · Mausrad: Zoom':this.pendingAsset?'Zum Platzieren in den Flugraum klicken · Esc bricht ab':'Ziehen: verschieben · Alt + Ziehen / Mitte / Rechts: Ansicht · Mausrad: Zoom'}</div><footer class="editor-status"><span id="editor-save-status">${this.generation?'Asteroid wird generiert … · Esc bricht ab':this.sculptBusy?'Form wird berechnet …':'Lokal bearbeitbarer Entwurf'}</span><span>Entf löschen · Strg D duplizieren · Strg Z zurück · Q/E drehen</span></footer>`;
    bindLightEditor(this.element,{document:this.document,selection:this.selection,sky:this.skyMode,change:edit=>this.lightChange(edit),select:(id,sky)=>{if(sky){this.selectSkyBody(id);return;}if(this.sculptBusy)return;if(this.sculptMode)this.leaveSculpt();this.history.current.selection=id;this.pendingAsset=null;if(sky!==undefined)this.toggleSky(sky);this.world.lighting.select(id);this.drawUI();this.drawMarkers();},toggleSky:()=>this.toggleSky(),placeLamp:kind=>{if(this.sculptBusy)return;this.toggleSky(false);if(this.sculptMode)this.leaveSculpt();this.pendingAsset='lamp:'+kind;this.drawUI();},error:message=>this.setStatus(message)});
    this.skyView.bind(this.element.querySelector('.editor-sky'));if(!this.skyView.dragging)this.skyView.sync(this.document,this.selection);
    this.element.querySelector('.editor-left')!.scrollTop=leftScroll;this.element.querySelector('.editor-right')!.scrollTop=rightScroll;
    this.element.querySelectorAll('details').forEach(d=>{const open=expanded.get(d.querySelector('summary')?.textContent);if(open!==undefined)d.open=open;});
    const on=(id:string,fn:()=>void)=>this.element.querySelector<HTMLButtonElement>('#'+id)?.addEventListener('click',fn);
    on('editor-close',()=>{if(this.sculptBusy)return;this.skyView.cancel();void this.persist();this.openEpoch++;this.cancelWorld();this.cancelGeneration();this.cancelPendingSculpt();this.active=false;this.element.hidden=true;this.markers.visible=false;this.world.lighting.select(null);this.world.setEditorView(null);document.body.classList.remove('editor-open');this.callbacks.close();});
    on('sky-upper',()=>this.mirrorSkySide(1));on('sky-lower',()=>this.mirrorSkySide(-1));
    on('sky-fit',()=>this.skyView.fit());
    on('sky-game-angle',()=>{this.skyView.gameAngle();this.drawUI();});on('sky-preview',()=>{this.skyView.setPreview(!this.skyView.preview);this.skyPreviewState=null;this.drawUI();});
    on('sky-ring-edit',()=>{const next=!this.skyView.ringMode;this.toggleSky(true);this.skyView.alignRing(next);this.drawUI();});on('sky-ring-done',()=>{this.skyView.alignRing(false);this.drawUI();});
    on('editor-save',()=>{this.skyView.cancel();void this.persist();});on('editor-export',()=>this.download());on('editor-undo',()=>this.undo());on('editor-redo',()=>this.redo());on('editor-play',()=>this.play());
    on('editor-new-space',()=>{if(this.sculptBusy)return;void this.persist();this.launch(newDocument('space'));});on('editor-new-planet',()=>{if(this.sculptBusy)return;void this.persist();this.launch(newDocument('planet'));});
    on('editor-sculpt',()=>this.enterSculpt());on('editor-sculpt-done',()=>this.leaveSculpt());
    on('editor-template-save',()=>void this.saveSelectedTemplate());
    this.element.querySelectorAll<HTMLButtonElement>('[data-sculpt-tool]').forEach(button=>button.onclick=()=>{this.brush.tool=button.dataset.sculptTool as SculptTool;this.drawUI();});
    this.element.querySelectorAll<HTMLInputElement>('[data-brush]').forEach(input=>input.oninput=()=>{this.brush[input.dataset.brush as 'radius'|'strength'|'falloff'|'thickness']=input.valueAsNumber;this.element.querySelector(`#brush-${input.dataset.brush}-value`)!.textContent=input.value;});
    this.element.querySelector<HTMLSelectElement>('#editor-paint-layer')?.addEventListener('change',e=>{this.brush.layer=(e.target as HTMLSelectElement).value as PaintLayer;if(this.brush.layer==='glow')this.lightChange(doc=>{const o=doc.objects.find(o=>o.id===this.selection)!;doc.sculpts![String(o.parameters.sculptId)].glow??=newRockGlow();});});
    const oreChoice=this.element.querySelector<HTMLSelectElement>('#editor-ore-resource');if(oreChoice){oreChoice.value=this.brush.resource;oreChoice.onchange=()=>this.brush.resource=oreChoice.value as ResourceId;}
    this.element.querySelectorAll<HTMLInputElement>('[data-sculpt-material]').forEach(input=>input.onchange=()=>{if(!input.checkValidity())return;const key=input.dataset.sculptMaterial!;
      this.change(doc=>{const o=doc.objects.find(item=>item.id===this.selection)!;doc.sculpts![String(o.parameters.sculptId)].material[key as keyof SculptDefinition['material']]=input.valueAsNumber;});});
    on('editor-duplicate',()=>this.duplicate());on('editor-delete',()=>this.remove());on('editor-focus',()=>{if(item){this.cameraView.x=item.x;this.cameraView.z=item.z;this.cameraView.zoom=1;}});
    this.element.querySelector<HTMLInputElement>('#editor-name')!.onchange=e=>this.change(doc=>doc.name=(e.target as HTMLInputElement).value);
    this.element.querySelector<HTMLInputElement>('#editor-snap')!.onchange=e=>this.snap=(e.target as HTMLInputElement).checked;
    this.element.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(b=>b.onclick=()=>{if(this.sculptBusy)return;if(this.sculptMode)this.leaveSculpt();this.toggleSky(false);this.history.current.selection=b.dataset.select!;this.pendingAsset=null;this.world.lighting.select(null);this.drawUI();this.drawMarkers();});
    this.element.querySelectorAll<HTMLButtonElement>('[data-asset]').forEach(b=>b.onclick=()=>{if(this.sculptMode)this.leaveSculpt();this.toggleSky(false);this.pendingAsset=b.dataset.asset!;this.drawUI();});
    this.element.querySelectorAll<HTMLInputElement>('[data-field]').forEach(input=>input.onchange=()=>{
      if(!input.checkValidity()||!Number.isFinite(input.valueAsNumber)){input.reportValidity();return;}
      const key=input.dataset.field!,value=input.valueAsNumber;
      this.change(doc=>{
        if(key==='bounds'||key==='seed'){doc[key]=value;return;}if(key.startsWith('delivery.')){doc.delivery[key.slice(9) as ResourceId]=value;return;}
        const target=doc.objects.find(o=>o.id===this.selection)??(this.selection==='spawn'?doc.spawn:this.selection==='base'?doc.base:doc.shelters.find(s=>s.id===this.selection));if(!target)return;
        if(selected){const before=structuredClone(selected);if(key.startsWith('parameter.'))(target as PlacedObject).parameters[key.slice(10)]=value;else(target as any)[key]=key==='rotation'?value*Math.PI/180:value;this.movePlanetOres(doc,before,target as PlacedObject);}
        else (target as any)[key]=value;
      });
    });
    this.element.querySelectorAll<HTMLInputElement>('[data-theme]').forEach(input=>input.onchange=()=>{if(!input.checkValidity()){input.reportValidity();return;}this.change((doc,theme)=>{const key=input.dataset.theme!;(theme as any)[key]=input.type==='color'?input.value:input.valueAsNumber;const body=doc.lighting!.bodies.find(b=>b.id===(key.startsWith('rim')?'sky-rim':'sky-main'));if(body){const fields:Record<string,string>={sunColor:'color',sunIntensity:'intensity',sunAzimuth:'azimuth',sunElevation:'elevation',rimColor:'color',rimIntensity:'intensity'};if(fields[key])(body as any)[fields[key]]=(theme as any)[key];}});});
    this.element.querySelector<HTMLInputElement>('#editor-theme-name')!.onchange=e=>this.change((_doc,theme)=>theme.name=(e.target as HTMLInputElement).value);
    this.element.querySelector<HTMLSelectElement>('#editor-theme-select')!.onchange=e=>{const theme=structuredClone(THEMES[(e.target as HTMLSelectElement).value]);this.change((doc,t)=>{const id=doc.themeId;Object.assign(t,theme,{id,name:theme.name+' · Variante'});const defaults=themeLighting(t);for(const body of defaults.bodies){const existing=doc.lighting?.bodies.find(b=>b.id===body.id);if(existing)Object.assign(existing,{color:body.color,intensity:body.intensity,azimuth:body.azimuth,elevation:body.elevation});}});};
    this.element.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-generator]').forEach(input=>input.onchange=()=>{if(!input.checkValidity())return;const key=input.dataset.generator!;const value=input instanceof HTMLInputElement?(input.type==='checkbox'?input.checked:input.type==='number'||input.type==='range'?input.valueAsNumber:input.value):input.value;(this.generator as any)[key]=value;});
    on('generator-new',()=>{if(this.sculptBusy)return;if(this.sculptMode)this.leaveSculpt();this.toggleSky(false);this.pendingAsset='generated';this.drawUI();});
    this.element.querySelectorAll<HTMLButtonElement>('[data-generate]').forEach(button=>button.onclick=()=>this.generate(button.dataset.generate as GeneratorAction));
    if(this.generation)this.element.querySelectorAll<HTMLButtonElement>('[data-generate],#generator-new').forEach(control=>control.disabled=true);
    this.bindOres(selected);
    const importText=async(text:string)=>{try{const pack=importLevel(text);pack.themes.forEach(t=>{const id=uid('theme');if(pack.level.themeId===t.id)pack.level.themeId=id;t.id=id;THEMES[id]=t;});pack.level.id=uid('level');await saveLevel(pack);await this.open(pack.level);this.setStatus('Level importiert');}catch(e){if(!this.active&&this.callbacks.failed)this.callbacks.failed(e);else this.setStatus((e as Error).message);}};
    this.element.querySelector<HTMLInputElement>('#editor-import')!.onchange=async e=>{const file=(e.target as HTMLInputElement).files?.[0];if(file)await importText(await file.text());};
    on('editor-import-paste',()=>void importText(this.element.querySelector<HTMLTextAreaElement>('#editor-import-text')!.value));
    this.drawLibrary();
  }
  private async refreshLibrary(){try{[this.savedPacks,this.templates]=await Promise.all([savedLevels(),savedTemplates()]);this.drawLibrary();}catch{this.setStatus('Lokaler Speicher nicht verfügbar · JSON verwenden');}}
  private drawLibrary(){
    const saved=this.element.querySelector('#editor-saved');if(saved){saved.replaceChildren();for(const pack of this.savedPacks){const button=document.createElement('button');button.textContent=pack.level.name;button.onclick=()=>{void this.persist();pack.themes.forEach(t=>THEMES[t.id]=t);this.launch(pack.level);};saved.append(button);}}
    const list=this.element.querySelector('#editor-templates');if(!list)return;list.replaceChildren();
    for(const item of this.templates){const row=document.createElement('div');row.className='editor-template-row';const add=document.createElement('button');add.textContent='＋ '+item.name;add.onclick=()=>{if(this.sculptMode)this.leaveSculpt();this.pendingAsset='template:'+item.id;this.drawUI();};const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label','Vorlage '+item.name+' löschen');remove.onclick=async()=>{await deleteTemplate(item.id);this.templates=this.templates.filter(t=>t.id!==item.id);this.drawLibrary();};row.append(add,remove);list.append(row);}if(!this.templates.length)list.textContent='Noch keine eigenen Vorlagen.';
  }
  private sculptSource(object:PlacedObject){return this.document.sculpts?.[String(object.parameters.sculptId)];}
  private sculptUI(object:PlacedObject){
    const source=this.sculptSource(object),e=escapeHtml;
    if(!this.sculptMode)return `<details open><summary>Form & Oberfläche</summary><button id="editor-sculpt">Form bearbeiten</button>${source?`<label>Vorlagenname<input id="editor-template-name" value="${e(source.name)}" maxlength="100"></label><button id="editor-template-save">Als Vorlage speichern</button>`:''}</details>`;
    const tools:[SculptTool,string][]=[['add','Auftragen'],['subtract','Abtragen'],['grab','Ziehen'],['smooth','Glätten'],['flatten','Abflachen'],['paint','Oberfläche malen'],['ore','Erz aufsprühen']];
    return `<details open><summary>Form & Oberfläche</summary><button id="editor-sculpt-done">✓ Form fertig</button><div class="editor-sculpt-tools">${tools.map(([id,label])=>`<button data-sculpt-tool="${id}" aria-pressed="${this.brush.tool===id}">${label}</button>`).join('')}</div>
      <label>Pinselgröße · <output id="brush-radius-value">${this.brush.radius}</output> m<input type="range" data-brush="radius" min="1" max="25" step=".5" value="${this.brush.radius}"></label>
      <label>Stärke · <output id="brush-strength-value">${this.brush.strength}</output><input type="range" data-brush="strength" min=".05" max="1" step=".05" value="${this.brush.strength}"></label>
      <label>Weicher Rand · <output id="brush-falloff-value">${this.brush.falloff}</output><input type="range" data-brush="falloff" min="0" max="1" step=".05" value="${this.brush.falloff}"></label>
      <label>Materialzone<select id="editor-paint-layer">${([['coarse','Grobe Brocken'],['smooth','Glatte Bruchfläche'],['weathered','Verwittert'],['color','Dunkler Fels'],['glow','Leuchten']] as const).map(([id,label])=>`<option value="${id}" ${this.brush.layer===id?'selected':''}>${label}</option>`).join('')}</select></label>
      <label>Rohstoff<select id="editor-ore-resource"><option value="ferrite">Ferrit</option><option value="copper">Kupfererz</option><option value="crystal">Kristalle</option></select></label><label>Max. Schichtdicke · <output id="brush-thickness-value">${this.brush.thickness}</output> m<input type="range" data-brush="thickness" min=".1" max="4" step=".1" value="${this.brush.thickness}"></label><p id="editor-ore-mass" class="editor-note">Erzmenge entsteht aus Fläche und Schichtdicke.</p>
      ${source?([['scale','Brockenmaßstab',.25,4],['angularity','Kantigkeit',0,1],['relief','Relief',0,1],['weathering','Verwitterung',0,1]] as const).map(([id,label,min,max])=>`<label>${label}<input type="number" data-sculpt-material="${id}" value="${source.material[id]}" min="${min}" max="${max}" step=".05"></label>`).join(''):''}
      <label>Vorlagenname<input id="editor-template-name" value="${e(source?.name??'Mein Asteroid')}" maxlength="100"></label><button id="editor-template-save">Als Vorlage speichern</button></details>`;
  }
  private enterSculpt(){
    const object=this.document.objects.find(o=>o.id===this.selection);if(!object||this.document.environment!=='space')return;
    if(!this.sculptSource(object))return;if(!getSculpt(this.document.id,object.id)){this.setStatus('Die neue Form wird im Hintergrund vorbereitet.');return;}
    this.levelCamera={...this.cameraView};this.cameraView={x:object.x,z:object.z,zoom:1.8};this.sculptMode=true;this.sculptCursor.visible=false;this.resetWorker();
    this.drawUI();this.drawMarkers();
  }
  private leaveSculpt(){if(this.workingSource||this.workingOres)return;this.cancelPendingSculpt();this.sculptMode=false;this.sculptDrag=null;this.sculptCursor.visible=false;this.cameraView={...this.levelCamera};this.rebuild();}
  private async saveSelectedTemplate(){
    const object=this.document.objects.find(o=>o.id===this.selection);if(!object)return;
    const source=this.sculptSource(object);if(!source||this.sculptBusy)return;
    const name=this.element.querySelector<HTMLInputElement>('#editor-template-name')?.value.trim()||source.name;
    const template:SculptTemplate={version:2,id:uid('template'),name,sculpt:structuredClone({...source,name}),ores:this.document.deposits.filter(d=>d.structureId===object.id).map(d=>({resource:d.resource,amount:d.amount,paint:structuredClone(d.paint!),emission:structuredClone(d.emission)}))};
    try{await saveTemplate(template);this.templates.push(template);this.setStatus('Vorlage gespeichert');this.drawUI();}catch{this.setStatus('Vorlage konnte nicht gespeichert werden');}
  }
  private sculptHit(e:PointerEvent){
    const mesh=this.world.editorObjects.find(m=>m.userData.structure?.id===this.selection);if(!mesh)return null;
    const rect=this.world.renderer.domElement.getBoundingClientRect();this.ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),this.world.camera);
    const hit=this.ray.intersectObject(mesh,true)[0];if(!hit)return null;
    mesh.updateMatrixWorld(true);const local=mesh.worldToLocal(hit.point.clone()),normal=hit.face?.normal.clone().normalize()??new THREE.Vector3(0,1,0);
    this.sculptCursor.position.copy(hit.point);const object=this.document.objects.find(o=>o.id===this.selection)!;this.sculptCursor.scale.setScalar(this.brush.radius*object.scale);this.sculptCursor.visible=true;
    return {local,normal,mesh};
  }
  private beginSculpt(e:PointerEvent){
    this.modifiers={shift:e.shiftKey,ctrl:e.ctrlKey};
    if(this.cameraGesture(e)){if(this.sculptDrag)return;this.sculptDrag={points:[],last:new THREE.Vector3(),normal:[0,1,0],startX:e.clientX,startY:e.clientY,button:2};if(e.isTrusted)this.world.renderer.domElement.setPointerCapture(e.pointerId);return;}
    if(e.button!==0||this.sculptBusy||!this.workerReady)return;
    const hit=this.sculptHit(e);if(!hit)return;e.preventDefault();
    const object=this.document.objects.find(o=>o.id===this.selection)!;
    const tool=this.effectiveTool(e),normal=hit.normal.toArray() as Triple;
    this.sculptDrag={points:[{tool,center:hit.local.toArray() as Triple,radius:this.brush.radius,strength:this.brush.strength,falloff:this.brush.falloff,normal,layer:this.brush.layer,erase:this.brush.layer==='glow'&&e.ctrlKey}],last:hit.local,normal,startX:e.clientX,startY:e.clientY,button:0};
    if(tool==='ore'){this.workingOres=structuredClone(this.document.deposits);this.oreLayerId=null;}
    else this.workingSource=structuredClone(this.sculptSource(object)!);
    this.sculptBusy=true;this.pointer=e;this.lastBrushTime=performance.now()-34;
    if(e.isTrusted)this.world.renderer.domElement.setPointerCapture(e.pointerId);this.tickBrush();
  }
  private effectiveTool(_e:PointerEvent):SculptTool{return this.modifiers.shift&&this.brush.tool!=='ore'?'smooth':this.modifiers.ctrl?(this.brush.tool==='add'?'subtract':this.brush.tool==='subtract'?'add':this.brush.tool):this.brush.tool;}
  private moveSculpt(e:PointerEvent){
    this.modifiers={shift:e.shiftKey,ctrl:e.ctrlKey};
    const drag=this.sculptDrag;
    if(drag?.button===2){this.sculptView.yaw+=(e.clientX-drag.startX)*.008;this.sculptView.pitch=THREE.MathUtils.clamp(this.sculptView.pitch+(drag.startY-e.clientY)*.008,-1.35,1.35);drag.startX=e.clientX;drag.startY=e.clientY;return;}
    this.pointer=e;
    if(!drag)this.sculptHit(e);
    else this.tickBrush(true);
  }
  private tickBrush(moving=false){
    const drag=this.sculptDrag,e=this.pointer;if(!drag||drag.button!==0||!e)return;
    const now=performance.now(),elapsed=(now-this.lastBrushTime)/1000;if(elapsed<1/30&&!moving)return;
    const seconds=Math.min(.1,Math.max(.001,elapsed));let hit=this.sculptHit(e);this.lastBrushTime=now;
    if(!hit&&drag.points[0].tool==='grab'){const mesh=this.world.editorObjects.find(m=>m.userData.structure?.id===this.selection);if(mesh)hit={mesh,local:drag.last.clone(),normal:new THREE.Vector3(...drag.normal)};}if(!hit)return;
    if(this.workingOres){this.spray(hit,seconds);return;}
    if(!this.workingSource)return;
    const tool=this.effectiveTool(e),first=drag.points[0],stamps:SculptStroke[]=[];
    if(tool==='grab'){
      const camera=this.world.camera,right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
      const units=(camera as THREE.OrthographicCamera).top*2/camera.zoom/(this.world.renderer.domElement.clientHeight||720),object=this.document.objects.find(o=>o.id===this.selection)!;
      const delta=right.multiplyScalar((e.clientX-drag.startX)*units).add(up.multiplyScalar((drag.startY-e.clientY)*units)).applyAxisAngle(new THREE.Vector3(0,1,0),object.rotation).divideScalar(object.scale);
      drag.startX=e.clientX;drag.startY=e.clientY;if(delta.length()<.001)return;
      const count=Math.max(1,Math.ceil(delta.length()/Math.max(1,this.brush.radius*.35))),part=delta.divideScalar(count);
      for(let i=0;i<count;i++){
        stamps.push({...first,tool,center:drag.last.toArray() as Triple,delta:part.toArray() as Triple,seconds:seconds/count});
        drag.last.addScaledVector(part,this.brush.strength).clampScalar(-36,36);
      }
    }else{
      const count=Math.max(1,Math.ceil(hit.local.distanceTo(drag.last)/Math.max(.6,this.brush.radius*.22)));
      for(let i=1;i<=count;i++)stamps.push({...first,tool,center:drag.last.clone().lerp(hit.local,i/count).toArray() as Triple,normal:tool==='flatten'?first.normal:hit.normal.toArray() as Triple,erase:tool==='paint'&&this.brush.layer==='glow'&&this.modifiers.ctrl,seconds:seconds/count});
      drag.last.copy(hit.local);
    }
    if(this.workingSource.strokes.length+stamps.length>60000){this.setStatus('Formdatenlimit erreicht.');return;}
    this.workingSource.strokes.push(...stamps);if(!this.strokeQueue.length)this.queuedAt=now;this.strokeQueue.push(...stamps);this.pumpSculpt();
  }
  private spray(hit:NonNullable<ReturnType<LevelEditor['sculptHit']>>,seconds:number){
    const object=this.document.objects.find(o=>o.id===this.selection)!,ores=this.workingOres!;
    let ore=ores.find(d=>d.id===this.oreLayerId);
    if(!ore){ore=ores.find(d=>d.structureId===object.id&&d.resource===this.brush.resource&&d.paint?.cells.some(c=>new THREE.Vector3(...c.position).distanceTo(hit.local)<this.brush.radius));
      if(!ore){ore={id:uid('ore'),structureId:object.id,resource:this.brush.resource,amount:0,paint:{version:1,cells:[]}};ores.push(ore);}this.oreLayerId=ore.id;}
    const samples:{position:Triple;normal:Triple;weight:number}[]=[],up=new THREE.Vector3(0,1,0),q=new THREE.Quaternion().setFromUnitVectors(up,hit.normal),ray=new THREE.Raycaster(),r=this.brush.radius;
    for(let v=-r;v<=r;v+=1.45)for(let u=-r;u<=r;u+=1.45){
      const distance=Math.hypot(u,v);if(distance>r)continue;
      const local=new THREE.Vector3(u,0,v).applyQuaternion(q).add(hit.local),origin=local.clone().addScaledVector(hit.normal,2.5).applyMatrix4(hit.mesh.matrixWorld);
      const normal=hit.normal.clone().transformDirection(hit.mesh.matrixWorld);ray.set(origin,normal.negate());ray.far=5*object.scale;
      const surface=ray.intersectObject(hit.mesh,true)[0];if(!surface)continue;
      const p=hit.mesh.worldToLocal(surface.point.clone()),n=surface.face?.normal??hit.normal;
      if(n.dot(hit.normal)<.4)continue;
      samples.push({position:p.toArray() as Triple,normal:n.toArray() as Triple,weight:Math.pow(Math.max(0,1-distance/r),.3+this.brush.falloff)});
    }
    sprayOre(ore.paint!,samples,seconds,this.brush.strength,this.brush.thickness);ore.amount=oreMass(ore.paint!,object.scale);
    disposeObject(this.orePreview);
    this.world.scene.traverse(o=>{if(o.userData.depositId===ore!.id){if(!this.hiddenOre.has(o))this.hiddenOre.set(o,o.visible);o.visible=false;}});
    this.orePreview=new THREE.Group();this.world.scene.add(this.orePreview);
    const host=getLevelWorld(this.document.id).solids.find(s=>s.id===object.id)!;const cells=ore.paint!.cells.map(c=>resolveOreCell(host,c));if(!cells.length)return;
    const p=cells[0],d={id:ore.id,resource:ore.resource,emission:ore.emission,x:p.x,z:p.z,remaining:ore.amount,progress:0,surface:{kind:'asteroid' as const,y:p.y,nx:p.normal.x,nz:p.normal.z,width:r*2,cells}};
    const mineralGeometry=ore.resource==='crystal'?crystalGeometry():new THREE.IcosahedronGeometry(.8,0);
    const material=new THREE.MeshStandardMaterial({color:RESOURCES[ore.resource].color,metalness:.7,roughness:.4,emissive:RESOURCES[ore.resource].color,emissiveIntensity:ore.resource==='crystal'?.15:.015});
    const visual=createPaintedOre(d,mineralGeometry,material);mineralGeometry.dispose();material.dispose();visual.bed.dispose();visual.stain.dispose();this.orePreview.add(visual.patch,visual.chunks);
    const label=this.element.querySelector('#editor-ore-mass');if(label)label.textContent=RESOURCES[ore.resource].name+' · '+ore.amount.toFixed(1)+' Einheiten';
  }
  private endSculpt(e:PointerEvent){
    if(this.sculptDrag?.button===0)this.tickBrush(true);
    const drag=this.sculptDrag;this.sculptDrag=null;this.pointer=null;
    if(this.world.renderer.domElement.hasPointerCapture(e.pointerId))this.world.renderer.domElement.releasePointerCapture(e.pointerId);
    if(!drag||drag.button!==0)return;
    this.sculptCursor.visible=false;
    if(this.workingOres){const ores=this.workingOres.filter(o=>o.amount>0);this.history.change(snapshot=>snapshot.level.deposits=ores);this.workingOres=null;}
    else if(this.workingSource){const source=this.workingSource;this.history.change(snapshot=>snapshot.level.sculpts![source.id]=source);this.workingSource=null;}
    this.sculptBusy=false;this.pumpSculpt();this.rebuild();this.scheduleSave();this.setStatus('Im Hintergrund: Abfragen und Flugwege …');
  }
  private cancelStroke(){
    this.sculptDrag=null;this.pointer=null;this.cancelPendingSculpt();this.clearOrePreview();this.sculptCursor.visible=false;
    if(this.active){this.rebuild();if(this.sculptMode)this.resetWorker();this.scheduleSave();}
  }
  private clearOrePreview(){
    disposeObject(this.orePreview);
    // A rejected draft can retain the old world. Restore it even in that case.
    for(const [object,visible] of this.hiddenOre)object.visible=visible;
    this.hiddenOre.clear();
  }
  private oreUI(object:PlacedObject){
    const deposits=this.document.deposits.filter(d=>d.structureId===object.id);
    if(this.document.environment==='planet')return `<h3>Erzstellen</h3>${deposits.map(d=>`<div class="editor-pair"><label>Rohstoff<select data-planet-ore="${escapeHtml(d.id)}">${Object.entries(RESOURCES).map(([id,r])=>`<option value="${id}" ${d.resource===id?'selected':''}>${r.name}</option>`).join('')}</select></label><label>Einheiten<input type="number" min="1" max="100" data-planet-amount="${escapeHtml(d.id)}" value="${d.amount}"></label></div><button data-remove-ore="${escapeHtml(d.id)}">Erzstelle entfernen</button>`).join('')}<button id="editor-add-ore">＋ Erzstelle hinzufügen</button><p class="editor-note">Erzstellen bewegen sich mit dieser Formation.</p>`;
    return '<h3>Gemalte Erzschichten</h3>'+deposits.map(d=>{
      const invalid=getLevelWorld(this.document.id).deposits.find(live=>live.id===d.id)?.surface?.cells?.filter(c=>!c.valid).length??0;
      return '<div>'+RESOURCES[d.resource].name+' · '+d.amount.toFixed(1)+' Einheiten'+(invalid?' <strong>⚠ '+invalid+' Stellen ohne Träger</strong>':'')+' <button data-prune-ore="'+escapeHtml(d.id)+'">Ungültige Stellen entfernen</button><button data-remove-ore="'+escapeHtml(d.id)+'">Entfernen</button></div>';
    }).join('')+'<p class="editor-note">Form bearbeiten → Erz aufsprühen. Fläche und Schichtdicke bestimmen die Menge.</p>';
  }
  private oreGlowUI(object:PlacedObject){return '<details><summary>Erzleuchten</summary>'+this.document.deposits.filter(o=>o.structureId===object.id).map(o=>'<label>'+RESOURCES[o.resource].name+' · Farbe<input type="color" data-ore-glow="'+escapeHtml(o.id)+'" data-glow-key="color" value="'+(o.emission?.color??RESOURCES[o.resource].color)+'"></label><label>Erz-Leuchtstärke<input type="number" min="0" max="20" step=".1" data-ore-glow="'+escapeHtml(o.id)+'" data-glow-key="intensity" value="'+(o.emission?.intensity??(o.resource==='crystal'?.65:0))+'"></label>').join('')+'</details>';}
  private bindOres(object?:PlacedObject){if(!object)return;
    this.element.querySelectorAll<HTMLInputElement>('[data-ore-glow]').forEach(input=>input.onchange=()=>{if(!input.checkValidity())return;this.lightChange(doc=>{const ore=doc.deposits.find(o=>o.id===input.dataset.oreGlow)!;ore.emission??={color:RESOURCES[ore.resource].color,intensity:ore.resource==='crystal'?.65:0};if(input.dataset.glowKey==='color')ore.emission.color=input.value;else ore.emission.intensity=input.valueAsNumber;});});
    this.element.querySelectorAll<HTMLButtonElement>('[data-prune-ore]').forEach(button=>button.onclick=()=>this.change(doc=>{
      const ore=doc.deposits.find(d=>d.id===button.dataset.pruneOre),host=getLevelWorld(doc.id).solids.find(s=>s.id===object.id);if(!ore?.paint||!host)return;
      ore.paint.cells=ore.paint.cells.filter(c=>resolveOreCell(host,c).valid);ore.amount=oreMass(ore.paint,object.scale);if(!ore.paint.cells.length)doc.deposits=doc.deposits.filter(d=>d!==ore);
    }));
    this.element.querySelectorAll<HTMLSelectElement>('[data-planet-ore]').forEach(input=>input.onchange=()=>this.change(doc=>{doc.deposits.find(d=>d.id===input.dataset.planetOre)!.resource=input.value as ResourceId;}));
    this.element.querySelectorAll<HTMLInputElement>('[data-planet-amount]').forEach(input=>input.onchange=()=>{if(input.checkValidity())this.change(doc=>{doc.deposits.find(d=>d.id===input.dataset.planetAmount)!.amount=input.valueAsNumber;});});
    this.element.querySelectorAll<HTMLButtonElement>('[data-remove-ore]').forEach(button=>button.onclick=()=>this.change(doc=>doc.deposits=doc.deposits.filter(d=>d.id!==button.dataset.removeOre)));
    const add=this.element.querySelector<HTMLButtonElement>('#editor-add-ore');if(add)add.onclick=()=>this.change(doc=>{
      const count=doc.deposits.filter(d=>d.structureId===object.id).length,angle=object.rotation+Math.PI/2+(count%3-1)*.45;
      let x=object.x+Math.cos(angle)*Number(object.parameters.radius??10)*object.scale*.62,z=object.z+Math.sin(angle)*Number(object.parameters.radius??10)*object.scale*.62,nx=Math.cos(angle),nz=Math.sin(angle);
      if(object.assetId==='cliff'){const world=getLevelWorld(doc.id),solid=world.solids.find(s=>s.id===object.id)!,points=getSolidFootprint(solid)!;let best=-Infinity;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],len=Math.hypot(b.x-a.x,b.z-a.z),ex=(b.z-a.z)/len,ez=-(b.x-a.x)/len,score=ex*Math.cos(angle)+ez*Math.sin(angle);if(score>best){best=score;nx=ex;nz=ez;x=(a.x+b.x)/2+nx*.15;z=(a.z+b.z)/2+nz*.15;}}}
      doc.deposits.push({id:uid('vein'),structureId:object.id,resource:(['ferrite','copper','crystal'] as const)[count%3],amount:12,x,z,surface:{kind:object.assetId==='hill'?'ground':'wall',y:0,nx,nz,width:object.assetId==='hill'?7:5}});
    });
  }
  private snap=true;
  private position(e:PointerEvent,camera:THREE.Camera=this.world.camera){const rect=this.world.renderer.domElement.getBoundingClientRect();this.ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);return this.ray.ray.intersectPlane(this.plane,new THREE.Vector3());}
  private cameraGesture(e:PointerEvent){return e.button===1||e.button===2||e.button===0&&e.altKey;}
  private pointerDown(e:PointerEvent){if(!this.active||e.button>2)return;if(this.skyMode){this.skyView.pointerDown(e);return;}if(this.sculptMode){this.beginSculpt(e);return;}const p=this.position(e);if(!p)return;const camera=this.cameraGesture(e);
    if(this.pendingAsset&&e.button===0&&!camera){const asset=this.pendingAsset;this.pendingAsset=null;this.place(asset,p.x,p.z);return;}
    let id:string|null=null;if(e.button===0&&!camera){const hits=this.ray.intersectObjects([...this.markers.children,...this.world.editorObjects,...this.world.lighting.objects],true);
      id=hits.map(h=>h.object.userData.lightId??h.object.userData.editorId??h.object.userData.structure?.id).find(Boolean)??null;if(id){this.history.current.selection=id;this.world.lighting.select(id);this.drawUI();this.drawMarkers();}}
    this.drag={id,start:p,last:p,camera:this.world.camera.clone(),view:{...this.cameraView}};if(e.isTrusted)this.world.renderer.domElement.setPointerCapture(e.pointerId);
  }
  private pointerMove(e:PointerEvent){if(!this.active)return;if(this.skyMode){this.skyView.pointerMove(e);return;}if(this.sculptMode){this.moveSculpt(e);return;}if(!this.drag)return;const p=this.position(e,this.drag.camera);if(!p)return;this.drag.last=p;
    if(!this.drag.id){this.cameraView.x=this.drag.view.x+this.drag.start.x-p.x;this.cameraView.z=this.drag.view.z+this.drag.start.z-p.z;}
    else {const lamp=this.document.lighting!.lamps.find(l=>l.id===this.drag!.id);if(lamp){const doc=structuredClone(this.document),next=doc.lighting!.lamps.find(l=>l.id===lamp.id)!;next.x=THREE.MathUtils.clamp(this.snapped(lamp.x+p.x-this.drag.start.x),-400,400);next.z=THREE.MathUtils.clamp(this.snapped(lamp.z+p.z-this.drag.start.z),-400,400);this.lightPreview(doc);return;}const object=this.document.objects.find(o=>o.id===this.drag!.id)??(this.generation?.newObject&&this.generation.object.id===this.drag!.id?this.generation.object:undefined),marker=this.markers.children.find(m=>m.userData.editorId===this.drag!.id),target=object??(this.drag.id==='spawn'?this.document.spawn:this.drag.id==='base'?this.document.base:this.document.shelters.find(s=>s.id===this.drag!.id));if(target){const next={...target,x:this.snapped(target.x+p.x-this.drag.start.x),z:this.snapped(target.z+p.z-this.drag.start.z)};if(object)this.world.previewEditorPlacement(object,{...object,...next});if(marker){marker.position.x=next.x;marker.position.z=next.z;}}}
  }
  private pointerUp(e:PointerEvent){if(!this.active)return;if(this.skyMode){this.skyView.pointerUp(e);return;}if(this.sculptMode){this.endSculpt(e);return;}if(!this.drag)return;const drag=this.drag;this.drag=null;
    if(this.world.renderer.domElement.hasPointerCapture(e.pointerId))this.world.renderer.domElement.releasePointerCapture(e.pointerId);
    if(!drag.id||drag.last.distanceTo(drag.start)<.4){this.world.clearEditorPlacement();this.previewDraft();this.applyCompletedWorld();return;}
    const dx=drag.last.x-drag.start.x,dz=drag.last.z-drag.start.z;
    if(this.generation?.newObject&&this.generation.object.id===drag.id){this.generation.object.x=this.snapped(this.generation.object.x+dx);this.generation.object.z=this.snapped(this.generation.object.z+dz);this.previewDraft();return;}
    if(this.document.lighting!.lamps.some(l=>l.id===drag.id)){this.lightChange(doc=>{const lamp=doc.lighting!.lamps.find(l=>l.id===drag.id)!;lamp.x=THREE.MathUtils.clamp(this.snapped(lamp.x+dx),-400,400);lamp.z=THREE.MathUtils.clamp(this.snapped(lamp.z+dz),-400,400);});return;}
    this.change(doc=>{const target=doc.objects.find(o=>o.id===drag.id)??(drag.id==='spawn'?doc.spawn:drag.id==='base'?doc.base:doc.shelters.find(s=>s.id===drag.id));if(!target)return;const before=structuredClone(target);target.x=this.snapped(target.x+dx);target.z=this.snapped(target.z+dz);if('assetId' in target)this.movePlanetOres(doc,before as PlacedObject,target as PlacedObject);});
  }
  private snapped(v:number){return this.snap?Math.round(v/2)*2:v;}
  private generate(action:GeneratorAction,position?:{x:number;z:number}){
    if(this.generation||this.sculptBusy||this.document.environment!=='space')return;
    if(position&&this.document.objects.length>=80){this.setStatus('Höchstens 80 Objekte.');return;}
    const existing=this.document.objects.find(o=>o.id===this.selection);
    if(!position&&(!existing||!this.sculptSource(existing)))return;
    if(this.sculptMode)this.leaveSculpt();this.toggleSky(false);
    if(this.generator.autoSeed)this.generator.seed=crypto.getRandomValues(new Uint32Array(1))[0]&0x7fffffff;
    const options=structuredClone(this.generator),source=position?newSculpt(uid('sculpt'),'block'):structuredClone(this.sculptSource(existing!)!);
    if(position)source.name='Zufallsasteroid · '+options.seed;
    const object:PlacedObject=position?{id:uid('object'),assetId:'sculpt-asteroid',x:this.snapped(position.x),z:this.snapped(position.z),rotation:0,scale:1,parameters:{sculptId:source.id}}:structuredClone(existing!);
    this.pendingAsset=null;this.cancelPendingSculpt();
    const worker=new Worker(new URL('./generator-worker.ts',import.meta.url),{type:'module'}),job:NonNullable<LevelEditor['generation']>={worker,object,source,newObject:!!position,action,options,targetBefore:position?'':JSON.stringify([this.sculptSource(existing!),this.document.deposits.filter(d=>d.structureId===object.id)]),selectionBefore:this.selection};
    this.generation=job;this.previewDraft();this.drawUI();this.setStatus('Asteroid wird generiert … · Esc oder Rückgängig bricht ab');
    const finish=(result:GenerationResult)=>{
      if(this.generation!==job)return;if(this.workingSource||this.workingOres||this.drag){job.result=result;worker.terminate();return;}worker.terminate();this.generation=null;
      const target=this.document.objects.find(o=>o.id===object.id);if(job.newObject&&this.document.objects.length>=80){this.previewDraft();this.drawUI();this.setStatus('Höchstens 80 Objekte.');return;}if(result.error||!job.newObject&&(!target||JSON.stringify([this.sculptSource(target),this.document.deposits.filter(d=>d.structureId===object.id)])!==job.targetBefore)){this.previewDraft();this.drawUI();this.setStatus(result.error??'Dieses Objekt wurde bearbeitet · Generierung verworfen.');return;}
      const replacing=(ore:LevelDocument['deposits'][number])=>ore.structureId===object.id&&(options.resource==='all'||ore.resource===options.resource);
      if(result.ores&&this.document.deposits.filter(d=>!replacing(d)).length+result.ores.length>128){this.previewDraft();this.drawUI();this.setStatus('Zu viele Erzschichten (höchstens 128).');return;}
      const previous=cloneDocument(this.document);
      this.history.change(snapshot=>{
        const doc=snapshot.level;
        if(job.newObject)doc.objects.push(object);
        const target=doc.objects.find(o=>o.id===object.id)!;
        // Imports may share form IDs; generation still edits only the selected placement.
        if(doc.objects.some(o=>o.id!==object.id&&o.parameters.sculptId===target.parameters.sculptId))result.source.id=uid('sculpt');
        target.parameters.sculptId=result.source.id;(doc.sculpts??={})[result.source.id]=structuredClone(result.source);
        if(result.ores){doc.deposits=doc.deposits.filter(d=>!replacing(d));for(const ore of result.ores)doc.deposits.push({id:uid('vein'),structureId:object.id,...ore,emission:{color:RESOURCES[ore.resource].color,intensity:ore.resource==='crystal'?.8:0}});}
        if(snapshot.selection===job.selectionBefore)snapshot.selection=object.id;
      });
      if(result.compiled)installSculpt(this.document.id,object.id,result.source,result.compiled,object.scale);
      this.refreshHistory(previous);this.drawMarkers();this.setStatus('Generiert · Rückgängig / Wiederholen verfügbar');
    };
    job.finish=finish;
    worker.onmessage=(event:MessageEvent<GenerationResult>)=>finish(event.data);
    worker.onerror=()=>finish({epoch:0,source,error:'Generierung fehlgeschlagen. Der Entwurf bleibt erhalten.'});
    const request:GenerationRequest={epoch:0,source,scale:object.scale,seed:options.seed,action,options,compiled:position?undefined:getSculpt(this.document.id,object.id)};worker.postMessage(request);
  }
  private cancelGeneration(){if(!this.generation)return;this.generation.worker.terminate();this.generation=null;if(this.history){this.previewDraft();this.drawUI();this.setStatus('Generierung abgebrochen');}}
  private place(assetId:string,x:number,z:number){if(this.sculptBusy)return;if(assetId==='generated'){this.generate(this.generator.extras?'all':'form',{x,z});return;}if(assetId.startsWith('lamp:')){if(this.document.lighting!.lamps.length>=96){this.setStatus('Höchstens 96 Lampen.');return;}const lamp=newLamp(uid('lamp'),assetId.slice(5) as LampKind,this.snapped(x),this.snapped(z));this.lightChange(doc=>doc.lighting!.lamps.push(lamp));this.history.current.selection=lamp.id;this.world.lighting.select(lamp.id);this.drawUI();return;}this.change(doc=>{
    x=this.snapped(x);z=this.snapped(z);
    if(assetId==='shelter'){const id=uid('shelter');doc.shelters.push({id,x,z,name:'S'+(doc.shelters.length+1),radius:12});this.history.current.selection=id;return;}
    const template=assetId.startsWith('template:')?this.templates.find(t=>t.id===assetId.slice(9)):undefined;
    if(assetId.startsWith('template:')&&!template)return;
    const id=uid('object'),sculpt=assetId.startsWith('shape:')||assetId==='sculpt-asteroid'||template;
    const source=sculpt?template?structuredClone(template.sculpt):newSculpt(uid('sculpt'),assetId.startsWith('shape:')?assetId.slice(6) as SculptDefinition['shape']:'block'):null;
    if(source){source.id=uid('sculpt');(doc.sculpts??={})[source.id]=source;assetId='sculpt-asteroid';}
    doc.objects.push({id,assetId,x,z,rotation:0,scale:1,parameters:source?{sculptId:source.id}:assetId==='hill'?{radius:32,height:26}:assetId==='cliff'?{halfX:5,halfZ:23,height:58,facing:1}:{}});
    if(template)for(const ore of template.ores)doc.deposits.push({id:uid('vein'),structureId:id,resource:ore.resource,amount:ore.paint?oreMass(ore.paint):ore.amount,paint:structuredClone(ore.paint),emission:structuredClone(ore.emission)});
    this.history.current.selection=id;
  });}
  private movePlanetOres(doc:LevelDocument,before:PlacedObject,after:PlacedObject){
    if(doc.environment!=='planet'){for(const d of doc.deposits.filter(d=>d.structureId===after.id))if(d.paint)d.amount=oreMass(d.paint,after.scale);return;}
    const c0=Math.cos(before.rotation),s0=Math.sin(before.rotation),c=Math.cos(after.rotation),s=Math.sin(after.rotation),scale=after.scale/before.scale;
    const rx=Number(after.parameters.radius??after.parameters.halfX)/Number(before.parameters.radius??before.parameters.halfX),rz=Number(after.parameters.radius??after.parameters.halfZ)/Number(before.parameters.radius??before.parameters.halfZ);
    for(const d of doc.deposits.filter(d=>d.structureId===after.id)){const dx=d.x!-before.x,dz=d.z!-before.z,lx=(dx*c0+dz*s0)*rx*scale,lz=(-dx*s0+dz*c0)*rz*scale;d.x=after.x+lx*c-lz*s;d.z=after.z+lx*s+lz*c;if(d.surface){const nx=(d.surface.nx*c0+d.surface.nz*s0)/rx,nz=(-d.surface.nx*s0+d.surface.nz*c0)/rz,length=Math.hypot(nx,nz);d.surface.nx=(nx*c-nz*s)/length;d.surface.nz=(nx*s+nz*c)/length;d.surface.width*=scale*Math.min(rx,rz);}}
  }
  private duplicate(){if([...this.document.lighting!.bodies,...this.document.lighting!.lamps].some(l=>l.id===this.selection)){this.element.querySelector<HTMLButtonElement>('#light-duplicate')?.click();return;}const o=this.document.objects.find(o=>o.id===this.selection);if(!o)return;if(this.sculptMode)this.leaveSculpt();this.change(doc=>{const copy=structuredClone(o);copy.id=uid('object');copy.x+=12;copy.z+=12;
    if(copy.assetId==='sculpt-asteroid'){const source=structuredClone(doc.sculpts![String(copy.parameters.sculptId)]);source.id=uid('sculpt');doc.sculpts![source.id]=source;copy.parameters.sculptId=source.id;}
    doc.objects.push(copy);for(const d of doc.deposits.filter(d=>d.structureId===o.id)){const next=structuredClone(d);next.id=uid('vein');next.structureId=copy.id;if(next.x!==undefined)next.x+=12;if(next.z!==undefined)next.z+=12;doc.deposits.push(next);}this.history.current.selection=copy.id;});}
  private remove(){if([...this.document.lighting!.bodies,...this.document.lighting!.lamps].some(l=>l.id===this.selection)){this.element.querySelector<HTMLButtonElement>('#light-delete')?.click();return;}const id=this.selection;if(!id||id==='spawn'||id==='base')return;if(this.sculptMode)this.leaveSculpt();this.change(doc=>{const object=doc.objects.find(o=>o.id===id);if(object?.assetId==='sculpt-asteroid')delete doc.sculpts?.[String(object.parameters.sculptId)];
    doc.objects=doc.objects.filter(o=>o.id!==id);doc.deposits=doc.deposits.filter(d=>d.structureId!==id);doc.shelters=doc.shelters.filter(s=>s.id!==id);this.history.current.selection=null;});}
  private cancelPendingSculpt(){this.sculptRevision++;this.workerInFlight=false;this.workerReady=false;this.sculptBusy=false;this.strokeQueue=[];this.workingSource=null;this.workingOres=null;}
  private refreshHistory(previous:LevelDocument){
    const signature=(d:LevelDocument)=>JSON.stringify(d,(key,value)=>['lighting','glow','emission'].includes(key)?undefined:value);
    if(signature(previous)===signature(this.document)&&JSON.stringify(THEMES[this.document.themeId])===JSON.stringify(this.history.current.theme)){this.lightPreview(this.document);this.drawUI();}else{this.cancelPendingSculpt();this.rebuild();if(this.sculptMode)this.resetWorker();}this.scheduleSave();
  }
  private undo(){if(this.skyView.dragging){this.skyView.cancel();return;}if(this.generation){this.cancelGeneration();return;}if(this.sculptDrag){this.cancelStroke();return;}const previous=this.document;if(this.history.undo())this.refreshHistory(previous);}
  private redo(){if(this.skyView.dragging){this.skyView.cancel();return;}if(this.generation){this.cancelGeneration();return;}if(this.sculptDrag)return;const previous=this.document;if(this.history.redo())this.refreshHistory(previous);}
  private key(e:KeyboardEvent){if(this.opening)return;if(!this.active)return;
    if(e.key==='Escape'&&this.drag){e.preventDefault();this.cancelPlacement();return;}
    if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.key.toLowerCase()==='y'||e.shiftKey?this.redo():this.undo();return;}
    if(e.key==='Escape'&&this.skyView.dragging){e.preventDefault();this.skyView.cancel();return;}
    if(e.key==='Escape'&&this.skyMode&&(this.skyView.preview||this.skyView.ringMode)){e.preventDefault();this.skyView.setPreview(false);this.skyView.alignRing(false);this.drawUI();return;}
    if(e.key==='Escape'&&this.generation){e.preventDefault();this.cancelGeneration();return;}
    if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLTextAreaElement)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();this.duplicate();}
    else if(e.key==='Delete'&&!this.sculptMode)this.remove();else if(e.key==='Escape'){if(this.sculptDrag){this.cancelStroke();}else if(this.skyMode)this.toggleSky(false);else if(this.sculptMode)this.leaveSculpt();else{this.pendingAsset=null;this.drawUI();}}
    else if(!this.skyMode&&(e.key.toLowerCase()==='q'||e.key.toLowerCase()==='e')){this.change(doc=>{const o=doc.objects.find(o=>o.id===this.selection);if(o){const before=structuredClone(o);o.rotation+=(e.key.toLowerCase()==='q'?-1:1)*Math.PI/12;this.movePlanetOres(doc,before,o);}});}
  }
  private drawMarkers(){
    disposeObject(this.markers);this.markers=new THREE.Group();this.markers.visible=this.active;this.world.scene.add(this.markers);
    if(!this.state||this.state.levelId!==this.document.id)return;const world=getLevelWorld(this.state.levelId);
    const items=[{id:'spawn',...this.document.spawn,radius:3},{id:'base',...this.document.base},...this.document.shelters,...this.document.objects.map(o=>({...o,radius:3}))];
    for(const item of this.sculptMode?[]:items){const selected=item.id===this.selection,warn=this.issues.some(i=>i.objectId===item.id);const color=warn?'#ff9870':selected?'#eff7c6':item.id==='spawn'?'#93e1b8':'#81a4af';
      const ring=new THREE.Mesh(new THREE.RingGeometry(item.radius-.25,item.radius+.25,48),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,depthTest:false,transparent:true,opacity:selected?1:.65}));ring.rotation.x=-Math.PI/2;ring.position.set(item.x,groundHeight(world,item.x,item.z)+.5,item.z);ring.renderOrder=20;ring.userData.editorId=item.id;this.markers.add(ring);
      // The whole marker disc is a hit target, including the empty visual centre.
      ring.raycast=(caster,hits)=>{const point=caster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-ring.position.y),new THREE.Vector3());
        if(point&&Math.hypot(point.x-ring.position.x,point.z-ring.position.z)<=item.radius+1)hits.push({distance:caster.ray.origin.distanceTo(point),point,object:ring});};
    }
    const solid=world.solids.find(s=>s.id===this.selection);if(solid&&!this.sculptMode){const footprint=getSolidFootprint(solid);if(footprint?.length){const points=footprint.concat(footprint[0]).map(p=>new THREE.Vector3(p.x,groundHeight(world,p.x,p.z)+.4,p.z));const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#ddedb4',depthTest:false,transparent:true,opacity:.8}));line.renderOrder=21;this.markers.add(line);}}
    const marker=(position:{x:number;y:number;z:number},label:string,warning:boolean,hostId:string)=>{
      const canvas=document.createElement('canvas');canvas.width=192;canvas.height=64;const ctx=canvas.getContext('2d')!;
      ctx.fillStyle='rgba(5,16,22,.94)';ctx.fillRect(0,0,192,64);ctx.strokeStyle=warning?'#ff9870':'#ddedb4';ctx.lineWidth=3;ctx.strokeRect(2,2,188,60);
      ctx.fillStyle=ctx.strokeStyle;ctx.font='bold 24px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,96,33);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false}));
      sprite.geometry.userData.shared=true;sprite.position.copy(position);sprite.scale.set(14,14/3,1);sprite.renderOrder=22;sprite.userData={editorId:hostId,};this.markers.add(sprite);
    };
    for(const ore of world.deposits){
      const invalid=ore.surface?.cells?.filter(c=>!c.valid)??[];
      if(invalid.length&&(!this.sculptMode||ore.structureId===this.selection)){
        const points:number[]=[];for(const c of invalid)for(const axis of [0,1,2]){const a=[c.x,c.y,c.z],b=[...a];a[axis]-=.8;b[axis]+=.8;points.push(...a,...b);}
        const line=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),new THREE.LineBasicMaterial({color:'#ff9870',depthTest:false}));line.name='invalid-ore-support';line.renderOrder=23;this.markers.add(line);
        marker(invalid[0],'! Träger fehlt',true,ore.structureId!);
      }else if(!this.sculptMode&&this.issues.some(i=>i.objectId===ore.id))marker({x:ore.x,y:(ore.surface?.y??0)+2,z:ore.z},'! Anflug',true,ore.structureId!);
    }
  }
  private play(){this.skyView.cancel();if(this.pendingWorld||this.generation||this.workingSource||this.workingOres||this.sculptBusy||this.issues.some(i=>i.severity==='error'))return;if(this.cookedWorld)this.cookedWorld=installLevel(this.document,{...this.cookedWorld,lighting:structuredClone(this.document.lighting!),deposits:this.cookedWorld.deposits.map(d=>({...d,emission:structuredClone(this.document.deposits.find(o=>o.id===d.id)?.emission)}))});this.skyBeforeTest=this.skyMode;this.skyMode=false;if(this.sculptMode){this.cancelPendingSculpt();this.sculptMode=false;this.cameraView={...this.levelCamera};}void this.persist();this.world.lighting.select(null);this.active=false;this.testing=true;this.element.hidden=true;this.markers.visible=false;this.returnButton.hidden=false;this.world.setEditorView(null);document.body.classList.remove('editor-open');this.callbacks.play(this.document.id);}
  private returnFromTest(){this.skyMode=this.skyBeforeTest;this.active=true;this.testing=false;this.returnButton.hidden=true;this.element.hidden=false;document.body.classList.add('editor-open');this.world.applyEditorWorld(this.state,this.document);this.world.setEditorView(this.view());this.rebuild();}
  private download(){if(this.sculptBusy){this.setStatus('Bitte die laufende Formberechnung abwarten.');return;}const url=URL.createObjectURL(new Blob([exportLevel(packageLevel(this.document))],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=this.document.name.replace(/[^\p{L}\p{N}_-]/gu,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.setStatus('JSON exportiert');}
}
