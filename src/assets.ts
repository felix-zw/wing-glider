import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export type ModelId = 'speeder' | 'atlas';
export type SurfaceId = 'sand' | 'rock';
export interface SurfaceMaps { color: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture }

/** Owns shared GPU resources for the application lifetime, independently of level instances. */
export class AssetLibrary {
  private models = new Map<ModelId, THREE.Group>();
  readonly surfaces = new Map<SurfaceId, SurfaceMaps>();
  private decoder: KTX2Loader;
  private loading = false;
  private disposalRequested = false;
  private released = false;
  private ownedTextures = new Set<THREE.Texture>();
  constructor(private renderer: THREE.WebGLRenderer) {
    this.decoder = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}assets/basis/`).detectSupport(renderer);
    this.decoder.setWorkerLimit(2);
  }
  async load(progress: (loaded: number, total: number, label: string) => void) {
    this.loading = true;
    let loaded = 0;
    const total = 8, base = `${import.meta.env.BASE_URL}assets/`;
    const complete = (label: string) => progress(++loaded, total, label);
    const gltf = new GLTFLoader();
    const results = await Promise.allSettled([
      ...(['speeder', 'atlas'] as const).map(async id => {
        const result = await gltf.loadAsync(`${base}models/${id}.glb`);
        result.scene.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = object.receiveShadow = true;
          object.geometry.userData.shared = true;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            material.userData.shared = true;
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.userData.shared = true;
          }
        });
        this.models.set(id, result.scene); complete(id === 'speeder' ? 'Speeder' : 'ATLAS');
      }),
      ...(['sand', 'rock'] as const).map(async id => {
        const decoded = await Promise.allSettled((['color', 'normal', 'orm'] as const).map(async channel => {
          const texture = await this.decoder.loadAsync(`${base}textures/${id}-${channel}.ktx2`);
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          texture.colorSpace = channel === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.userData.shared = true;
          this.ownedTextures.add(texture);
          complete(`${id === 'sand' ? 'Sand' : 'Fels'} · ${channel}`); return texture;
        }));
        const failure = decoded.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        const textures = decoded.map(result => (result as PromiseFulfilledResult<THREE.Texture>).value);
        this.surfaces.set(id, { color: textures[0], normal: textures[1], orm: textures[2] });
      }),
    ]);
    this.loading = false;
    const failure = results.find(result => result.status === 'rejected');
    if (this.disposalRequested || failure) {
      this.dispose();
      throw failure?.status === 'rejected' ? failure.reason : new Error('Asset loading cancelled.');
    }
  }
  instantiate(id: ModelId) {
    const model = this.models.get(id);
    if (!model) throw new Error(`Asset nicht geladen: ${id}`);
    return model.clone(true);
  }
  material(id: SurfaceId, parameters: THREE.MeshStandardMaterialParameters = {}) {
    const maps = this.surfaces.get(id)!;
    return new THREE.MeshStandardMaterial({ map: maps.color, normalMap: maps.normal, roughnessMap: maps.orm, metalnessMap: maps.orm,
      roughness: 1, metalness: id === 'rock' ? 0.4 : 0, normalScale: new THREE.Vector2(0.65, 0.65), ...parameters });
  }
  dispose() {
    this.disposalRequested = true;
    // KTX2's worker pool cannot reject a terminated in-flight decode. Let all
    // tasks settle, then release their results and terminate workers once.
    if (this.loading || this.released) return;
    this.released = true;
    this.decoder.dispose();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    for (const model of this.models.values()) model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    this.ownedTextures.forEach(t => textures.add(t));
    for (const material of materials) {
      Object.values(material).forEach(t => { if (t instanceof THREE.Texture) textures.add(t); }); material.dispose();
    }
    geometries.forEach(g => g.dispose()); textures.forEach(t => { t.dispose(); if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close(); });
    this.models.clear(); this.surfaces.clear(); this.ownedTextures.clear();
  }
}

export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData.shared) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!material.userData.shared) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture && !value.userData.shared) textures.add(value);
    material.dispose();
  }
  geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); root.clear(); root.removeFromParent();
}
