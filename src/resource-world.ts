import type {LiveOreCell} from './ore-paint';
import * as THREE from 'three';
import { RESOURCE_CONFIG as R } from './config';
import { RESOURCE_TYPES, RESOURCES, type ResourceId, type Deposit } from './resources';
import { type State } from './simulation';
import { groundHeight, type LevelWorld } from './levels';
import {disposeObject,type AssetLibrary} from './assets';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createOreOutcrop, crystalGeometry, terrainNormal } from './ore-outcrop';

type Chunk = { position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 };
interface VeinVisual {
  patch: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  chunks: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  pieces: Chunk[];
  label: THREE.Sprite;
  amount: number;updateCells?:(cells:LiveOreCell[])=>void;
}

function labelMaterial(text: string, color: string, width = 256) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#07151dc4'; ctx.fillRect(0, 10, width, 44);
  ctx.fillStyle = color; ctx.fillRect(0, 10, 3, 44);
  ctx.font = '500 21px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, width / 2 + 2, 39);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
}
function glowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!, gradient = ctx.createRadialGradient(64, 64, 1, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(0.08, 'rgba(255,249,220,0.95)');
  gradient.addColorStop(0.26, 'rgba(255,181,88,0.38)'); gradient.addColorStop(1, 'rgba(255,110,40,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

/** All mined fragments are visualized from their simulation IDs. Additional sparks
 * are bounded cosmetic instances and never participate in mining or collection. */
export class ResourceWorld {
  private editorSignatures=new Map<string,string>();private previewMatrices=new Map<THREE.Object3D,THREE.Matrix4>();
  readonly aimTargets: THREE.Mesh[] = [];
  private deposits = new Map<string, VeinVisual>();
  private fragments = new Map<ResourceId, THREE.InstancedMesh>();
  private fragmentMaterials = new Map<ResourceId, THREE.MeshStandardMaterial>();
  private geometries = new Map<ResourceId, THREE.BufferGeometry>();
  private labels = new Map<ResourceId, THREE.SpriteMaterial>();
  private colors = new Map<ResourceId, THREE.Color>();
  private exhaustedColor = new THREE.Color('#3b3935');
  private dummy = new THREE.Object3D();
  private beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), new THREE.MeshBasicMaterial({ color: '#e4fff4', toneMapped: false }));
  private beamGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1, 6), new THREE.MeshBasicMaterial({ color: '#78efcf', transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  private target = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.12, 40), new THREE.MeshBasicMaterial({ color: '#eaffdf', side: THREE.DoubleSide, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false }));
  private sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshBasicMaterial({ color: '#ffdb91', toneMapped: false }), 28);
  private impactGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffe3b2', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  private impactLight = new THREE.PointLight('#ffcc85', 0, 10, 2);
  private up = new THREE.Vector3(0, 1, 0);
  private forward = new THREE.Vector3(0, 0, 1);
  private normal = new THREE.Vector3();
  private hit = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private high = true;
  private elapsed: number | null = null;
  constructor(private scene: THREE.Group, private world: LevelWorld, private assets: AssetLibrary) {
    for (const id of RESOURCE_TYPES) {
      const r = RESOURCES[id];
      this.colors.set(id, new THREE.Color(r.color));
      this.labels.set(id, labelMaterial(r.name.toUpperCase(), r.color));
      const material = new THREE.MeshStandardMaterial({ color: r.color, metalness: r.metalness, roughness: r.roughness,
        emissive: r.color, emissiveIntensity: id === 'crystal' ? 0.65 : 0.08, flatShading: true });
      this.fragmentMaterials.set(id, material);
      const geometry = id === 'crystal' ? crystalGeometry()
        : id === 'copper' ? new THREE.IcosahedronGeometry(0.75, 0) : new THREE.DodecahedronGeometry(0.8, 0);
      this.geometries.set(id, geometry);
      const fragments = new THREE.InstancedMesh(geometry, material, Math.max(1,Math.ceil(world.deposits.filter(d=>d.resource===id).reduce((n,d)=>n+d.remaining,0))));
      fragments.name = `${id}-fragments`; fragments.count = 0; fragments.frustumCulled = false;
      fragments.castShadow = true; fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.fragments.set(id, fragments); scene.add(fragments);
    }
    this.sparks.frustumCulled = false; this.sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beam.visible = this.beamGlow.visible = this.target.visible = this.sparks.visible = this.impactGlow.visible = false;
    scene.add(this.beam, this.beamGlow, this.target, this.sparks, this.impactGlow, this.impactLight);
    const beds: THREE.BufferGeometry[] = [], stains: THREE.BufferGeometry[] = [];
    for (const deposit of world.deposits) {
      const outcrop = this.createDeposit(deposit); if(outcrop.bed.getAttribute('position'))beds.push(outcrop.bed);else outcrop.bed.dispose(); if(outcrop.stain.getAttribute('position'))stains.push(outcrop.stain);else outcrop.stain.dispose();
    }
    const bed = new THREE.Mesh((beds.length?mergeGeometries(beds)!:new THREE.BufferGeometry()), assets.material('rock', { vertexColors:true, roughness:1, metalness:.025, side:THREE.DoubleSide }));
    bed.name = 'ore-host-rock'; bed.castShadow = bed.receiveShadow = true;
    const stain = new THREE.Mesh((stains.length?mergeGeometries(stains)!:new THREE.BufferGeometry()), assets.material('rock', { vertexColors:true, roughness:1, metalness:0,
      transparent:true, depthWrite:false, side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 }));
    stain.name = 'ore-weathering'; stain.receiveShadow = true; this.scene.add(bed, stain);
    beds.forEach(g => g.dispose()); stains.forEach(g => g.dispose());

  }
  setQuality(quality: 'high' | 'standard') { this.high = quality === 'high'; this.sparks.count = this.high ? 28 : 12; }
  setEmissions(deposits:readonly {id:string;emission?:{color:string;intensity:number}}[]){
    for(const d of deposits){const visual=this.deposits.get(d.id);if(!visual)continue;const resource=this.world.deposits.find(o=>o.id===d.id)?.resource??'ferrite';
      for(const material of [visual.patch.material,visual.chunks.material]){material.emissive.set(d.emission?.color??RESOURCES[resource].color);material.emissiveIntensity=d.emission?.intensity??(resource==='crystal'?.65:.08);}
    }
  }

  private createDeposit(d: Deposit) {
    this.editorSignatures.set(d.id,JSON.stringify(d));
    const surface = d.surface!, isGround = surface.kind === 'ground';
    const outcrop = createOreOutcrop(this.world, this.assets, d, this.geometries.get(d.resource)!, this.fragmentMaterials.get(d.resource)!);
    const {patch, chunks, pieces} = outcrop;
    this.aimTargets.push(patch, chunks);
    const name = new THREE.Sprite(this.labels.get(d.resource)!); name.scale.set(9.6, 2.4, 1); name.visible = false;
    name.position.set(d.x + surface.nx * 3, surface.y + (isGround ? 6.5 : 10.5), d.z + surface.nz * 3);
    this.scene.add(patch, chunks, name); this.deposits.set(d.id, { patch, chunks, pieces, label: name, amount: 1,updateCells:'updateCells' in outcrop?outcrop.updateCells:undefined });
    return outcrop;
  }
  previewPlacement(id:string,transform:THREE.Matrix4){
    for(const d of this.world.deposits.filter(d=>d.structureId===id)){const visual=this.deposits.get(d.id);if(!visual)continue;for(const object of [visual.patch,visual.chunks,visual.label]){if(!this.previewMatrices.has(object)){object.updateMatrix();this.previewMatrices.set(object,object.matrix.clone());}object.matrix.copy(transform).multiply(this.previewMatrices.get(object)!);object.matrix.decompose(object.position,object.quaternion,object.scale);object.updateMatrixWorld(true);}}
  }
  clearPlacementPreview(){for(const [object,matrix] of this.previewMatrices){object.matrix.copy(matrix);matrix.decompose(object.position,object.quaternion,object.scale);object.updateMatrixWorld(true);}this.previewMatrices.clear();}
  syncSpace(world:LevelWorld){
    this.clearPlacementPreview();this.world=world;this.elapsed=null;
    for(const [id,visual] of this.deposits){const deposit=world.deposits.find(d=>d.id===id);if(deposit&&this.editorSignatures.get(id)===JSON.stringify(deposit))continue;
      for(const mesh of [visual.patch,visual.chunks]){this.aimTargets.splice(this.aimTargets.indexOf(mesh),1);disposeObject(mesh);}visual.label.removeFromParent();this.deposits.delete(id);this.editorSignatures.delete(id);
    }
    for(const deposit of world.deposits)if(!this.deposits.has(deposit.id)){const outcrop=this.createDeposit(deposit);outcrop.bed.dispose();outcrop.stain.dispose();}
  }

  render(s: State, muzzle: THREE.Vector3, running: boolean) {
    const firstFrame = this.elapsed === null;
    const dt = firstFrame ? 0 : Math.min(0.1, Math.max(0, s.elapsed - this.elapsed!)); this.elapsed = s.elapsed;
    for (const d of s.resources.deposits) {
      const visual = this.deposits.get(d.id)!, goal = d.remaining / (d.initialAmount??R.unitsPerDeposit);
      const amount = firstFrame ? goal : visual.amount + (goal - visual.amount) * (1 - Math.exp(-dt * 8));
      if(visual.updateCells&&d.surface?.cells){if(firstFrame||Math.abs(goal-visual.amount)>1e-9)visual.updateCells(d.surface.cells);visual.amount=goal;visual.label.visible=d.remaining>0&&d.id===s.resources.targetId;continue;}
      const pulse = d.resource === 'crystal' ? 0.17 + Math.sin(s.elapsed * 2.1) * 0.035 : 0.025;
      for (const material of [visual.patch.material, visual.chunks.material]) {
        material.color.copy(this.exhaustedColor).lerp(this.colors.get(d.resource)!, amount);
        material.emissive.set(d.emission?.color??RESOURCES[d.resource].color);material.emissiveIntensity = amount * (d.emission?.intensity??pulse) * (material === visual.patch.material ? 0.4 : 1);
        material.metalness = RESOURCES[d.resource].metalness * (0.3 + amount * 0.7);
      }
      if (Math.abs(amount - visual.amount) > 0.00001) {
        for (let i = 0; i < visual.pieces.length; i++) {
          const piece = visual.pieces[i], scale = 0.16 + amount * 0.84, sink = (1 - amount) * 0.55;
          this.dummy.position.copy(piece.position); this.dummy.quaternion.copy(piece.rotation); this.dummy.scale.copy(piece.scale).multiplyScalar(scale);
          if (d.surface!.kind === 'ground') this.dummy.position.y -= sink;
          else { this.dummy.position.x -= d.surface!.nx * sink; this.dummy.position.z -= d.surface!.nz * sink; }
          this.dummy.updateMatrix(); visual.chunks.setMatrixAt(i, this.dummy.matrix);
        }
        visual.chunks.instanceMatrix.needsUpdate = true;
      }
      visual.amount = amount;
      visual.label.visible = d.remaining > 0 && (d.id === s.resources.targetId || Math.hypot(d.x - s.x, d.z - s.z) < 18);
    }
    for (const id of RESOURCE_TYPES) {
      const mesh = this.fragments.get(id)!; let count = 0;
      for (const f of s.resources.fragments) {
        if (f.resource !== id) continue;
        const jump = f.age < R.ejectSeconds ? Math.sin(f.age / R.ejectSeconds * Math.PI) * 1.7 : 0;
        this.dummy.position.set(f.x, groundHeight(this.world, f.x, f.z) + 1.1 + jump + Math.sin(s.elapsed * 3 + f.id) * 0.16, f.z);
        this.dummy.rotation.set(0.3, s.elapsed * 1.7 + f.id, 0.4); this.dummy.scale.setScalar(id === 'crystal' ? 0.35 : 0.48);
        this.dummy.updateMatrix(); mesh.setMatrixAt(count++, this.dummy.matrix);
      }
      mesh.count = count; mesh.instanceMatrix.needsUpdate = count > 0;
    }
    const target = s.resources.deposits.find(d => d.id === s.resources.targetId), active = !!target && s.resources.laserActive && !s.dead;
    this.target.visible = !!target && !s.dead;
    // Rendering a paused frame uses the same simulation clock and retains its
    // frozen mining effects. The running flag never advances an effect clock.
    void running;
    this.beam.visible = this.beamGlow.visible = this.sparks.visible = this.impactGlow.visible = active;
    this.impactLight.intensity = active && this.high ? 12 : 0;
    if (!target) return;
    const hit = s.resources.hitPoint ?? { ...target, y: target.surface!.y + 0.4 }, surface = target.surface!;
    this.hit.set(hit.x, hit.y, hit.z);
    this.normal.copy(surface.kind === 'ground' ? terrainNormal(this.world, hit.x, hit.z) : this.direction.set(surface.nx, 0, surface.nz));
    this.target.position.copy(this.hit).addScaledVector(this.normal, 0.15); this.target.quaternion.setFromUnitVectors(this.forward, this.normal);
    this.target.material.color.copy(this.colors.get(target.resource)!);
    this.direction.subVectors(this.hit, muzzle); const length = this.direction.length(); this.direction.normalize();
    for (const beam of [this.beam, this.beamGlow]) {
      beam.position.copy(muzzle).add(this.hit).multiplyScalar(0.5); beam.scale.set(1, length, 1); beam.quaternion.setFromUnitVectors(this.up, this.direction);
    }
    this.impactGlow.position.copy(this.hit).addScaledVector(this.normal, 0.25);
    this.impactGlow.scale.setScalar(2.5 + Math.sin(s.elapsed * 42) * 0.25);
    this.impactLight.position.copy(this.hit).addScaledVector(this.normal, 1.2);
    this.sparks.material.color.set(target.resource === 'crystal' ? '#aefff0' : '#ffcf7e');
    for (let i = 0; i < this.sparks.count; i++) {
      const t = (s.elapsed * 2.7 + i / this.sparks.count) % 1, a = i * 2.399963;
      const spread = (0.5 + Math.sin(i * 5.3) * 0.2) * t * 3.4;
      this.dummy.position.copy(this.hit).addScaledVector(this.normal, 0.2 + t * 2.1);
      this.dummy.position.x += Math.sin(a) * spread; this.dummy.position.z += Math.cos(a) * spread;
      this.dummy.position.y += Math.sin(t * Math.PI) * 1.8;
      this.dummy.rotation.set(a, a * 1.2, a * 0.7); this.dummy.scale.set(0.7 * (1 - t), (2.4 - t) * (1 - t), 0.7 * (1 - t));
      this.dummy.updateMatrix(); this.sparks.setMatrixAt(i, this.dummy.matrix);
    }
    this.sparks.instanceMatrix.needsUpdate = true;
  }
}
