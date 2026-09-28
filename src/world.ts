import * as THREE from 'three';
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

export class World {
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
  private exhaust: THREE.Mesh[] = [];
  private root = new THREE.Group();
  private resources!: ResourceWorld;
  private world: LevelWorld;
  private landscape!: Landscape;
  private atmosphere!: Atmosphere;
  private sun = new THREE.DirectionalLight('#fff0d4', 3.4);
  private ambient = new THREE.HemisphereLight('#d7e2e8', '#786444', 1.25);
  private rim = new THREE.DirectionalLight('#a1d5df', .3);
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
  constructor(container: HTMLElement, levelId: LevelId = 'aster') {
    this.world = getLevelWorld(levelId);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false; container.append(this.renderer.domElement);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -145, right: 145, top: 145, bottom: -145, near: 1, far: 450 });
    this.sun.shadow.bias = -.0002; this.sun.shadow.normalBias = .12;
    this.rim.position.set(80, 40, 100); this.scene.add(this.sun, this.sun.target, this.ambient, this.rim);
    this.camera.up.set(0, 0, -1);
    const pmrem = new THREE.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04); this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .24; room.dispose(); pmrem.dispose();
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera); this.assets = new AssetLibrary(this.renderer);
    window.addEventListener('resize', this.onResize); this.resize();
    this.ready = this.assets.load((loaded, total, label) => this.renderer.domElement.dispatchEvent(new CustomEvent('asset-progress', { detail: { loaded, total, label } }))).then(() => {
      if (this.disposed) { this.assets.dispose(); return; }
      this.createShip(); this.loadLevel(this.world.definition.id); this.loaded = true; this.setQuality(this.selectedQuality);
    });
  }
  get quality() { return this.selectedQuality; }
  setQuality(quality: Quality) {
    this.selectedQuality = quality; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.5 : 1));
    this.pipeline.setQuality(quality); const size = quality === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (this.loaded) { this.landscape.setQuality(quality); this.atmosphere.setQuality(quality); this.resources.setQuality(quality); }
    this.resize();
  }
  private loadLevel(id: LevelId) {
    disposeObject(this.root); this.root = new THREE.Group(); this.scene.add(this.root); this.world = getLevelWorld(id);
    const space = id === 'belt';
    this.scene.background = new THREE.Color(space ? '#050a11' : '#333c32');
    this.scene.fog = space ? null : new THREE.FogExp2('#b5ac8e', .00065);
    this.ambient.color.set(space ? '#91aecb' : '#dce5d7'); this.ambient.groundColor.set(space ? '#101b31' : '#77664d'); this.ambient.intensity = space ? .9 : 1.15;
    this.sun.color.set(space ? '#dce5ec' : '#fff1d2'); this.rim.color.set(space ? '#efbb87' : '#bbd9cc'); this.rim.intensity = space ? 1.6 : .25;
    this.scene.environmentIntensity = space ? .35 : .23;
    this.pipeline.ao.blendIntensity = space ? .45 : .65;
    this.renderer.domElement.setAttribute('aria-label', space ? 'Asteroidengürtel mit Erzadern, ATLAS und fliegenden Asteroiden' : 'Aster mit Bergen, Schluchten, Erzadern und Schutzmulden');
    this.landscape = new Landscape(this.world, this.assets); this.root.add(this.landscape.root);
    this.atmosphere = new Atmosphere(this.world); this.root.add(this.atmosphere.root);
    this.resources = new ResourceWorld(this.root, this.world, this.assets);
    this.landscape.setQuality(this.selectedQuality); this.atmosphere.setQuality(this.selectedQuality); this.resources.setQuality(this.selectedQuality);
  }
  private createShip() {
    this.ship = this.assets.instantiate('speeder'); this.ship.name='player-speeder'; this.turret = this.ship.getObjectByName('mining_turret') ?? null;
    this.muzzle = this.ship.getObjectByName('laser_socket') ?? new THREE.Object3D();
    if (!this.muzzle.parent) { this.muzzle.position.set(0, 1, -2.7); (this.turret ?? this.ship).add(this.muzzle); }
    const geometry = new THREE.ConeGeometry(.24, 2.3, 12); geometry.rotateX(Math.PI / 2); geometry.translate(0, 0, 1.05);
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7febd5').multiplyScalar(2.2), transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const name of ['exhaust_left', 'exhaust_right']) {
      const anchor = this.ship.getObjectByName(name); if (!anchor) continue;
      const flame = new THREE.Mesh(geometry, material); anchor.add(flame); this.exhaust.push(flame);
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
  render(s: State, dt: number, thrust: number) {
    if (!this.loaded || this.disposed) return;
    if (this.world.definition.id !== s.levelId) this.reset(s);
    const ground = groundHeight(this.world, s.x, s.z), space = s.environment.kind === 'space';
    this.desired.set(s.x, ground, s.z); this.follow.lerp(this.desired, dt > 0 ? 1 - Math.exp(-dt * 6) : 1);
    this.camera.position.set(this.follow.x, this.follow.y + 165, this.follow.z + 120); this.camera.lookAt(this.follow);
    const sx = Math.round(this.follow.x * 8) / 8, sz = Math.round(this.follow.z * 8) / 8;
    this.sun.position.set(sx - 100, 180, sz - 90); this.sun.target.position.set(sx, 0, sz); this.sun.target.updateMatrixWorld();
    const turn = dt > 0 ? Math.atan2(Math.sin(s.heading - this.lastHeading), Math.cos(s.heading - this.lastHeading)) / dt : 0;
    const bank=THREE.MathUtils.clamp(turn*.025,-.045,.045), hover=CONFIG.hoverHeight+Math.sin(s.elapsed*3)*.09;
    const simulated=s.surfacePose, currentPose=simulated&&simulated.x===s.x&&simulated.z===s.z&&simulated.heading===s.heading&&simulated.elapsed===s.elapsed;
    this.pose=space ? {height:SPACE.flightHeight,pitch:0,roll:THREE.MathUtils.lerp(this.pose?.roll??0,bank,1-Math.exp(-dt*7))}
      : currentPose ? simulated : vehiclePose((x,z)=>groundHeight(this.world,x,z),{x:s.x,z:s.z,heading:s.heading,hover,bank},this.pose,dt);
    this.ship.position.set(s.x,this.pose.height,s.z); this.ship.rotation.set(this.pose.pitch,-s.heading,this.pose.roll,'YXZ');
    this.lastHeading = s.heading;
    if (this.turret) {
      // Keep world aiming stable when the hull pitches or rolls under the turret.
      this.turret.rotation.y=turretYaw(s.heading,this.pose.pitch,this.pose.roll,s.turret);
    }
    this.ship.updateMatrixWorld(true); this.muzzle.getWorldPosition(this.muzzlePosition); this.resources.render(s, this.muzzlePosition, dt > 0);
    for (const flame of this.exhaust) { flame.visible = !s.dead && s.speed >= 0 && (thrust > 0 || s.speed > 3); flame.scale.z = .35 + thrust * .85 + Math.sin(s.elapsed * 35) * .06; }
    this.atmosphere.update(s, dt, thrust, this.follow); this.landscape.animate(s.elapsed);
    const intensity = this.atmosphere.intensity; this.sun.intensity = (space ? 3.2 : 3.5) - intensity * 1.7;
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = .00065 + intensity * .0015;
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
    this.pipeline.render(dt);
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; window.removeEventListener('resize', this.onResize);
    disposeObject(this.root); disposeObject(this.ship); this.assets.dispose(); this.pipeline.dispose(); this.environment.dispose(); this.sun.shadow.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
