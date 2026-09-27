import * as THREE from 'three';
import type { AssetLibrary } from './assets';
import { groundHeight, seededRandom, type LevelWorld } from './levels';
import { RESOURCES, type Deposit } from './resources';
import { irregularRock } from './landscape';

export type MineralPiece = { position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 };
type SurfacePoint = (u: number, v: number, lift?: number) => THREE.Vector3;

class SurfaceGeometry {
  private positions: number[] = [];
  private colors: number[] = [];
  private uv: number[] = [];
  constructor(private ground: boolean, private alpha = false) {}
  triangle(points: THREE.Vector3[], color: THREE.Color, opacity = [1,1,1]) {
    const normal = new THREE.Vector3().subVectors(points[1],points[0]).cross(new THREE.Vector3().subVectors(points[2],points[0]));
    for (let i=0;i<3;i++) {
      const p=points[i]; this.positions.push(p.x,p.y,p.z); this.colors.push(color.r,color.g,color.b);
      if(this.alpha) this.colors.push(opacity[i]);
      this.uv.push((this.ground || Math.abs(normal.z)>Math.abs(normal.x) ? p.x : p.z)*.11,(this.ground ? p.z : p.y)*.11);
    }
  }
  build() {
    const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(this.positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(this.colors,this.alpha ? 4 : 3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2)); geometry.computeVertexNormals(); return geometry;
  }
}

export function terrainNormal(world: LevelWorld,x: number,z: number) {
  return new THREE.Vector3(groundHeight(world,x-.2,z)-groundHeight(world,x+.2,z),.4,
    groundHeight(world,x,z-.2)-groundHeight(world,x,z+.2)).normalize();
}

/** Faceted prisms have a buried, dark root and a short asymmetric termination. */
export function crystalGeometry() {
  const vertices: number[]=[], colors: number[]=[], sides=5;
  const rows=[{y:-.38,r:.22},{y:-.12,r:.33},{y:.66,r:.26},{y:1.02,r:0}];
  for(let row=0;row<rows.length-1;row++) for(let side=0;side<sides;side++) {
    const point=(level:number,index:number)=>{
      const a=index/sides*Math.PI*2, ring=rows[level];
      return [Math.cos(a)*ring.r+(level===3?.07:0),ring.y,Math.sin(a)*ring.r+(level===3?-.04:0)];
    };
    for(const [level,index] of [[row,side],[row,side+1],[row+1,side+1],[row,side],[row+1,side+1],[row+1,side]]) {
      vertices.push(...point(level,index)); const shade=level===0?.18:level===1?.45:level===2?.8:1; colors.push(shade,shade,shade);
    }
  }
  const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); geometry.computeVertexNormals(); return geometry;
}

/** Permanent host rock and weathering remain after extraction. Only the thin
 * mineral fissures and rooted clusters participate in the depletion animation. */
export function createOreOutcrop(world: LevelWorld, assets: AssetLibrary, d: Deposit,
  mineralGeometry: THREE.BufferGeometry, mineralMaterial: THREE.MeshStandardMaterial) {
  const surface=d.surface!, ground=surface.kind==='ground';
  const seed=world.definition.seed+Number(d.id.split('-').at(-1))*313, random=seededRandom(seed);
  const normal=new THREE.Vector3(surface.nx,0,surface.nz), up=new THREE.Vector3(0,1,0);
  const lobes=[{u:-.58,v:(random()-.5)*.45},{u:0,v:(random()-.5)*.35},{u:.57,v:(random()-.5)*.45}];
  const path=(u:number)=>Math.sin(u*5.3+seed)*.13+Math.sin(u*11.7+seed*.2)*.07;
  const relief=(u:number,v:number)=>{
    let height=0;
    for(const lobe of lobes) height=Math.max(height,Math.exp(-((u-lobe.u)**2/.14+(v-lobe.v)**2/.32)));
    return .045+height*(ground?.15:.28);
  };
  const point: SurfacePoint=(u,v,lift=0)=>{
    const along=u*surface.width*.5, outward=ground?v*2.1:0;
    const x=d.x-surface.nz*along+surface.nx*outward, z=d.z+surface.nx*along+surface.nz*outward;
    const p=new THREE.Vector3(x,ground?groundHeight(world,x,z)+.035:surface.y+.28+(v+1)*2.1,z);
    return p.addScaledVector(ground?terrainNormal(world,x,z):normal,lift);
  };
  const host=new THREE.Color(ground?'#a49b80':world.definition.environment==='space'?'#8b99a7':'#cbbda4');
  const oxide=new THREE.Color(d.resource==='copper'?'#79614a':d.resource==='crystal'?'#626d62':'#646e6b');
  const bed=new SurfaceGeometry(ground), stain=new SurfaceGeometry(ground,true), seam=new SurfaceGeometry(ground);
  // Feathered mineral dust connects the outcrop to the surrounding soil/facet.
  const rim=40, rings=[0,.42,.76,1];
  const radius=Array.from({length:rim},(_,i)=>.92+.06*Math.sin(i*1.7+seed)+random()*.1);
  for(let ring=0;ring<rings.length-1;ring++) for(let i=0;i<rim;i++) {
    const next=(i+1)%rim;
    const sample=(r:number,j:number)=>{
      const a=j/rim*Math.PI*2, scale=r*radius[j];
      return point(Math.cos(a)*scale*(ground?1.38:1.03),Math.sin(a)*scale*1.04,ground?.005:.018);
    };
    const a=sample(rings[ring],i), b=sample(rings[ring],next), c=sample(rings[ring+1],next), e=sample(rings[ring+1],i);
    const alpha=[.46,.38,.20,0], tint=host.clone().lerp(oxide,.36).multiplyScalar(.75+random()*.2);
    stain.triangle([a,b,c],tint,[alpha[ring],alpha[ring],alpha[ring+1]]); stain.triangle([a,c,e],tint,[alpha[ring],alpha[ring+1],alpha[ring+1]]);
  }
  // Low broken plates form a common geological matrix around all three lobes.
  const rock=irregularRock(seed*.01,0), rockPositions=rock.attributes.position, matrix=new THREE.Matrix4();
  const dummy=new THREE.Object3D(), transformed=new THREE.Vector3();
  for(let i=0;i<62;i++) {
    const lobe=lobes[i%3], dust=i>42;
    const u=THREE.MathUtils.clamp(lobe.u+(random()-.5)*(dust?.95:.68),-.98,.98);
    const v=lobe.v+path(u)+(random()-.5)*(dust?1.8:.8), p=point(u,v);
    const n=ground?terrainNormal(world,p.x,p.z):normal;
    const size=dust?.08+random()*.20:.32+random()*.44;
    dummy.position.copy(p).addScaledVector(n,dust?0:relief(u,v)*.55);
    dummy.quaternion.setFromUnitVectors(up,n); dummy.rotateY(random()*Math.PI*2);
    dummy.scale.set(size,size*(dust?.30:.35),size*(.75+random()*.55)); dummy.updateMatrix(); matrix.copy(dummy.matrix);
    const tint=host.clone().lerp(oxide,.12+random()*.15).multiplyScalar(.66+random()*.4);
    for(let vertex=0;vertex<rockPositions.count;vertex+=3) {
      const points=[];
      for(let j=0;j<3;j++) points.push(transformed.fromBufferAttribute(rockPositions,vertex+j).applyMatrix4(matrix).clone());
      bed.triangle(points,tint);
    }
  }
  rock.dispose();
  // Branching, interrupted mineral ribbons use the same coordinates as roots.
  const ribbon=(start:number,end:number,offset:number,width:number,lower=false)=>{
    const segments=28;
    for(let i=0;i<segments;i++) {
      const u=start+(end-start)*i/segments, next=start+(end-start)*(i+1)/segments;
      if(i>0 && i<segments-1 && random()<.12) continue;
      const centre=(t:number)=>lower?-.90+Math.sin(t*4+seed)*.035:path(t)+offset*(1-Math.abs(t));
      const w=width*(.5+random())*(.45+.55*Math.sin((i+.5)/segments*Math.PI));
      const p=(t:number,v:number)=>point(t,v,relief(t,v)+.04);
      const a=p(u,centre(u)-w),b=p(next,centre(next)-w),c=p(next,centre(next)+w),e=p(u,centre(u)+w);
      const tint=new THREE.Color().setScalar(.35+random()*.44);
      seam.triangle([a,b,c],tint); seam.triangle([a,c,e],tint);
    }
  };
  ribbon(-.96,.96,0,.065); ribbon(-.78,.35,.42,.041); ribbon(-.25,.88,-.38,.036);
  if(!ground) ribbon(-.9,.9,0,.026,true);
  const patchMaterial=assets.material('rock',{color:RESOURCES[d.resource].color,emissive:RESOURCES[d.resource].color,
    emissiveIntensity:d.resource==='crystal'?.07:.015,vertexColors:true,metalness:RESOURCES[d.resource].metalness,
    roughness:.78,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const patch=new THREE.Mesh(seam.build(),patchMaterial); patch.name=`${d.id}-surface`; patch.receiveShadow=true;
  const count=d.resource==='crystal'?30:36, material=mineralMaterial.clone();
  material.vertexColors=d.resource==='crystal'; material.roughness=d.resource==='crystal'?.32:.58;
  material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif');};
  material.customProgramCacheKey=()=>`embedded-mineral-${d.resource}`;
  const chunks=new THREE.InstancedMesh(mineralGeometry,material,count), pieces: MineralPiece[]=[];
  chunks.name=`${d.id}-clusters`; chunks.castShadow=chunks.receiveShadow=true; chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for(let i=0;i<count;i++) {
    const lobe=lobes[i%3], u=THREE.MathUtils.clamp(lobe.u+(random()-.5)*.54,-.91,.91);
    const v=lobe.v+path(u)+(random()-.5)*.5, p=point(u,v,relief(u,v));
    const n=ground?terrainNormal(world,p.x,p.z):normal.clone().addScaledVector(up,d.resource==='crystal'?.55:.16).normalize();
    const hero=i<3, size=hero?(ground?.72:1.0)+random()*.30:.22+Math.pow(random(),1.5)*.53;
    dummy.position.copy(p).addScaledVector(n,d.resource==='crystal'?-.10:-.10*size);
    dummy.quaternion.setFromUnitVectors(up,n); dummy.rotateY(random()*Math.PI*2);
    dummy.rotateX((random()-.5)*.5); dummy.rotateZ((random()-.5)*.4);
    dummy.scale.set(size*(.72+random()*.4),size*(d.resource==='crystal'?1.0+random()*.45:(ground?.4:.75)+random()*.35),size*(.7+random()*.5));
    dummy.updateMatrix(); chunks.setMatrixAt(i,dummy.matrix);
    const tint=new THREE.Color('#8a8b7d').lerp(new THREE.Color('#ffffff'),hero?.82:.15+random()*.65);
    chunks.setColorAt(i,tint); pieces.push({position:dummy.position.clone(),rotation:dummy.quaternion.clone(),scale:dummy.scale.clone()});
  }
  chunks.computeBoundingSphere();
  return {patch,chunks,pieces,bed:bed.build(),stain:stain.build()};
}
