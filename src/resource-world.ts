import * as THREE from 'three';
import { RESOURCE_CONFIG as R, TRANSPORTER } from './config';
import { RESOURCE_TYPES, RESOURCES, type ResourceId, type Deposit } from './resources';
import { type State } from './simulation';
import { groundHeight, type LevelWorld } from './levels';

function label(text: string, color: string, width = 256) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#142521cc'; ctx.fillRect(0, 8, width, 48);
  ctx.font = '500 24px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(text, width / 2, 40);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
  sprite.scale.set(width / 20, 3.2, 1); return sprite;
}

export class ResourceWorld {
  readonly aimTargets: THREE.Mesh[] = [];
  private deposits = new Map<string, { root: THREE.Group; ore: THREE.Group; label: THREE.Sprite }>();
  private fragments = new Map<ResourceId, THREE.InstancedMesh>();
  private oreMaterials = new Map<ResourceId, THREE.MeshStandardMaterial>();
  private detailMaterials = new Map<ResourceId, THREE.MeshStandardMaterial>();
  private oreGeometry = new Map<ResourceId, THREE.BufferGeometry>();
  private dummy = new THREE.Object3D();
  private beam = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 8), new THREE.MeshBasicMaterial({ color: '#e8fff6' }));
  private glow = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1, 8), new THREE.MeshBasicMaterial({ color: '#85ffe1', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
  private target = new THREE.Mesh(new THREE.RingGeometry(3.5, 3.7, 48), new THREE.MeshBasicMaterial({ color: '#eaffdf', side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
  private sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: '#d9fff1' }), 14);
  private up = new THREE.Vector3(0, 1, 0);
  private hit = new THREE.Vector3();
  private direction = new THREE.Vector3();
  constructor(private scene: THREE.Group, private world: LevelWorld) {
    for (const id of RESOURCE_TYPES) {
      const r = RESOURCES[id];
      const material = new THREE.MeshStandardMaterial({ color: r.rock, metalness: r.metalness, roughness: r.roughness,
        flatShading: true, emissive: r.shape === 'spire' ? r.rock : '#000000', emissiveIntensity: 0.45 });
      this.oreMaterials.set(id, material);
      this.detailMaterials.set(id, new THREE.MeshStandardMaterial({ color: r.color, metalness: r.metalness, roughness: r.roughness,
        emissive: r.color, emissiveIntensity: r.shape === 'spire' ? 0.7 : 0.15, flatShading: true }));
      const geometry = r.shape === 'spire' ? new THREE.ConeGeometry(1, 3.8, 5) : r.shape === 'cluster' ? new THREE.IcosahedronGeometry(1.2, 0) : new THREE.DodecahedronGeometry(1.3, 0);
      this.oreGeometry.set(id, geometry);
      const fragments = new THREE.InstancedMesh(geometry, this.detailMaterials.get(id)!, R.depositsPerType * R.unitsPerDeposit);
      fragments.count = 0; fragments.frustumCulled = false; fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.fragments.set(id, fragments); scene.add(fragments);
    }
    this.beam.visible = this.glow.visible = this.target.visible = this.sparks.visible = false;
    this.sparks.frustumCulled = false;
    this.target.rotation.x = -Math.PI / 2;
    scene.add(this.beam, this.glow, this.target, this.sparks);
    this.createTransporter();
  }
  private createDeposit(d: Deposit) {
    const root = new THREE.Group(), ore = new THREE.Group();
    const surface = d.surface!, host = this.world.structures.find(s => s.id === d.structureId)!;
    const vertices: number[] = [];
    const vertex = (u: number, v: number) => {
      if (host.kind === 'asteroid') {
        const angle = Math.atan2(surface.nz, surface.nx) + u * surface.width / (2 * host.radius);
        const latitude = 0.1 + (v + 1) * 0.3, r = (host.radius + 0.18) * Math.cos(latitude);
        return [host.x + Math.cos(angle) * r, 1 + Math.sin(latitude) * (host.height / 2 + 0.18), host.z + Math.sin(angle) * r];
      }
      const along = u * surface.width * 0.5, outward = surface.kind === 'ground' ? v * 5 : 0;
      const x = d.x - surface.nz * along + surface.nx * outward, z = d.z + surface.nx * along + surface.nz * outward;
      return [x, surface.kind === 'ground' ? groundHeight(this.world, x, z) + 0.12 : groundHeight(this.world, x, z) + 0.2 + (v + 1) * 7, z];
    };
    for (let i = 0; i < 28; i++) for (let j = 0; j < 18; j++) {
      const u = i / 14 - 1, v = j / 9 - 1;
      const band = 0.22 + 0.44 * (1 - u * u) + Math.sin(u * 12) * 0.12;
      if (Math.abs(v - Math.sin(u * 7) * 0.22) > band || Math.abs(u) > 0.96) continue;
      const a = vertex(u, v), b = vertex(u + 1 / 14, v), c = vertex(u + 1 / 14, v + 1 / 9), e = vertex(u, v + 1 / 9);
      vertices.push(...a, ...b, ...c, ...a, ...c, ...e);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
    const material = this.detailMaterials.get(d.resource)!.clone(); material.side = THREE.DoubleSide;
    const colors: number[] = [];
    for (let i = 0; i < vertices.length; i += 9) {
      const fleck = Math.sin(vertices[i] * 17.1 + vertices[i + 2] * 31.7);
      const shade = fleck > 0.6 ? 1 : 0.35 + (fleck + 1) * 0.2;
      for (let corner = 0; corner < 3; corner++) colors.push(shade, shade, shade);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); material.vertexColors = true;
    material.polygonOffset = true; material.polygonOffsetFactor = -2; material.polygonOffsetUnits = -2;
    const vein = new THREE.Mesh(geometry, material); vein.receiveShadow = true; ore.add(vein); this.aimTargets.push(vein);
    const name = label(RESOURCES[d.resource].name.toUpperCase(), RESOURCES[d.resource].color);
    name.position.set(d.x + surface.nx * 6, surface.y + 4, d.z + surface.nz * 6);
    root.add(ore, name); this.scene.add(root);
    const visual = { root, ore, label: name }; this.deposits.set(d.id, visual); return visual;
  }
  private createTransporter() {
    const ship = new THREE.Group(); ship.position.set(-17, groundHeight(this.world, -17, -4) + 2, -4);
    const hull = new THREE.MeshStandardMaterial({ color: '#d7d9ca', metalness: 0.55, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: '#273b41', metalness: 0.7, roughness: 0.4 });
    const orange = new THREE.MeshStandardMaterial({ color: '#df9c58', metalness: 0.5 });
    const light = new THREE.MeshStandardMaterial({ color: '#b5fff0', emissive: '#73efd8', emissiveIntensity: 1.2 });
    const box = (x: number, y: number, z: number, w: number, h: number, l: number, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; ship.add(mesh);
    };
    box(0, 0, 0, 7, 3, 18, hull); box(0, 1.7, -5, 5, 1.5, 4, dark);
    box(0, 1.3, 4, 5.5, 1, 7, orange); box(0, 0, -10, 5, 1.8, 3, hull);
    for (const side of [-1, 1]) {
      box(side * 5, -0.5, 2, 3, 2.8, 13, dark);
      box(side * 5, 1, 2, 3.1, 0.3, 8, hull);
      box(side * 5, -0.4, 8.6, 2, 1, 0.3, light);
      for (const z of [-5, 5]) { box(side * 3.7, -2, z, 0.6, 3, 0.8, dark); box(side * 3.7, -3.3, z, 2, 0.3, 2, hull); }
    }
    for (let i = 0; i < 3; i++) box(0, 2, i * 2.2 + 1.5, 5.6, 0.4, 0.3, dark);
    this.scene.add(ship);
    const zone = new THREE.Mesh(new THREE.RingGeometry(TRANSPORTER.radius - 0.18, TRANSPORTER.radius, 64), new THREE.MeshBasicMaterial({ color: '#f8d597', transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
    zone.rotation.x = -Math.PI / 2; zone.position.set(TRANSPORTER.x, groundHeight(this.world, 0, 0) + 0.2, TRANSPORTER.z); this.scene.add(zone);
    const name = label('ATLAS / FRACHT', '#ffe0a4', 320); name.position.set(-15, 10, -20); this.scene.add(name);
    const dock = label('LADEZONE', '#ffe0a4', 192); dock.position.set(0, 2, 10); this.scene.add(dock);
  }
  render(s: State, muzzle: THREE.Vector3, running: boolean) {
    for (const d of s.resources.deposits) {
      const visual = this.deposits.get(d.id) ?? this.createDeposit(d);
      const material = (visual.ore.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      const amount = d.remaining / R.unitsPerDeposit;
      material.color.set('#393a3b').lerp(new THREE.Color(RESOURCES[d.resource].color), amount);
      material.emissiveIntensity = amount * (d.resource === 'crystal' ? 0.65 + Math.sin(s.elapsed * 2.8) * 0.2 : 0.15 + Math.sin(s.elapsed * 1.8) * 0.05);
      material.metalness = RESOURCES[d.resource].metalness * amount;
      visual.label.visible = d.remaining > 0 && Math.hypot(d.x - s.x, d.z - s.z) < 65;
    }
    for (const id of RESOURCE_TYPES) {
      if (RESOURCES[id].shape === 'spire') {
        this.detailMaterials.get(id)!.emissiveIntensity = 0.7 + Math.sin(s.elapsed * 2.8) * 0.25;
        this.oreMaterials.get(id)!.emissiveIntensity = 0.45 + Math.sin(s.elapsed * 2.8) * 0.15;
      }
      const mesh = this.fragments.get(id)!; let count = 0;
      for (const f of s.resources.fragments) {
        if (f.resource !== id) continue;
        const jump = f.age < R.ejectSeconds ? Math.sin(f.age / R.ejectSeconds * Math.PI) * 2 : 0;
        this.dummy.position.set(f.x, groundHeight(this.world, f.x, f.z) + 1.2 + jump + Math.sin(s.elapsed * 3 + f.id) * 0.2, f.z);
        this.dummy.rotation.set(0.3, s.elapsed * 1.7 + f.id, 0.4); this.dummy.scale.setScalar(RESOURCES[id].shape === 'spire' ? 0.27 : 0.38);
        this.dummy.updateMatrix(); mesh.setMatrixAt(count++, this.dummy.matrix);
      }
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
    }
    const target = s.resources.deposits.find(d => d.id === s.resources.targetId);
    this.target.visible = !!target && !s.dead;
    this.beam.visible = this.glow.visible = this.sparks.visible = !!target && s.resources.laserActive && running && !s.dead;
    if (!target) return;
    const hit = s.resources.hitPoint ?? { ...target, y: groundHeight(this.world, target.x, target.z) + 0.4 }, y = hit.y;
    this.target.position.set(hit.x, y + 0.25, hit.z);
    this.target.material.color.set(RESOURCES[target.resource].color);
    this.hit.set(hit.x, y, hit.z);
    this.direction.subVectors(this.hit, muzzle);
    for (const beam of [this.beam, this.glow]) {
      beam.position.copy(muzzle).add(this.hit).multiplyScalar(0.5);
      beam.scale.set(1, this.direction.length(), 1); beam.quaternion.setFromUnitVectors(this.up, this.direction.clone().normalize());
    }
    for (let i = 0; i < this.sparks.count; i++) {
      const t = (s.elapsed * 2.5 + i / this.sparks.count) % 1, a = i * 2.4;
      this.dummy.position.set(hit.x + Math.sin(a) * t * 2.6, y + 0.4 + Math.sin(t * Math.PI) * 2, hit.z + Math.cos(a) * t * 2.6);
      this.dummy.scale.setScalar(1 - t); this.dummy.updateMatrix(); this.sparks.setMatrixAt(i, this.dummy.matrix);
    }
    this.sparks.instanceMatrix.needsUpdate = true;
  }
}
