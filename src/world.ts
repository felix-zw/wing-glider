import * as THREE from 'three';
import { CONFIG, SPACE } from './config';
import { type State } from './simulation';
import { getLevelWorld, groundHeight, seededRandom, type LevelId, type LevelWorld } from './levels';
import { contains } from './collision';
import { ResourceWorld } from './resource-world';

function disposeGroup(root: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(mat);
  });
  for (const mat of materials) { for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value); mat.dispose(); }
  geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); root.clear(); root.removeFromParent();
}
export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-80, 80, 66, -66, 0.1, 1000);
  readonly renderer: THREE.WebGLRenderer;
  private ship = new THREE.Group(); private turret = new THREE.Group(); private muzzle = new THREE.Object3D();
  private muzzlePosition = new THREE.Vector3(); private exhaust: THREE.Mesh[] = [];
  private root = new THREE.Group(); private resources!: ResourceWorld; private world!: LevelWorld;
  private terrain: THREE.Mesh | null = null; private solids: THREE.Mesh[] = [];
  private flying: THREE.InstancedMesh | null = null; private dust: THREE.LineSegments | null = null;
  private sun = new THREE.DirectionalLight('#fff0cf', 3.1);
  private ambient = new THREE.HemisphereLight('#e9f2dc', '#665243', 2.5);
  private aimRay = new THREE.Raycaster(); private follow = new THREE.Vector3(25, 0, 36);
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SPACE.flightHeight); private point = new THREE.Vector3();
  private dummy = new THREE.Object3D(); private intensity = 0;
  private onResize = () => this.resize();
  constructor(container: HTMLElement, levelId: LevelId = 'aster') {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; container.append(this.renderer.domElement);
    this.sun.position.set(-90, 180, -65); this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -270, right: 270, top: 270, bottom: -270, far: 600 });
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun, this.ambient); this.camera.up.set(0, 0, -1);
    this.createShip(); this.loadLevel(levelId);
    window.addEventListener('resize', this.onResize); this.resize();
  }
  private loadLevel(id: LevelId) {
    disposeGroup(this.root); this.root = new THREE.Group(); this.scene.add(this.root);
    this.terrain = null; this.solids = []; this.flying = null; this.dust = null;
    this.world = getLevelWorld(id); this.intensity = 0;
    const space = id === 'belt';
    this.renderer.setClearColor(space ? '#060a19' : '#242c29');
    this.ambient.color.set(space ? '#b6cff5' : '#e9f2dc'); this.ambient.groundColor.set(space ? '#262340' : '#665243');
    this.ambient.intensity = space ? 1.7 : 2.5; this.sun.color.set(space ? '#ccdfff' : '#fff0cf');
    this.renderer.domElement.setAttribute('aria-label', space ? 'Asteroidengürtel mit Erzadern, ATLAS und fliegenden Asteroiden' : 'Aster mit Bergen, Schluchten, Erzadern und Schutzmulden');
    if (space) this.createSpace(); else { this.createTerrain(); this.createShelters(); this.createDust(); }
    this.createStructures(); this.resources = new ResourceWorld(this.root, this.world);
    const points: THREE.Vector3[] = [];
    for (let edge = 0; edge < 4; edge++) for (let i = 0; i <= 100; i++) {
      const t = -CONFIG.worldHalf + i / 100 * CONFIG.worldHalf * 2;
      const x = edge === 0 ? t : edge === 1 ? CONFIG.worldHalf : edge === 2 ? -t : -CONFIG.worldHalf;
      const z = edge === 0 ? -CONFIG.worldHalf : edge === 1 ? t : edge === 2 ? CONFIG.worldHalf : -t;
      points.push(new THREE.Vector3(x, groundHeight(this.world, x, z) + 0.3, z));
    }
    const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: space ? '#506897' : '#eac490', dashSize: 3, gapSize: 2 }));
    border.computeLineDistances(); this.root.add(border);
  }
  private createTerrain() {
    const geo = new THREE.PlaneGeometry(480, 480, 240, 240); geo.rotateX(-Math.PI / 2);
    const vertices = geo.attributes.position, colors: number[] = [], random = seededRandom(this.world.definition.seed);
    const low = new THREE.Color('#889377'), high = new THREE.Color('#655f56');
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), z = vertices.getZ(i), h = groundHeight(this.world, x, z); vertices.setY(i, h);
      const c = low.clone().lerp(high, THREE.MathUtils.clamp((h - 12) / 28, 0, 1)).multiplyScalar(0.95 + random() * 0.1); colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    this.terrain.receiveShadow = true; this.root.add(this.terrain);
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), new THREE.MeshStandardMaterial({ color: '#707361', roughness: 1, flatShading: true }), 240);
    let count = 0;
    for (let attempt = 0; count < 240 && attempt < 3000; attempt++) {
      const x = random() * 450 - 225, z = random() * 450 - 225;
      if (this.world.shelters.some(s => Math.hypot(s.x - x, s.z - z) < 25) || this.world.solids.some(s => contains(s, { x, z }, 5)) || this.world.deposits.some(d => Math.hypot(d.x - x, d.z - z) < 8)) continue;
      const size = 0.4 + random() * 1.7; this.dummy.position.set(x, groundHeight(this.world, x, z), z);
      this.dummy.rotation.set(random(), random() * Math.PI, random()); this.dummy.scale.set(size * 1.4, size * 0.6, size); this.dummy.updateMatrix(); rocks.setMatrixAt(count++, this.dummy.matrix);
    }
    rocks.count = count; rocks.castShadow = rocks.receiveShadow = true; this.root.add(rocks);
  }
  private createStructures() {
    for (const s of this.world.solids) {
      let geometry: THREE.BufferGeometry, y: number;
      if (s.kind === 'asteroid') { geometry = new THREE.SphereGeometry(s.radius, 18, 12); geometry.scale(1, s.height / (2 * s.radius), 1); y = 1; }
      else {
        geometry = new THREE.BoxGeometry(s.halfX * 2, s.height, s.halfZ * 2, 8, 12, 16);
        y = Math.min(...[-1, 1].flatMap(x => [-1, 1].map(z => groundHeight(this.world, s.x + x * s.halfX, s.z + z * s.halfZ)))) + s.height / 2 - 2;
      }
      const pos = geometry.attributes.position, colors: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        if (s.kind === 'cliff') {
          const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i) + s.height / 2;
          // Keep the mineable foot aligned with its collider; erode the upper ridge.
          const upper = THREE.MathUtils.smoothstep(h, 20, s.height);
          const ridge = Math.sin(x * 0.53 + z * 0.31) * 0.5 + Math.sin(z * 0.87 - x * 0.39) * 0.5;
          const taper = 1 - upper * (0.12 + (ridge + 1) * 0.12);
          pos.setXYZ(i, x * taper, pos.getY(i) - upper * (5 + ridge * 5), z * taper);
        } else {
          // Roughen the polar cap while preserving the equatorial collision footprint and ore belt.
          const cap = THREE.MathUtils.smoothstep(Math.abs(pos.getY(i)), s.height * 0.33, s.height * 0.5);
          const crag = Math.sin(pos.getX(i) * 0.7 + s.x) * Math.cos(pos.getZ(i) * 0.59);
          pos.setY(i, pos.getY(i) - cap * (2.5 + crag * 3.5));
        }
        const strata = 0.7 + 0.15 * Math.sin(pos.getY(i) * 0.6 + Math.sin(pos.getX(i) * 0.4))
          + 0.12 * Math.sin(pos.getX(i) * 1.7 + pos.getZ(i) * 2.3);
        const c = new THREE.Color(s.kind === 'asteroid' ? '#72778b' : '#817463').multiplyScalar(strata); colors.push(c.r, c.g, c.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: s.kind === 'asteroid' ? 0.25 : 0.05, flatShading: true, transparent: true }));
      mesh.position.set(s.x, y, s.z); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.structure = s;
      this.solids.push(mesh); this.root.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 24), new THREE.LineBasicMaterial({ color: '#bdc2c1', transparent: true, opacity: 0.1 })); mesh.add(edges);
    }
  }
  private createShelters() {
    for (const s of this.world.shelters) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(s.radius - 0.2, s.radius, 64), new THREE.MeshBasicMaterial({ color: '#a9f4cb', side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 1.65, s.z); this.root.add(ring);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.4, 6), new THREE.MeshStandardMaterial({ color: '#c4fae0', emissive: '#5dad82', emissiveIntensity: 0.8 }));
        beacon.position.set(s.x + Math.sin(a) * 12, 2.2, s.z + Math.cos(a) * 12); this.root.add(beacon);
      }
    }
  }
  private createSpace() {
    const random = seededRandom(7113), positions: number[] = [], colors: number[] = [];
    for (let i = 0; i < 1800; i++) { positions.push((random() - 0.5) * 1600, -40 - random() * 180, (random() - 0.5) * 1600); const c = new THREE.Color().setHSL(0.55 + random() * 0.15, 0.2, 0.45 + random() * 0.4); colors.push(c.r, c.g, c.b); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.root.add(new THREE.Points(geo, new THREE.PointsMaterial({ vertexColors: true, size: 1.1, sizeAttenuation: false })));
    const debris = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#353e56', roughness: 1, flatShading: true }), 160);
    for (let i = 0; i < 160; i++) { this.dummy.position.set((random() - 0.5) * 700, -28 - random() * 70, (random() - 0.5) * 700); this.dummy.rotation.set(random() * 3, random() * 3, random() * 3); const scale = 1 + random() * 5; this.dummy.scale.set(scale, scale * 0.7, scale); this.dummy.updateMatrix(); debris.setMatrixAt(i, this.dummy.matrix); }
    this.root.add(debris);
    this.flying = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#a99a8e', emissive: '#4c2921', emissiveIntensity: 0.3, roughness: 0.85, flatShading: true }), SPACE.hazardCount);
    this.flying.frustumCulled = false; this.flying.castShadow = true; this.root.add(this.flying);
    const shield = new THREE.Mesh(new THREE.RingGeometry(SPACE.shieldRadius - 0.25, SPACE.shieldRadius, 96), new THREE.MeshBasicMaterial({ color: '#7cbef4', transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    shield.rotation.x = -Math.PI / 2; shield.position.y = 0.1; this.root.add(shield);
  }
  private createDust() {
    const random = seededRandom(83), points: number[] = [];
    for (let i = 0; i < 500; i++) { const x = random() * 300 - 150, y = 40 + random() * 40, z = random() * 220 - 110; points.push(x, y, z, x + 4, y, z + 1.5); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.dust = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#edd9b6', transparent: true, opacity: 0 })); this.dust.frustumCulled = false; this.root.add(this.dust);
  }
  private createShip() {
    const ivory = new THREE.MeshStandardMaterial({ color: '#eeecd3', roughness: 0.5, metalness: 0.25 }), dark = new THREE.MeshStandardMaterial({ color: '#273b3d', roughness: 0.45, metalness: 0.5 }), orange = new THREE.MeshStandardMaterial({ color: '#e89355', roughness: 0.55 });
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent = this.ship) => { const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };
    part(new THREE.BoxGeometry(2.2, 0.7, 4), ivory, 0, 0, 0);
    const nose = part(new THREE.ConeGeometry(1.1, 2, 4), ivory, 0, 0, -2.5); nose.rotation.x = -Math.PI / 2; nose.rotation.z = Math.PI / 4; nose.scale.z = 0.5;
    part(new THREE.BoxGeometry(5.8, 0.25, 1.3), dark, 0, -0.15, 0.7);
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.85, 0.65, 4.5), ivory, side * 2.3, -0.1, 0.4); part(new THREE.BoxGeometry(0.9, 0.12, 0.85), orange, side * 2.3, 0.28, -0.65);
      const exhaust = part(new THREE.ConeGeometry(0.34, 2.4, 8), new THREE.MeshBasicMaterial({ color: '#adfff0', transparent: true, opacity: 0.8 }), side * 2.3, -0.1, 3.4); exhaust.rotation.x = Math.PI / 2; this.exhaust.push(exhaust);
    }
    part(new THREE.BoxGeometry(1.1, 0.4, 1.2), dark, 0, 0.5, -0.6); this.turret.position.set(0, 0.7, 0.75);
    part(new THREE.CylinderGeometry(0.63, 0.7, 0.4, 12), orange, 0, 0, 0, this.turret); part(new THREE.BoxGeometry(0.22, 0.2, 2), dark, 0, 0.1, -0.95, this.turret);
    this.ship.add(this.turret); this.scene.add(this.ship); this.muzzle.position.set(0, 0.1, -2); this.turret.add(this.muzzle);
  }
  resize() { const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h); this.camera.left = -66 * w / h; this.camera.right = 66 * w / h; this.camera.updateProjectionMatrix(); }
  reset(s: State) { if (this.world.definition.id !== s.levelId) this.loadLevel(s.levelId); this.follow.set(s.x, groundHeight(this.world, s.x, s.z), s.z); this.intensity = 0; }
  mouseAim(pointer: { x: number; y: number }, s: State): number | null {
    this.aimRay.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), this.camera);
    const ore = this.aimRay.intersectObjects(this.resources.aimTargets, false)[0];
    const hit = ore ?? this.aimRay.intersectObjects(this.terrain ? [this.terrain, ...this.solids] : this.solids, false)[0];
    const point = hit?.point ?? this.aimRay.ray.intersectPlane(this.plane, this.point);
    if (!point) return null; const dx = point.x - s.x, dz = point.z - s.z;
    return Math.hypot(dx, dz) < 0.5 ? null : Math.atan2(dx, -dz);
  }
  render(s: State, dt: number, thrust: number) {
    if (this.world.definition.id !== s.levelId) this.reset(s);
    const ground = groundHeight(this.world, s.x, s.z), space = s.environment.kind === 'space';
    this.follow.lerp(new THREE.Vector3(s.x, ground, s.z), 1 - Math.exp(-dt * 6));
    this.camera.position.set(this.follow.x, this.follow.y + 180, this.follow.z + 70); this.camera.lookAt(this.follow);
    this.ship.position.set(s.x, ground + CONFIG.hoverHeight + Math.sin(s.elapsed * 3) * 0.1, s.z); this.ship.rotation.y = -s.heading; this.turret.rotation.y = s.heading - s.turret;
    this.muzzle.getWorldPosition(this.muzzlePosition); this.resources.render(s, this.muzzlePosition, dt > 0);
    for (const mesh of this.exhaust) { mesh.visible = !s.dead && thrust > 0; mesh.scale.y = 0.5 + thrust * 0.7 + Math.sin(s.elapsed * 40) * 0.1; }
    for (const mesh of this.solids) {
      const structure = mesh.userData.structure, near = structure.kind === 'cliff' && Math.abs(s.x - structure.x) < structure.halfX + 10 && s.z < structure.z && s.z > structure.z - structure.halfZ - 38;
      const mat = mesh.material as THREE.MeshStandardMaterial; mat.opacity = near ? 0.35 : 1; mat.depthWrite = !near;
    }
    const target = !space && s.phase === 'storm' ? 1 : !space && s.phase === 'warning' ? 0.18 : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt * 2)); this.sun.intensity = (space ? 3.4 : 3.1) - this.intensity * 1.7;
    if (this.dust) {
      (this.dust.material as THREE.LineBasicMaterial).opacity = this.intensity * 0.48;
      const positions = this.dust.geometry.attributes.position;
      for (let i = 0; i < positions.count; i += 2) { let x = positions.getX(i) + dt * (35 + 55 * this.intensity), z = positions.getZ(i) + dt * 14; if (x > 150) x -= 300; if (z > 110) z -= 220; positions.setXYZ(i, x, positions.getY(i), z); positions.setXYZ(i + 1, x + 4, positions.getY(i), z + 1.5); }
      positions.needsUpdate = true; this.dust.position.set(this.follow.x, 0, this.follow.z);
    }
    if (this.flying && s.environment.kind === 'space') {
      s.environment.asteroids.forEach((a, i) => { this.dummy.position.set(a.x, SPACE.flightHeight, a.z); this.dummy.rotation.set(a.rotation, a.rotation * 0.7, 0); this.dummy.scale.setScalar(a.radius); this.dummy.updateMatrix(); this.flying!.setMatrixAt(i, this.dummy.matrix); });
      this.flying.count = s.environment.asteroids.length; this.flying.instanceMatrix.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
