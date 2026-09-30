import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export type Quality = 'high' | 'standard';
class HalfResolutionAO extends GTAOPass {
  override setSize(width: number, height: number) { super.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2))); }
  override dispose() { super.dispose(); this.gtaoMaterial.dispose(); this.blendMaterial.dispose(); }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, dt = 0, maskActive = false) {
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse(object => {
      if (!object.visible) return;
      const mesh = object as THREE.Mesh;
      const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      if (object.userData.excludeAO || object instanceof THREE.Sprite || materials.some(m => !m.depthWrite || m.opacity < 1)) { hidden.push(object); object.visible = false; }
    });
    try { super.render(renderer, writeBuffer, readBuffer, dt, maskActive); } finally { hidden.forEach(object => object.visible = true); }
  }
}
export class RenderPipeline {
  readonly composer: EffectComposer;
  readonly ao: GTAOPass;
  readonly bloom: UnrealBloomPass;
  private passes: { dispose(): void }[];
  constructor(readonly renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    const render = new RenderPass(scene, camera);
    this.ao = new HalfResolutionAO(scene, camera, 512, 256);
    this.ao.updateGtaoMaterial({ radius: 2.6, thickness: 2.5, distanceFallOff: 0.8, samples: 8 });
    this.ao.updatePdMaterial({ samples: 8, radius: 4 });
    this.ao.blendIntensity = 0.65;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 256), 0.24, 0.35, 1.5);
    const output = new OutputPass(), aa = new SMAAPass();
    for (const pass of [render, this.ao, this.bloom, aa, output]) this.composer.addPass(pass);
    this.passes = [render, this.ao, this.bloom, output, aa];
  }
  setSky(scene:THREE.Scene,camera:THREE.Camera){
    const sky=new RenderPass(scene,camera);this.composer.insertPass(sky,0);this.passes.push(sky);
    const main=this.composer.passes[1] as RenderPass;main.clear=false;main.clearDepth=true;
  }
  setQuality(quality: Quality) { this.ao.enabled = quality === 'high'; this.bloom.strength = quality === 'high' ? 0.24 : 0.16; }
  resize(width: number, height: number) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(width, height); }
  render(dt: number) { this.renderer.info.reset(); this.composer.render(dt); }
  renderOffscreen(dt:number){this.renderer.info.reset();const screen=this.composer.renderToScreen;this.composer.renderToScreen=false;try{this.composer.render(dt);return this.composer.readBuffer.texture;}finally{this.composer.renderToScreen=screen;}}
  dispose() { this.passes.forEach(p => p.dispose()); this.composer.dispose(); }
}
