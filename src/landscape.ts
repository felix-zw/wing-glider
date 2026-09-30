import * as THREE from 'three';
import { atlasReserved } from './atlas-rig';
import { AssetLibrary,disposeObject } from './assets';
import { SPACE } from './config';
import { contains } from './collision';
import { groundHeight, bedrockDatum, getSolidFootprint, seededRandom, type LevelWorld, type Solid } from './levels';
import type { Quality } from './render-pipeline';
import { createTerrain, groundGeology } from './terrain-surface';
import { ASTEROIDS } from './asset-catalog';
import {getSculpt,sculptGeometry,registeredSculptKey,sculptKey} from './sculpt-runtime';
import {THEMES} from './themes';
import {DOCUMENTS} from './level-document';
import {previewSculpt,type SculptDefinition} from './sculpt';
import type {LevelDocument} from './level-document';
const DEFAULT_STONE:SculptDefinition={version:2,id:'shipped-stone',name:'Stein',shape:'round',seed:0,strokes:[],material:{scale:1,angularity:.55,relief:.55,weathering:.35}};

export function irregularRock(seed: number, detail = 1) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = 0.88 + 0.14 * Math.sin(x * 5 + seed) * Math.sin(z * 6 + y * 3 + seed) + 0.08 * Math.cos(y * 8 + z * 5);
    p.setXYZ(i, x * f, y * f * 0.8, z * f);
  }
  const uv = [];
  for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * 0.4, (p.getY(i) + p.getZ(i)) * 0.4);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals();
  return geometry;
}

/** Sculpted bodies use their shared surface revision; planet cliffs retain the
 * terrain-connected procedural formation. */
function formation(world: LevelWorld, solid: Solid, assets: AssetLibrary,sourceOverride?:SculptDefinition,quality:Quality='high') {
  if (solid.kind === 'asteroid') {
    const asset=ASTEROIDS[solid.assetId!];
    const sculpt=getSculpt(world.definition.id,solid.id)!;
    const doc=DOCUMENTS.get(world.definition.id),source=sourceOverride??doc?.sculpts?.[String(doc.objects.find(o=>o.id===solid.id)?.parameters.sculptId)];
    const mesh = new THREE.Mesh(sculptGeometry(sculpt?.[quality]??previewSculpt(source!)),assets.sculptMaterial(world.theme.rockTint,source??DEFAULT_STONE,quality));
    if(sculpt&&source)mesh.userData.sculpt={compiled:sculpt,source};
    mesh.customDepthMaterial=assets.sculptDepth(source??DEFAULT_STONE,quality);mesh.userData.skin=JSON.stringify([source?.material,source?.glow,world.theme.rockTint,quality]);mesh.userData.pending=!sculpt;
    mesh.onBeforeRender=(_renderer,_scene,camera)=>{const shader=(mesh.material as THREE.Material).userData.shader;
      if(shader?.uniforms.sculptCameraLocal)shader.uniforms.sculptCameraLocal.value.copy(camera.position).applyMatrix4(mesh.matrixWorld.clone().invert());};
    mesh.position.set(solid.x,2.4,solid.z);mesh.rotation.y=-(solid.rotation??0);mesh.scale.setScalar(solid.scale??1);
    mesh.userData.asteroidAsset=asset;
    mesh.castShadow = mesh.receiveShadow = true; mesh.userData.structure = solid;
    return mesh;
  }
  const footprint = getSolidFootprint(solid)!;
  const contour: THREE.Vector2[] = [], distances: number[] = [];
  let distance = 0;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z), count = Math.max(2, Math.ceil(length / 2));
    for (let j = 0; j < count; j++) { const t = j / count; contour.push(new THREE.Vector2(a.x + (b.x - a.x) * t - solid.x, a.z + (b.z - a.z) * t - solid.z)); distances.push(distance + t * length); }
    distance += length;
  }
  const space = false, count = contour.length;
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const seed = solid.x * 0.2 + solid.z * 0.13, random = seededRandom(Math.round(seed * 997) + 47021);
  const hash = (n: number) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); };
  const ground = contour.map(p => groundHeight(world, solid.x + p.x, solid.z + p.y));
  const meanGround = contour.reduce((sum, p) => sum + bedrockDatum(world, solid.x + p.x, solid.z + p.y), 0) / count;
  const tint = new THREE.Color(space ? '#8b99a7' : '#cbbda4');
  const seamTint = new THREE.Color(space ? '#657784' : '#9d947e');
  const roof = (x: number, z: number) => {
    if (solid.kind !== 'cliff') return 0;
    const c=Math.cos(solid.rotation??0),n=Math.sin(solid.rotation??0),lx=x*c+z*n,lz=-x*n+z*c;
    const along = (solid.halfX < solid.halfZ ? lz / solid.halfZ : lx / solid.halfX);
    const across = (solid.halfX < solid.halfZ ? lx / solid.halfX : lz / solid.halfZ);
    const end = .60 + .40 * Math.sqrt(Math.max(0, 1 - along * along));
    const peaks = .69 + .22 * Math.abs(Math.sin(along * 5.2 + seed)) + .09 * Math.cos(along * 12 + seed);
    const cleft = Math.exp(-Math.pow((along - .24 * Math.sin(seed)) / .13, 2)) * solid.height * .105;
    return Math.max(groundHeight(world, solid.x + x, solid.z + z) + 7.8,
      meanGround + solid.height * .56 * peaks * end - cleft + (1 - Math.abs(across)) * 2.1);
  };
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, shade: number, dark = false) => {
    const color = (dark ? seamTint : tint).clone().multiplyScalar(shade);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const top = Math.abs(n.y) > Math.max(Math.abs(n.x), Math.abs(n.z));
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b);
      uvs.push((top ? p.x : Math.abs(n.x) > Math.abs(n.z) ? p.z : p.x) * .11, (top ? p.z : p.y) * .11);
    }
  };
  const stitch = (a: THREE.Vector3[], b: THREE.Vector3[], band: number, dark = false) => {
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count, shade = band * (.94 + hash(i * 4.3 + Math.floor(a[i].y * .4)) * .12);
      triangle(a[i], b[i], a[next], shade, dark); triangle(b[i], b[next], a[next], shade, dark);
    }
  };
  let last: THREE.Vector3[] = [];
  if (!space) {
    // Straight low faces retain every vein and all navigable canyon clearances.
    for (const height of [-3, .7, 5.8]) {
      const row = contour.map((p, i) => new THREE.Vector3(solid.x + p.x, ground[i] + height, solid.z + p.y));
      if (last.length) stitch(last, row, height < 1 ? .88 : .96); last = row;
    }
    const layers = 12;
    for (let layer = 0; layer < layers; layer++) {
      // Each sediment bed ends in a projecting ledge followed by a dark setback.
      for (const step of [.83, 1]) {
        const t = (layer + step) / layers;
        const row = contour.map((p, i) => {
          const fracture = hash(Math.floor(distances[i] / 4.5) + Math.floor(layer / 3) * 17);
          const scale = 1 - t * (.21 + fracture * .22) - (step === 1 ? .034 : 0) * Math.min(1, t * 5);
          const x = solid.x + p.x * scale, z = solid.z + p.y * scale;
          const top = Math.max(ground[i] + 11, roof(p.x, p.y));
          const y = ground[i] + 5.8 + (top - ground[i] - 5.8) * t;
          return new THREE.Vector3(x, y, z);
        });
        stitch(last, row, .88 + hash(layer * 3.3) * .24, step === 1 && layer % 3 === 1); last = row;
      }
    }
    // Several fractured interior roof bands replace the flat central fan.
    const rim = last;
    for (const inset of [.74, .47, .22, .055]) {
      const row = rim.map((p, i) => {
        const x = (p.x - solid.x) * inset, z = (p.z - solid.z) * inset;
        return new THREE.Vector3(solid.x + x, roof(x, z) + (hash(i * 3.7 + inset * 41) - .5) * 1.8, solid.z + z);
      });
      stitch(last, row, 1.02 + inset * .06); last = row;
    }
    const middle = new THREE.Vector3(solid.x, roof(0, 0) + .4, solid.z);
    for (let i = 0; i < count; i++) triangle(last[i], middle, last[(i + 1) % count], 1.07);
  }

  // Embedded angular plates catch light on ledges and split the roof silhouette.
  // Every vertex is clamped inside the collider; cosmetic foot scree is <= .7 m.
  const shard = irregularRock(seed, 0), shardPosition = shard.attributes.position;
  const transform = new THREE.Matrix4(), rotation = new THREE.Quaternion(), euler = new THREE.Euler(), point = new THREE.Vector3();
  const clamp = (p: THREE.Vector3, padding: number) => {
    if (contains(solid, { x: p.x, z: p.z }, padding)) return;
    let low = 0, high = 1;
    for (let i = 0; i < 12; i++) {
      const t = (low + high) * .5;
      if (contains(solid, { x: solid.x + (p.x - solid.x) * t, z: solid.z + (p.z - solid.z) * t }, padding)) low = t; else high = t;
    }
    p.x = solid.x + (p.x - solid.x) * low; p.z = solid.z + (p.z - solid.z) * low;
  };
  const addShard = (center: THREE.Vector3, size: THREE.Vector3, tilt: THREE.Euler, shade: number, inside = true) => {
    rotation.setFromEuler(tilt); transform.compose(center, rotation, size);
    for (let i = 0; i < shardPosition.count; i += 3) {
      const vertices: THREE.Vector3[] = [];
      for (let j = 0; j < 3; j++) { point.fromBufferAttribute(shardPosition, i + j).applyMatrix4(transform); clamp(point, inside ? -.025 : .7); vertices.push(point.clone()); }
      triangle(vertices[0], vertices[1], vertices[2], shade);
    }
  };
  const pieces = space ? 90 : 108;
  for (let piece = 0; piece < pieces; piece++) {
    const index = Math.floor(random() * count), p = contour[index];
    if (space) {
      const upper = piece % 4 !== 0, inset = .25 + random() * .57;
      const x = p.x * inset, z = p.y * inset;
      const y = upper ? 7 + solid.height * (.25 + (1 - inset) * .36) : -2 - solid.height * (.20 + (1 - inset) * .4);
      euler.set((random() - .5) * .9, random() * Math.PI, (random() - .5) * .7);
      addShard(new THREE.Vector3(solid.x + x, y, solid.z + z), new THREE.Vector3(1.4 + random() * 2.8, .5 + random() * 1.5, 1.4 + random() * 2.3), euler, .80 + random() * .36);
    } else {
      const roofPiece = piece > 67, t = roofPiece ? .82 + random() * .14 : .2 + random() * .68;
      const inset = roofPiece ? .22 + random() * .44 : 1 - t * (.22 + random() * .18);
      const x = p.x * inset, z = p.y * inset;
      const y = roofPiece ? roof(x, z) + .4 : ground[index] + 5.8 + (roof(p.x, p.y) - ground[index] - 5.8) * t;
      euler.set((random() - .5) * .38, random() * Math.PI, (random() - .5) * .3);
      addShard(new THREE.Vector3(solid.x + x, y, solid.z + z), new THREE.Vector3(1.2 + random() * 2.1, roofPiece ? .7 + random() * 1.6 : .3 + random() * .55, 1.2 + random() * 2.4), euler, .88 + random() * .26);
    }
  }
  if (!space) for (let piece = 0; piece < 42; piece++) {
    const p = contour[Math.floor(random() * count)], inset = .985 + random() * .025;
    const x = solid.x + p.x * inset, z = solid.z + p.y * inset;
    // Leave seams and their fragment release areas unobstructed.
    if (world.deposits.some(d => d.structureId === solid.id && Math.hypot(d.x - x, d.z - z) < 6.5)) continue;
    const size = .22 + random() * .39;
    euler.set(random() * .4, random() * Math.PI, random() * .35);
    addShard(new THREE.Vector3(x, groundHeight(world, x, z) + size * .12, z), new THREE.Vector3(size, size * .6, size * 1.2), euler, .83 + random() * .22, false);
  }
  shard.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const material = assets.material('rock', { vertexColors: true, flatShading: true, roughness: space ? .94 : 1, metalness: space ? .16 : .025, side: THREE.DoubleSide });
  if (!space) {
    // Dust settles into the basal rock: the material transition follows the
    // actual slope instead of drawing a uniform horizontal skirt around it.
    const clearance = positions.filter((_, i) => i % 3 === 1).map((y, i) => y - groundHeight(world, positions[i*3], positions[i*3+2]));
    geometry.setAttribute('groundClearance', new THREE.Float32BufferAttribute(clearance, 1));
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float groundClearance; varying float vGroundClearance;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundClearance=groundClearance;');
      shader.fragmentShader = 'varying float vGroundClearance;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.25,.225,.175),.35*(1.0-smoothstep(0.0,4.0,vGroundClearance)));');
    };
    material.customProgramCacheKey = () => 'embedded-cliff-foot-v1';
  }
  const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.structure = solid;
  return mesh;
}

export class Landscape {
  readonly root = new THREE.Group();
  readonly solids: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  readonly terrain: THREE.Mesh | null;
  readonly aimTargets: THREE.Mesh[] = [];
  readonly moving: THREE.InstancedMesh | null;
  private decorations: { mesh: THREE.InstancedMesh; count: number }[] = [];
  private shield: THREE.Mesh | null = null;
  private quality:Quality='high';
  constructor(public world: LevelWorld, private assets: AssetLibrary) {
    const space = world.definition.environment === 'space';
    this.terrain = space ? null : createTerrain(world, assets);
    if(this.terrain)(this.terrain.material as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(world.theme.rockTint));
    if (this.terrain) { this.root.add(this.terrain); this.aimTargets.push(this.terrain); }
    for (const solid of world.solids) { const mesh = formation(world, solid, assets); if(solid.kind==='cliff')mesh.material.color.multiply(new THREE.Color(world.theme.rockTint));this.solids.push(mesh); this.root.add(mesh); this.aimTargets.push(mesh); }
    this.scatter(assets, space);
    if (!space) { this.weatheredGravel(assets); this.footScree(assets); }
    if (space) {
      this.stars();
      const material = assets.sculptMaterial(world.theme.rockTint,DEFAULT_STONE,'standard');
      this.moving = new THREE.InstancedMesh(assets.rubbleGeometry(), material, SPACE.hazardCount);
      this.moving.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.moving.frustumCulled = false; this.moving.castShadow = true; this.root.add(this.moving);
      const shield = new THREE.Mesh(new THREE.RingGeometry(SPACE.shieldRadius - 0.08, SPACE.shieldRadius, 128), new THREE.MeshBasicMaterial({ color: '#75bbe1', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      shield.rotation.x = -Math.PI / 2; shield.position.set(world.base.x,.2,world.base.z); this.root.add(shield); this.shield = shield;
    } else { this.moving = null; this.shelters(); }
    this.border();
  }
  previewDraft(document:LevelDocument){
    for(const mesh of [...this.solids])if(!document.objects.some(o=>o.id===mesh.userData.structure.id)){disposeObject(mesh);this.solids.splice(this.solids.indexOf(mesh),1);this.aimTargets.splice(this.aimTargets.indexOf(mesh),1);}
    for(const object of document.objects){let mesh=this.solids.find(m=>m.userData.structure.id===object.id);
      if(!mesh&&object.assetId==='sculpt-asteroid'){const solid:Solid={kind:'asteroid',id:object.id,x:object.x,z:object.z,rotation:object.rotation,scale:object.scale,radius:36* object.scale,height:72* object.scale};mesh=formation(this.world,solid,this.assets,document.sculpts![String(object.parameters.sculptId)],this.quality);this.solids.push(mesh);this.aimTargets.push(mesh);this.root.add(mesh);}
      if(mesh&&object.assetId==='sculpt-asteroid'){const source=document.sculpts![String(object.parameters.sculptId)];if(mesh.userData.pending&&registeredSculptKey(document.id,object.id)===sculptKey(source,object.scale)){const compiled=getSculpt(document.id,object.id)!;mesh.geometry.dispose();mesh.geometry=sculptGeometry(compiled[this.quality]);mesh.userData.sculpt={compiled,source};mesh.userData.pending=false;}this.applySkin(mesh,source,THEMES[document.themeId]?.rockTint??this.world.theme.rockTint);if(mesh.userData.sculpt)mesh.userData.sculpt.source=source;mesh.position.set(object.x,2.4,object.z);mesh.rotation.y=-object.rotation;mesh.scale.setScalar(object.scale);mesh.updateMatrixWorld(true);}
      else if(mesh){mesh.position.x=object.x;mesh.position.z=object.z;mesh.updateMatrixWorld(true);}
    }
  }
  private applySkin(mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>,source:SculptDefinition,tint:string){const skin=JSON.stringify([source.material,source.glow,tint,this.quality]);if(mesh.userData.skin===skin)return;mesh.material.dispose();mesh.customDepthMaterial?.dispose();const material=this.assets.sculptMaterial(tint,source,this.quality),depth=this.assets.sculptDepth(source,this.quality);mesh.traverse(o=>{if(o instanceof THREE.Mesh){o.material=material;o.customDepthMaterial=depth;}});mesh.userData.skin=skin;}
  syncSpace(world:LevelWorld,document:LevelDocument,quality:Quality,preserveId?:string){
    this.world=world;this.quality=quality;this.previewDraft(document);if(this.shield)this.shield.position.set(world.base.x,.2,world.base.z);
    for(const solid of world.solids){const mesh=this.solids.find(m=>m.userData.structure.id===solid.id)!;if(solid.kind!=='asteroid')continue;
      const source=document.sculpts![String(document.objects.find(o=>o.id===solid.id)!.parameters.sculptId)],compiled=getSculpt(document.id,solid.id)!;
      if(mesh.userData.sculpt?.compiled[quality]!==compiled[quality]||mesh.userData.preview&&preserveId!==solid.id){if(preserveId!==solid.id){for(const child of [...mesh.children]){(child as THREE.Mesh).geometry?.dispose();child.removeFromParent();}mesh.geometry.dispose();mesh.geometry=sculptGeometry(compiled[quality]);delete mesh.userData.preview;}}
      this.applySkin(mesh,source,world.theme.rockTint);
      mesh.userData.sculpt={compiled,source};mesh.userData.structure=solid;mesh.userData.asteroidAsset=solid.query;mesh.userData.pending=false;
    }
  }
  private scatter(assets: AssetLibrary, space: boolean) {
    const random = seededRandom(this.world.definition.seed + 17), dummy = new THREE.Object3D();
    for (let variant = 0; variant < 4; variant++) {
      const count = Math.ceil((space ? 110 : 420)*this.world.theme.decorationDensity);
      const material = space?assets.sculptMaterial(this.world.theme.rockTint,DEFAULT_STONE,'standard'):assets.material('rock', { color: '#bab49d', roughness: 1, metalness: 0.03 });
      const mesh = new THREE.InstancedMesh(space?assets.rubbleGeometry():irregularRock(variant * 1.8 + 2, 1), material, count);
      let actual = 0;
      for (let tries = 0; actual < count && tries < count * 10; tries++) {
        const x = (random() - 0.5) * (space ? 700 : 470), z = (random() - 0.5) * (space ? 700 : 470);
        if(atlasReserved(this.world,x,z))continue;
        if (!space && (this.world.shelters.some(s => Math.hypot(s.x - x, s.z - z) < s.radius + 4) || this.world.solids.some(s => contains(s, { x, z }, 0.5)) || this.world.deposits.some(d => Math.hypot(d.x - x, d.z - z) < 7))) continue;
        const size = space ? 0.7 + random() * 3 : 0.17 + Math.pow(random(), 2.4) * 1.45;
        dummy.position.set(x, space ? -32 - random() * 100 : groundHeight(this.world, x, z) + size * 0.18, z);
        dummy.rotation.set(random() * 0.6, random() * Math.PI * 2, random() * 0.5); dummy.scale.set(size, size * (space ? 1 : 0.7), size * (0.8 + random() * 0.4)); dummy.updateMatrix(); mesh.setMatrixAt(actual++, dummy.matrix);
      }
      mesh.count = actual; mesh.castShadow = !space; mesh.receiveShadow = true; mesh.computeBoundingSphere(); this.root.add(mesh); this.decorations.push({ mesh, count: actual });
    }
  }
  private weatheredGravel(assets: AssetLibrary) {
    const random = seededRandom(this.world.definition.seed + 819), dummy = new THREE.Object3D();
    const warm = new THREE.Color('#b7aa87'), cold = new THREE.Color('#777968');
    for (let variant = 0; variant < 2; variant++) {
      const count = Math.ceil(3200*this.world.theme.decorationDensity), material = assets.material('rock', { roughness: 1, metalness: 0, normalScale: new THREE.Vector2(.25,.25) });
      const mesh = new THREE.InstancedMesh(irregularRock(31 + variant, 0), material, count);
      let placed = 0;
      for (let attempt = 0; placed < count && attempt < count * 12; attempt++) {
        const x = (random()-.5)*430, z = (random()-.5)*430, geology = groundGeology(this.world,x,z);
        if(atlasReserved(this.world,x,z))continue;
        if (geology.shelter > .5 || this.world.solids.some(s => contains(s,{x,z},.25))) continue;
        const h = groundHeight(this.world,x,z);
        const slope = Math.min(1,Math.hypot(groundHeight(this.world,x+.6,z)-h,groundHeight(this.world,x,z+.6)-h));
        const patch = .5+.5*Math.sin(x*.087+Math.sin(z*.069)*2.8)*Math.sin(z*.091+x*.015);
        if (random() > .07 + geology.rock*.7 + slope*.38 + Math.pow(patch,3)*.3) continue;
        const size = .07 + Math.pow(random(),1.6)*(.26+geology.rock*.19);
        dummy.position.set(x,h+size*.08,z); dummy.rotation.set((random()-.5)*.6,random()*Math.PI*2,(random()-.5)*.4);
        dummy.scale.set(size,size*(.24+random()*.36),size*(.65+random()*.8)); dummy.updateMatrix(); mesh.setMatrixAt(placed,dummy.matrix);
        mesh.setColorAt(placed,warm.clone().lerp(cold,random()*.55+geology.rock*.3).multiplyScalar(.8+random()*.4)); placed++;
      }
      mesh.count=placed; mesh.castShadow=mesh.receiveShadow=true; mesh.computeBoundingSphere();
      this.root.add(mesh); this.decorations.push({mesh,count:placed});
    }
  }
  private footScree(assets: AssetLibrary) {
    const random = seededRandom(this.world.definition.seed + 3407), dummy = new THREE.Object3D(), up = new THREE.Vector3(0,1,0);
    const normal = new THREE.Vector3(), cliffs = this.world.solids.filter(s => s.kind === 'cliff');
    const material = assets.material('rock', { color:'#cbbda4', roughness:1, metalness:.025 });
    const mesh = new THREE.InstancedMesh(irregularRock(18.7,1),material,Math.ceil(cliffs.length*105*this.world.theme.decorationDensity));
    mesh.name='embedded-foot-scree'; let count=0;
    for (const cliff of cliffs) {
      const contour=getSolidFootprint(cliff)!;
      for (let i=0;i<Math.floor(105*this.world.theme.decorationDensity);i++) {
        const edge=Math.floor(random()*contour.length), a=contour[edge], b=contour[(edge+1)%contour.length], t=random();
        const length=Math.hypot(b.x-a.x,b.z-a.z), distance=.5+Math.pow(random(),1.8)*17;
        const x=a.x+(b.x-a.x)*t+(b.z-a.z)/length*distance;
        const z=a.z+(b.z-a.z)*t-(b.x-a.x)/length*distance;
        if(atlasReserved(this.world,x,z))continue;
        if(this.world.solids.some(s=>contains(s,{x,z},.2)) || this.world.shelters.some(s=>Math.hypot(x-s.x,z-s.z)<s.radius+3)
          || this.world.deposits.some(d=>Math.hypot(x-d.x,z-d.z)<5.5)) continue;
        const size=(.45+random()*1.7)*(1-distance/30);
        const h=groundHeight(this.world,x,z);
        normal.set(groundHeight(this.world,x-.3,z)-groundHeight(this.world,x+.3,z),.6,groundHeight(this.world,x,z-.3)-groundHeight(this.world,x,z+.3)).normalize();
        dummy.position.set(x,h-.10,z); dummy.quaternion.setFromUnitVectors(up,normal); dummy.rotateY(random()*Math.PI*2);
        dummy.scale.set(size,size*(.12+random()*.14),size*(.7+random()*.65)); dummy.updateMatrix(); mesh.setMatrixAt(count,dummy.matrix);
        mesh.setColorAt(count++,new THREE.Color().setScalar(.80+random()*.3));
      }
    }
    mesh.count=count; mesh.castShadow=mesh.receiveShadow=true; mesh.computeBoundingSphere();
    this.root.add(mesh); this.decorations.push({mesh,count});
  }
  private stars() {
    // A distant, motionless stellar backdrop adds depth without atmospheric fog.
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), new THREE.ShaderMaterial({
      depthWrite: false, uniforms:{backgroundColor:{value:new THREE.Color(this.world.theme.background)}},
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        uniform vec3 backgroundColor;
        varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
        void main(){
          vec2 p=vUv*7.0;
          float field=noise(p)*.55+noise(p*2.03+3.1)*.28+noise(p*4.07)*.12+noise(p*8.1)*.05;
          float ribbon=exp(-pow((vUv.y-vUv.x*.4-.3)*3.0,2.0));
          vec3 base=backgroundColor;
          vec3 blue=vec3(.005,.013,.023)*smoothstep(.32,.77,field)*ribbon;
          gl_FragColor=vec4(base+blue,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    backdrop.userData.skyBackdrop='clouds';backdrop.rotation.x = -Math.PI / 2; backdrop.position.y = -180; backdrop.renderOrder = -10; backdrop.frustumCulled = false; this.root.add(backdrop);
    const random = seededRandom(7113), positions = [], colors = [];
    for (let i = 0; i < 3200; i++) { positions.push((random() - .5) * 1200, -120 - random() * 220, (random() - .5) * 1200); const c = new THREE.Color('#b2c7db').multiplyScalar(.22 + Math.pow(random(), 4) * .95); colors.push(c.r,c.g,c.b); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const stars=new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: 1.5, sizeAttenuation: false, transparent: true, opacity: .86, depthWrite: false }));stars.userData.skyBackdrop='stars';this.root.add(stars);
  }
  private shelters() {
    const ivory = new THREE.MeshStandardMaterial({ color: '#b7c7b9', metalness: .6, roughness: .4 });
    const light = new THREE.MeshStandardMaterial({ color: '#86d7c8', emissive: '#55dec6', emissiveIntensity: 2.5, roughness: .4 });
    for (const shelter of this.world.shelters) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(shelter.radius-.07, shelter.radius,96,1,0,Math.PI*2),new THREE.MeshBasicMaterial({ color:'#87dbb9',transparent:true,opacity:.3,side:THREE.DoubleSide,depthWrite:false }));
      ring.rotation.x=-Math.PI/2; ring.position.set(shelter.x,1.56,shelter.z); this.root.add(ring);
      for(let i=0;i<4;i++) {
        const a=i*Math.PI/2, x=shelter.x+Math.cos(a)*shelter.radius, z=shelter.z+Math.sin(a)*shelter.radius;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(.22,.45,1.8,6),ivory); base.position.set(x,2.4,z); base.castShadow=true;
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.8,8),light); lamp.position.set(x,3.5,z); this.root.add(base,lamp);
      }
    }
  }
  private border() {
    const points=[];
    for(let edge=0;edge<4;edge++) for(let i=0;i<=100;i++) {
      const t=-this.world.bounds+i/100*this.world.bounds*2;
      const x=edge===0?t:edge===1?this.world.bounds:edge===2?-t:-this.world.bounds, z=edge===0?-this.world.bounds:edge===1?t:edge===2?this.world.bounds:-t;
      points.push(new THREE.Vector3(x,groundHeight(this.world,x,z)+.2,z));
    }
    const border=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:'#c9b680',transparent:true,opacity:.3,dashSize:2,gapSize:4})); border.computeLineDistances(); this.root.add(border);
  }
  setQuality(quality: Quality) {this.quality=quality;for(const mesh of this.solids){const a=mesh.userData.asteroidAsset;if(!a)continue;
    const sculpt=mesh.userData.sculpt as {compiled:NonNullable<ReturnType<typeof getSculpt>>;source:SculptDefinition}|undefined;
    if(sculpt){mesh.geometry.dispose();mesh.material.dispose();mesh.geometry=sculptGeometry(sculpt.compiled[quality]);mesh.material=this.assets.sculptMaterial(this.world.theme.rockTint,sculpt.source,quality);mesh.customDepthMaterial?.dispose();mesh.customDepthMaterial=this.assets.sculptDepth(sculpt.source,quality);}
  } for(const decoration of this.decorations) decoration.mesh.count=Math.floor(decoration.count*(quality==='high'?1:.55)); }
  animate(time: number) { if(this.shield) (this.shield.material as THREE.MeshBasicMaterial).opacity=.35+Math.sin(time*.8)*.08; }
}
