import * as THREE from 'three';
import {LightingWorld} from './lighting-world';
import {themeLighting} from './lighting';
import {DOCUMENTS,type LevelDocument,type PlacedObject} from './level-document';
import {setRockGlow} from './stone-material';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG, SPACE } from './config';
import { type State } from './simulation';
import { getLevelWorld, groundHeight, type LevelId, type LevelWorld } from './levels';
import { ResourceWorld } from './resource-world';
import { AssetLibrary, disposeObject } from './assets';
import { Landscape } from './landscape';
import { Atmosphere } from './atmosphere';
import { RenderPipeline, type Quality } from './render-pipeline';
import { turretYaw, vehiclePose, type VehiclePose } from './vehicle-pose';
import { thrusterLevels, type ThrusterName } from './flight-motion';
import { AtlasWorld } from './atlas-world';
import { atlasPlacement } from './atlas-rig';
import { deploymentActive, deploymentFrame } from './deployment';
import {GAME_CAMERA_OFFSET} from './game-camera';

export class World {
  readonly lighting:LightingWorld;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-100, 100, 50, -50, .5, 700);
  readonly renderer: THREE.WebGLRenderer;
  readonly ready: Promise<void>;
  readonly assets: AssetLibrary;
  private pipeline: RenderPipeline;
  private ship = new THREE.Group();
  private turret: THREE.Object3D | null = null;
  private muzzle = new THREE.Object3D();
  private muzzlePosition = new THREE.Vector3();
  private exhaust: {mesh:THREE.Mesh;name:ThrusterName;intensity:number}[] = [];
  private root = new THREE.Group();
  private resources!: ResourceWorld;
  private atlas!: AtlasWorld;
  private world: LevelWorld;
  private landscape!: Landscape;
  private atmosphere!: Atmosphere;
  private sun = new THREE.DirectionalLight('#fff0d4', 3.4);
  private ambient = new THREE.HemisphereLight('#d7e2e8', '#786444', 1.25);
  private aimRay = new THREE.Raycaster();
  private follow = new THREE.Vector3(25, 0, 36);
  private desired = new THREE.Vector3();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SPACE.flightHeight);
  private point = new THREE.Vector3();
  private dummy = new THREE.Object3D();
  private loaded = false;
  private disposed = false;
  private selectedQuality: Quality = 'high';
  private environment: THREE.WebGLRenderTarget;
  private lastHeading = 0;
  private pose: VehiclePose | null = null;
  private onResize = () => this.resize();
  private previewScene=new THREE.Scene();private previewCamera=new THREE.Camera();
  private previewMaterial=new THREE.ShaderMaterial({uniforms:{image:{value:null}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'varying vec2 vUv;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,vUv);}',depthTest:false,depthWrite:false,toneMapped:false});
  constructor(container: HTMLElement, levelId: LevelId = 'aster') {
    this.world = getLevelWorld(levelId);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false; container.append(this.renderer.domElement);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -145, right: 145, top: 145, bottom: -145, near: 1, far: 450 });
    this.sun.shadow.bias = -.0002; this.sun.shadow.normalBias = .12;
    this.scene.add(this.sun, this.sun.target, this.ambient);
    this.lighting=new LightingWorld(this.scene,this.sun);
    this.camera.up.set(0, 0, -1);
    const pmrem = new THREE.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04); this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .24; room.dispose(); pmrem.dispose();
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera); this.assets = new AssetLibrary(this.renderer);
    this.pipeline.setSky(this.lighting.skyScene,this.lighting.skyCamera);
    this.previewScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.previewMaterial));
    window.addEventListener('resize', this.onResize); this.resize();
    this.ready = this.assets.load((loaded, total, label) => this.renderer.domElement.dispatchEvent(new CustomEvent('asset-progress', { detail: { loaded, total, label } }))).then(() => {
      if (this.disposed) { this.assets.dispose(); return; }
      this.createShip(); this.loadLevel(this.world.definition.id); this.loaded = true; this.setQuality(this.selectedQuality);
    });
  }
  get levelWorld(){return this.world;}
  get editorObjects(){return this.landscape?.solids??[];}
  previewEditorDraft(document:LevelDocument){if(this.loaded&&this.world.definition.id===document.id)this.landscape.previewDraft(document);}
  previewEditorPlacement(before:PlacedObject,after:PlacedObject){
    const mesh=this.editorObjects.find(m=>m.userData.structure.id===before.id);if(!mesh)return;
    if(before.assetId==='sculpt-asteroid'){mesh.position.set(after.x,2.4,after.z);mesh.rotation.y=-after.rotation;mesh.scale.setScalar(after.scale);}
    else mesh.position.set(after.x,mesh.position.y,after.z);
    mesh.updateMatrixWorld(true);
    const frame=(o:PlacedObject)=>new THREE.Matrix4().compose(new THREE.Vector3(o.x,2.4,o.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-o.rotation),new THREE.Vector3().setScalar(o.scale));
    this.resources.previewPlacement(before.id,frame(after).multiply(frame(before).invert()));
  }
  clearEditorPlacement(){this.resources?.clearPlacementPreview();}
  applyEditorWorld(s:State,document:LevelDocument,preserveId?:string){
    const next=getLevelWorld(s.levelId),old=this.world;
    const incremental=this.loaded&&old.definition.id===next.definition.id&&next.definition.environment==='space'&&old.bounds===next.bounds&&old.definition.seed===next.definition.seed&&JSON.stringify(old.theme)===JSON.stringify(next.theme);
    if(!incremental){this.reset(s);return;}
    this.world=next;this.landscape.syncSpace(next,document,this.selectedQuality,preserveId);this.resources.syncSpace(next);
    if(JSON.stringify(old.base)!==JSON.stringify(next.base)){disposeObject(this.atlas.root);this.atlas=new AtlasWorld(next,this.assets);this.root.add(this.atlas.root);this.atlas.setQuality(this.selectedQuality);}
    this.lighting.set(next.lighting,next);this.lighting.setRockSources(document);
  }
  previewLighting(document:LevelDocument){
    this.lighting.set(document.lighting??themeLighting(this.world.theme),this.world);this.lighting.setRockSources(document);
    for(const mesh of this.editorObjects){const object=document.objects.find(o=>o.id===mesh.userData.structure?.id),source=object&&document.sculpts?.[String(object.parameters.sculptId)];if(source){
      // Quality changes recreate materials from this source; retain the live appearance too.
      if(mesh.userData.sculpt)mesh.userData.sculpt.source={...mesh.userData.sculpt.source,glow:structuredClone(source.glow)};
      mesh.traverse(o=>{if(o instanceof THREE.Mesh)setRockGlow(o.material as THREE.MeshStandardMaterial,source.glow);});
    }}
    this.resources?.setEmissions(document.deposits);
  }
  private editorView: {x:number;z:number;zoom:number;orbit?:{yaw:number;pitch:number}}|null=null;
  setEditorView(view:{x:number;z:number;zoom:number;orbit?:{yaw:number;pitch:number}}|null){this.editorView=view;this.ship.visible=!view;this.camera.zoom=view?.zoom??1;this.camera.updateProjectionMatrix();}
  get quality() { return this.selectedQuality; }
  setQuality(quality: Quality) {
    this.selectedQuality = quality; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.5 : 1));
    this.pipeline.setQuality(quality); const size = quality === 'high' ? 2048 : 1024;
    this.lighting.setQuality(quality==='high');
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (this.loaded) { this.landscape.setQuality(quality); this.atmosphere.setQuality(quality); this.resources.setQuality(quality); this.atlas.setQuality(quality); }
    this.resize();
  }
  private loadLevel(id: LevelId) {
    disposeObject(this.root); this.root = new THREE.Group(); this.scene.add(this.root); this.world = getLevelWorld(id);
    const space = this.world.definition.environment === 'space',theme=this.world.theme;
    this.scene.background = null;
    this.scene.fog = space ? null : new THREE.FogExp2(theme.fogColor,theme.fogDensity);
    this.ambient.color.set(theme.ambientColor); this.ambient.groundColor.set(theme.groundColor); this.ambient.intensity = theme.ambientIntensity;
    this.scene.environmentIntensity = space ? .35 : .23;
    this.pipeline.ao.blendIntensity = space ? .45 : .65;
    this.renderer.domElement.setAttribute('aria-label', space ? 'Asteroidengürtel mit Erzadern, ATLAS und fliegenden Asteroiden' : 'Aster mit Bergen, Schluchten, Erzadern und Schutzmulden');
    this.landscape = new Landscape(this.world, this.assets); this.root.add(this.landscape.root);
    this.lighting.setBackdrop(this.landscape.root.children.filter(o=>o.userData.skyBackdrop));
    this.atmosphere = new Atmosphere(this.world); this.root.add(this.atmosphere.root);
    this.resources = new ResourceWorld(this.root, this.world, this.assets);
    this.atlas = new AtlasWorld(this.world,this.assets); this.root.add(this.atlas.root); this.atlas.setQuality(this.selectedQuality);
    this.landscape.setQuality(this.selectedQuality); this.atmosphere.setQuality(this.selectedQuality); this.resources.setQuality(this.selectedQuality);
    this.lighting.set(this.world.lighting,this.world);
    const doc=DOCUMENTS.get(id);if(doc)this.lighting.setRockSources(doc);
  }
  private createShip() {
    this.ship = this.assets.instantiate('speeder'); this.ship.name='player-speeder'; this.turret = this.ship.getObjectByName('mining_turret') ?? null;
    this.muzzle = this.ship.getObjectByName('laser_socket') ?? new THREE.Object3D();
    if (!this.muzzle.parent) { this.muzzle.position.set(0, 1, -2.7); (this.turret ?? this.ship).add(this.muzzle); }
    const geometry = new THREE.ConeGeometry(.24, 2.3, 12); geometry.rotateX(Math.PI / 2); geometry.translate(0, 0, 1.05);
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7febd5').multiplyScalar(2.2), transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const name of ['exhaust_left', 'exhaust_right','reverse_left','reverse_right','side_left_front','side_left_aft','side_right_front','side_right_aft'] as const) {
      const anchor = this.ship.getObjectByName(name); if (!anchor) continue;
      const flame = new THREE.Mesh(geometry, material);flame.name='flame_'+name;
      if(name.startsWith('reverse'))flame.rotation.y=Math.PI;
      if(name.startsWith('side_')){flame.rotation.y=name.includes('_left_')?-Math.PI/2:Math.PI/2;flame.scale.set(.6,.6,.6);}
      anchor.add(flame); this.exhaust.push({mesh:flame,name,intensity:0});
    }
    this.scene.add(this.ship);
  }
  resize(width = window.innerWidth, height = window.innerHeight) {
    const w = Math.max(1, width), h = Math.max(1, height), halfHeight = w < 681 ? 60 : 50;
    this.renderer.setSize(w, h); this.camera.top = halfHeight; this.camera.bottom = -halfHeight;
    this.camera.left = -halfHeight * w / h; this.camera.right = halfHeight * w / h; this.camera.updateProjectionMatrix(); this.pipeline.resize(w, h);
  }
  reset(s: State) {
    if (this.loaded) this.loadLevel(s.levelId);
    else if (!this.loaded) this.world = getLevelWorld(s.levelId);
    this.follow.set(s.x, groundHeight(this.world, s.x, s.z), s.z); this.lastHeading = s.heading; this.pose = null;
  }
  mouseAim(pointer: { x: number; y: number }, s: State): number | null {
    if (!this.loaded) return null;
    this.aimRay.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), this.camera);
    const ore = this.aimRay.intersectObjects(this.resources.aimTargets, false)[0];
    const solid = this.aimRay.intersectObjects(this.landscape.solids, false)[0];
    let point: THREE.Vector3 | undefined = ore && (!solid || ore.distance <= solid.distance + 0.5) ? ore.point : solid?.point;
    // Solve against the shared height field rather than raycasting 200k terrain
    // triangles on every pointer frame. Bracket then bisect the downward ray.
    if (this.world.definition.environment === 'planet') {
      let lo = 0, hi = 650;
      for (let i = 0; i < 24; i++) { const t = (lo + hi) / 2; this.aimRay.ray.at(t, this.point); if (this.point.y > groundHeight(this.world, this.point.x, this.point.z)) lo = t; else hi = t; }
      this.aimRay.ray.at(hi, this.point);
      if (!point || this.point.distanceTo(this.aimRay.ray.origin) < point.distanceTo(this.aimRay.ray.origin)) point = this.point;
    } else point ??= this.aimRay.ray.intersectPlane(this.plane, this.point) ?? undefined;
    if (!point) return null;
    const dx = point.x - s.x, dz = point.z - s.z; return Math.hypot(dx, dz) < .5 ? null : Math.atan2(dx, -dz);
  }
  render(s: State, dt: number, thrust: number,offscreen=false) {
    if (!this.loaded || this.disposed) return;
    if (this.world !== getLevelWorld(s.levelId)) this.reset(s);
    const ground = groundHeight(this.world, s.x, s.z), space = s.environment.kind === 'space';
    const deploying=deploymentActive(s.deployment)&&!this.editorView;
    const intro=deploying?deploymentFrame(this.world,s.deployment!.time):null;
    this.atlas.render(this.editorView?null:s.deployment);
    this.desired.set(this.editorView?.x??s.x, this.editorView?.orbit?2.4:this.editorView?0:ground, this.editorView?.z??s.z); this.follow.lerp(this.desired, dt > 0 ? 1 - Math.exp(-dt * 6) : 1);
    if(intro) {
      const p=atlasPlacement(this.world),focus=new THREE.Vector3(p.x*.75+this.world.base.x*.25,p.height+4+intro.shipOffset.y*.65,p.z*.75+this.world.base.z*.25);
      this.follow.copy(this.desired).lerp(focus,intro.camera);
      const aspect=this.renderer.domElement.clientWidth/Math.max(1,this.renderer.domElement.clientHeight);
      const arrivalZoom=1.4+.8*Math.min(1,s.deployment!.time/2.5);
      this.camera.zoom=1+(Math.min(arrivalZoom,Math.max(1,aspect*2.3))-1)*intro.camera;this.camera.updateProjectionMatrix();
    } else if(!this.editorView&&this.camera.zoom!==1){this.camera.zoom=1;this.camera.updateProjectionMatrix();}
    const cameraBlend=intro?.camera??0,atlasYaw=atlasPlacement(this.world).yaw;
    const cameraX=(Math.sin(atlasYaw)*125+Math.cos(atlasYaw)*45)*cameraBlend;
    const cameraZ=THREE.MathUtils.lerp(GAME_CAMERA_OFFSET.z,Math.cos(atlasYaw)*125-Math.sin(atlasYaw)*45,cameraBlend);
    this.camera.up.set(0,cameraBlend,-(1-cameraBlend));
    this.camera.position.set(this.follow.x+cameraX,this.follow.y+GAME_CAMERA_OFFSET.y-45*cameraBlend,this.follow.z+cameraZ);this.camera.lookAt(this.follow);
    if(this.editorView?.orbit){const {yaw,pitch}=this.editorView.orbit,distance=120;
      this.camera.up.set(0,1,0);this.camera.position.set(this.follow.x+Math.sin(yaw)*Math.cos(pitch)*distance,this.follow.y+Math.sin(pitch)*distance,this.follow.z+Math.cos(yaw)*Math.cos(pitch)*distance);this.camera.lookAt(this.follow);
    }
    const turn = dt > 0 ? Math.atan2(Math.sin(s.heading - this.lastHeading), Math.cos(s.heading - this.lastHeading)) / dt : 0;
    const bank=THREE.MathUtils.clamp(turn*.025,-.045,.045), hover=CONFIG.hoverHeight+Math.sin(s.elapsed*3)*.09;
    const simulated=s.surfacePose, currentPose=simulated&&simulated.x===s.x&&simulated.z===s.z&&simulated.heading===s.heading&&simulated.elapsed===s.elapsed;
    this.pose=intro?intro.player:space ? {height:SPACE.flightHeight,pitch:0,roll:THREE.MathUtils.lerp(this.pose?.roll??0,bank,1-Math.exp(-dt*7))}
      : currentPose ? simulated : vehiclePose((x,z)=>groundHeight(this.world,x,z),{x:s.x,z:s.z,heading:s.heading,hover,bank},this.pose,dt);
    this.ship.position.set(s.x,this.pose.height,s.z); this.ship.rotation.set(this.pose.pitch,-s.heading,this.pose.roll,'YXZ');
    this.lastHeading = s.heading;
    if (this.turret) {
      // Keep world aiming stable when the hull pitches or rolls under the turret.
      this.turret.rotation.y=turretYaw(s.heading,this.pose.pitch,this.pose.roll,s.turret);
    }
    this.ship.updateMatrixWorld(true); this.muzzle.getWorldPosition(this.muzzlePosition); this.resources.render(s, this.muzzlePosition, dt > 0);
    const jets=thrusterLevels(s.forces);
    for (const jet of this.exhaust) {
      const target=s.dead?0:intro?(jet.name.startsWith('exhaust_')?intro.drive:0):jets[jet.name];jet.intensity=intro?target:dt>0?THREE.MathUtils.lerp(jet.intensity,target,1-Math.exp(-dt*20)):target;
      jet.mesh.visible=jet.intensity>.025;
      const small=jet.name.startsWith('side_')?.6:1;
      jet.mesh.scale.set(small*(.45+jet.intensity*.55),small*(.45+jet.intensity*.55),small*(.2+jet.intensity*1.1)*(1+Math.sin(s.elapsed*35)*.04));
    }
    this.atmosphere.update(s, deploying?0:dt, deploying?0:thrust, this.follow); this.landscape.animate(s.elapsed);
    const intensity = this.atmosphere.intensity;
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = this.world.theme.fogDensity + intensity * .0015;
    for (const mesh of this.landscape.solids) {
      const structure = mesh.userData.structure;
      const near = structure.kind === 'cliff' && Math.abs(s.x - structure.x) < structure.halfX + 9 && s.z < structure.z && s.z > structure.z - structure.halfZ - 36;
      const opacity = near ? .22 : 1;
      if (mesh.material.opacity !== opacity) { mesh.material.opacity = opacity; mesh.material.transparent = near; mesh.material.depthWrite = !near; mesh.material.needsUpdate = true; }
    }
    const moving = this.landscape.moving;
    if (moving && s.environment.kind === 'space') {
      for (let i = 0; i < s.environment.asteroids.length; i++) { const a = s.environment.asteroids[i]; this.dummy.position.set(a.x, SPACE.flightHeight, a.z); this.dummy.rotation.set(a.rotation, a.rotation * .7, 0); this.dummy.scale.setScalar(a.radius); this.dummy.updateMatrix(); moving.setMatrixAt(i, this.dummy.matrix); }
      moving.count = s.environment.asteroids.length; moving.instanceMatrix.needsUpdate = true;
    }
    this.camera.updateMatrixWorld();this.lighting.update(this.camera,this.follow,this.editorView?performance.now()/1000:s.elapsed,dt,s,intensity);
    if(offscreen)return this.pipeline.renderOffscreen(dt);this.pipeline.render(dt);
  }
  renderGamePreview(s:State,region:DOMRect){
    const saved=this.editorView;this.setEditorView(null);
    const renderer=this.renderer,viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
    try{
      const image=this.render(s,0,0,true);if(!image)return;
      const canvas=renderer.domElement.getBoundingClientRect(),size=renderer.getSize(new THREE.Vector2()),aspect=size.x/size.y,availableW=Math.max(1,region.width-24),availableH=Math.max(1,region.height-190),w=Math.min(availableW,availableH*aspect),h=w/aspect;
      renderer.setRenderTarget(null);renderer.setScissorTest(false);renderer.setViewport(0,0,size.x,size.y);renderer.setClearColor('#060e19',1);renderer.clear();
      renderer.setViewport((region.left-canvas.left+(region.width-w)/2)/canvas.width*size.x,(canvas.bottom-region.top-130-(availableH-h)/2-h)/canvas.height*size.y,w/canvas.width*size.x,h/canvas.height*size.y);
      renderer.setScissor(renderer.getViewport(new THREE.Vector4()));renderer.setScissorTest(true);this.previewMaterial.uniforms.image.value=image;renderer.render(this.previewScene,this.previewCamera);
    }finally{renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.setClearColor(clear,alpha);this.setEditorView(saved);}
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; window.removeEventListener('resize', this.onResize);
    disposeObject(this.previewScene);this.lighting.dispose();disposeObject(this.root); disposeObject(this.ship); this.assets.dispose(); this.pipeline.dispose(); this.environment.dispose(); this.sun.shadow.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
