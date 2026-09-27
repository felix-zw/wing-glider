import * as THREE from 'three';
import { CONFIG, shelters, terrainHeight, type State } from './simulation';

function randomGenerator(seed: number) {
  return () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
}

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-80, 80, 60, -60, 0.1, 500);
  readonly renderer: THREE.WebGLRenderer;
  private ship = new THREE.Group();
  private turret = new THREE.Group();
  private exhaust: THREE.Mesh[] = [];
  private dust: THREE.LineSegments;
  private dustMaterial = new THREE.LineBasicMaterial({ color: '#edd9b6', transparent: true, opacity: 0 });
  private sun: THREE.DirectionalLight;
  private aimRay = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private target = new THREE.Vector3();
  private follow = new THREE.Vector3(25, 0, 36);
  private intensity = 0;
  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor('#242c29');
    this.renderer.domElement.setAttribute('aria-label', '3D-Fluggebiet auf Aster mit Speeder und Schutzmulden');
    container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#e9f2dc', '#665243', 2.5));
    this.sun = new THREE.DirectionalLight('#fff0cf', 3.1);
    this.sun.position.set(-90, 140, -65);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -270, right: 270, top: 270, bottom: -270, far: 500 });
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun);
    this.camera.up.set(0, 0, -1);
    this.createTerrain();
    this.createShelters();
    this.createShip();
    const rng = randomGenerator(83);
    const positions: number[] = [];
    for (let i = 0; i < 650; i++) {
      const x = rng() * 300 - 150, z = rng() * 220 - 110, y = 25 + rng() * 35;
      positions.push(x, y, z, x + 2 + rng() * 5, y, z + 1.5);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.dust = new THREE.LineSegments(geo, this.dustMaterial);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }
  private createTerrain() {
    const geometry = new THREE.PlaneGeometry(480, 480, 240, 240);
    geometry.rotateX(-Math.PI / 2);
    const vertices = geometry.attributes.position;
    const colors: number[] = [];
    const low = new THREE.Color('#7e8970'), high = new THREE.Color('#c6b88b');
    const rng = randomGenerator(CONFIG.seed);
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), z = vertices.getZ(i), h = terrainHeight(x, z);
      vertices.setY(i, h);
      const c = low.clone().lerp(high, THREE.MathUtils.clamp((h - 1) / 20, 0, 1));
      c.multiplyScalar(0.97 + rng() * 0.06);
      colors.push(c.r, c.g, c.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    // Sparse rocky outcrops stay outside the clearly marked shelter interiors.
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#727765', flatShading: true, roughness: 1 }), 400);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 400; i++) {
      let x = rng() * 450 - 225, z = rng() * 450 - 225;
      while (shelters.some(s => Math.hypot(s.x - x, s.z - z) < 25)) { x = rng() * 450 - 225; z = rng() * 450 - 225; }
      const scale = 0.4 + rng() * 2;
      dummy.position.set(x, terrainHeight(x, z) - 0.15, z);
      dummy.rotation.set(rng(), rng() * Math.PI, rng());
      dummy.scale.set(scale * 1.5, scale * 0.6, scale);
      dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.castShadow = true; rocks.receiveShadow = true;
    this.scene.add(rocks);
    const borderPoints: THREE.Vector3[] = [];
    for (let edge = 0; edge < 4; edge++) for (let i = 0; i <= 100; i++) {
      const t = -CONFIG.worldHalf + i / 100 * CONFIG.worldHalf * 2;
      const x = edge === 0 ? t : edge === 1 ? CONFIG.worldHalf : edge === 2 ? -t : -CONFIG.worldHalf;
      const z = edge === 0 ? -CONFIG.worldHalf : edge === 1 ? t : edge === 2 ? CONFIG.worldHalf : -t;
      borderPoints.push(new THREE.Vector3(x, terrainHeight(x, z) + 0.3, z));
    }
    const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints(borderPoints), new THREE.LineDashedMaterial({ color: '#eac490', dashSize: 3, gapSize: 2 }));
    border.computeLineDistances(); this.scene.add(border);
  }
  private createShelters() {
    for (const shelter of shelters) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(shelter.radius - 0.2, shelter.radius, 72), new THREE.MeshBasicMaterial({ color: '#a9f4cb', side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(shelter.x, 1.65, shelter.z);
      this.scene.add(ring);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.4, 6), new THREE.MeshStandardMaterial({ color: '#c4fae0', emissive: '#5dad82', emissiveIntensity: 0.8 }));
        beacon.position.set(shelter.x + Math.sin(a) * 12, 2.2, shelter.z + Math.cos(a) * 12);
        this.scene.add(beacon);
      }
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.font = '500 32px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#d7ffe9'; ctx.fillText(shelter.name, 64, 40);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true, opacity: 0.85 }));
      label.position.set(shelter.x, 3, shelter.z - 17); label.scale.set(9, 4.5, 1); this.scene.add(label);
    }
  }
  private createShip() {
    const ivory = new THREE.MeshStandardMaterial({ color: '#eeecd3', roughness: 0.5, metalness: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: '#273b3d', roughness: 0.45, metalness: 0.5 });
    const orange = new THREE.MeshStandardMaterial({ color: '#e89355', roughness: 0.55 });
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent = this.ship) => {
      const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
    };
    part(new THREE.BoxGeometry(2.2, 0.7, 4), ivory, 0, 0, 0);
    const nose = part(new THREE.ConeGeometry(1.1, 2, 4), ivory, 0, 0, -2.5);
    nose.rotation.x = -Math.PI / 2; nose.rotation.z = Math.PI / 4; nose.scale.z = 0.5;
    part(new THREE.BoxGeometry(5.8, 0.25, 1.3), dark, 0, -0.15, 0.7);
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.85, 0.65, 4.5), ivory, side * 2.3, -0.1, 0.4);
      part(new THREE.BoxGeometry(0.9, 0.12, 0.85), orange, side * 2.3, 0.28, -0.65);
      const exhaust = part(new THREE.ConeGeometry(0.34, 2.4, 8), new THREE.MeshBasicMaterial({ color: '#adfff0', transparent: true, opacity: 0.8 }), side * 2.3, -0.1, 3.4);
      exhaust.rotation.x = Math.PI / 2; this.exhaust.push(exhaust);
    }
    part(new THREE.BoxGeometry(1.1, 0.4, 1.2), dark, 0, 0.5, -0.6);
    this.turret.position.set(0, 0.7, 0.75);
    part(new THREE.CylinderGeometry(0.63, 0.7, 0.4, 12), orange, 0, 0, 0, this.turret);
    part(new THREE.BoxGeometry(0.22, 0.2, 2), dark, 0, 0.1, -0.95, this.turret);
    this.ship.add(this.turret); this.scene.add(this.ship);
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    const half = 66;
    this.camera.left = -half * w / h; this.camera.right = half * w / h;
    this.camera.top = half; this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }
  reset(s: State) { this.follow.set(s.x, 0, s.z); this.intensity = 0; }
  mouseAim(pointer: { x: number; y: number }, s: State): number | null {
    this.aimRay.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), this.camera);
    this.plane.constant = -(terrainHeight(s.x, s.z) + CONFIG.hoverHeight);
    if (!this.aimRay.ray.intersectPlane(this.plane, this.target)) return null;
    const dx = this.target.x - s.x, dz = this.target.z - s.z;
    return Math.hypot(dx, dz) < 0.5 ? null : Math.atan2(dx, -dz);
  }
  render(s: State, dt: number, thrust: number) {
    this.follow.lerp(new THREE.Vector3(s.x, 0, s.z), 1 - Math.exp(-dt * 6));
    this.camera.position.set(this.follow.x, 180, this.follow.z);
    this.camera.lookAt(this.follow.x, 0, this.follow.z);
    this.ship.position.set(s.x, terrainHeight(s.x, s.z) + CONFIG.hoverHeight + Math.sin(s.elapsed * 3) * 0.1, s.z);
    this.ship.rotation.y = -s.heading;
    this.turret.rotation.y = s.heading - s.turret;
    for (const mesh of this.exhaust) { mesh.visible = !s.dead && thrust > 0; mesh.scale.y = 0.5 + thrust * 0.7 + Math.sin(s.elapsed * 40) * 0.1; }
    const targetIntensity = s.phase === 'storm' ? 1 : s.phase === 'warning' ? 0.18 : 0;
    this.intensity += (targetIntensity - this.intensity) * (1 - Math.exp(-dt * 2));
    this.dustMaterial.opacity = this.intensity * 0.48;
    this.sun.intensity = 3.1 - this.intensity * 1.7;
    const positions = this.dust.geometry.attributes.position;
    for (let i = 0; i < positions.count; i += 2) {
      let x = positions.getX(i) + dt * (35 + 55 * this.intensity);
      let z = positions.getZ(i) + dt * 14;
      if (x > 150) x -= 300;
      if (z > 110) z -= 220;
      const length = positions.getX(i + 1) - positions.getX(i);
      positions.setX(i, x); positions.setX(i + 1, x + length);
      positions.setZ(i, z); positions.setZ(i + 1, z + 1.5);
    }
    positions.needsUpdate = true;
    this.dust.position.set(this.follow.x, 0, this.follow.z);
    this.renderer.render(this.scene, this.camera);
  }
}
