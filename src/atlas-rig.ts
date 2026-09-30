import { groundHeight, type LevelWorld } from './levels';
import { contains } from './collision';
import type { HeightSampler } from './vehicle-pose';

/** Game metres, +Y up, bow -Z, hangar exit +Z. Mirrored by the Blender rig. */
export const ATLAS = {
  halfWidth: 7.8, front: -14, rear: 10, belly: -.65,
  hipX: 6, hipY: 1, footX: 9.5, legZ: [-8, 6] as readonly number[],
  upperLength: 3.2, lowerMin: 1.4, lowerMax: 7,
  padHalfX: 1.05, padHalfZ: 1.35, padThickness: .24,
  rampHalfWidth: 4.1, rampMin: 7, rampMax: 19, rampMaxAngle: .65,
  bayZ: 1, bayHover: 1.35, exitClearance: 8,
} as const;
export interface Vec3 { x: number; y: number; z: number }
export interface AtlasFoot { id: string; side: number; hip: Vec3; knee: Vec3; ankle: Vec3; pitch: number; roll: number; lowerLength: number }
export interface AtlasPlacement {
  x: number; z: number; yaw: number; height: number; feet: AtlasFoot[];
  rampLength: number; rampAngle: number; distance: number; valid: boolean; reason: string;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export function atlasPoint(p: Pick<AtlasPlacement, 'x'|'z'|'yaw'|'height'>, x: number, y: number, z: number): Vec3 {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: p.x + c*x + s*z, y: p.height+y, z: p.z-s*x+c*z };
}
export function atlasLocal(p: AtlasPlacement, x: number, z: number) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx=x-p.x, dz=z-p.z;
  return { x:c*dx-s*dz, z:s*dx+c*dz };
}

/** Finite two-link solve with a telescopic lower leg; outward knee stays on one branch. */
export function solveLeg(side: number, z: number, ankle: Vec3) {
  const hip={x:side*ATLAS.hipX,y:ATLAS.hipY,z}, dx=ankle.x-hip.x, dy=ankle.y-hip.y;
  const distance=Math.hypot(dx,dy), lowerLength=clamp(Math.max(ATLAS.upperLength,distance*.72),ATLAS.lowerMin,ATLAS.lowerMax);
  const valid=distance<ATLAS.upperLength+lowerLength-.05 && distance>Math.abs(ATLAS.upperLength-lowerLength)+.05;
  const d=Math.max(.01,distance), along=(ATLAS.upperLength**2-lowerLength**2+d*d)/(2*d);
  const perpendicular=Math.sqrt(Math.max(0,ATLAS.upperLength**2-along**2));
  const knee={x:hip.x+dx/d*along-dy/d*perpendicular*side,y:hip.y+dy/d*along+dx/d*perpendicular*side,z};
  return {hip,knee,lowerLength,valid};
}

/** Samples the complete sole, including rotated corners, against the shared heightfield. */
export function supportFoot(height: HeightSampler, x: number, z: number, yaw: number) {
  const c=Math.cos(yaw), s=Math.sin(yaw);
  const at=(dx:number,dz:number)=>height(x+c*dx+s*dz,z-s*dx+c*dz);
  const roll=clamp(Math.atan2(at(1,0)-at(-1,0),2),-.42,.42);
  const pitch=clamp(-Math.atan2(at(0,1)-at(0,-1),2),-.42,.42);
  const cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
  let y=-Infinity;
  for(let row=0;row<=6;row++)for(let col=0;col<=4;col++) {
    const px=(col/2-1)*ATLAS.padHalfX,pz=(row/3-1)*ATLAS.padHalfZ;
    const rx=cr*px,ry=cp*sr*px-sp*pz,rz=sp*sr*px+cp*pz;
    y=Math.max(y,at(rx,rz)-ry);
  }
  return {y:y+.025,pitch,roll};
}

export function solveAtlasGround(height: HeightSampler, pose: {x:number;z:number;yaw:number}, distance=22): AtlasPlacement {
  const at=(x:number,z:number)=>{const p=atlasPoint({...pose,height:0},x,0,z);return height(p.x,p.z);};
  let rootY=-Infinity;
  // Conservative body envelope: no single origin sample can bury a wing or nose.
  for(let z=ATLAS.front;z<=ATLAS.rear;z+=1)for(let x=-ATLAS.halfWidth;x<=ATLAS.halfWidth+.01;x+=1.3)
    rootY=Math.max(rootY,at(x,z)-ATLAS.belly+.75);
  const supports=([-1,1] as const).flatMap(side=>ATLAS.legZ.map((z,index)=>{
    const w=atlasPoint({...pose,height:0},side*ATLAS.footX,0,z);
    return {side,z,id:`${side<0?'left':'right'}_${index===0?'front':'aft'}`,...supportFoot(height,w.x,w.z,pose.yaw)};
  }));
  rootY=Math.max(rootY,...supports.map(f=>f.y+1.8));
  const feet=supports.map(f=>{
    const ankle={x:f.side*ATLAS.footX,y:f.y-rootY,z:f.z},leg=solveLeg(f.side,f.z,{...ankle,y:ankle.y+.5});
    return {...leg,ankle,id:f.id,side:f.side,pitch:f.pitch,roll:f.roll};
  });
  const toeHeight=Math.max(...[-4.1,-2,0,2,4.1].map(x=>at(x,distance)));
  const run=distance-ATLAS.rear, drop=rootY-toeHeight-.28;
  const rampAngle=Math.atan2(drop,run),rampLength=Math.hypot(run,drop);
  let valid=feet.every(f=>f.valid)&&rampAngle>=-.05&&rampAngle<=ATLAS.rampMaxAngle&&rampLength<=ATLAS.rampMax&&rampLength>=ATLAS.rampMin;
  // A ramp can bridge a hollow, but never cut through a crest between its ends.
  for(let t=0;t<=1.0001;t+=.025)for(const x of [-4.1,-2,0,2,4.1])
    if(rootY-drop*t-.1<at(x,ATLAS.rear+run*t)+.02)valid=false;
  return {...pose,height:rootY,feet,rampAngle,rampLength,distance,valid,reason:valid?'':'Untergrund oder Rampenneigung überschreitet den Arbeitsbereich des ATLAS-Fahrwerks.'};
}

const cache=new WeakMap<LevelWorld,AtlasPlacement>();
/** Keep the authored service zone fixed; find a reproducible clear approach around it. */
export function atlasPlacement(world:LevelWorld):AtlasPlacement {
  const cached=cache.get(world);if(cached)return cached;
  const space=world.definition.environment==='space';
  let best:AtlasPlacement|null=null,bestScore=Infinity;
  for(let step=0;step<24;step++) {
    const yaw=Math.PI/2+step*Math.PI/12;
    for(const distance of [20,22,24,26]) {
      const pose={x:world.base.x-Math.sin(yaw)*distance,z:world.base.z-Math.cos(yaw)*distance,yaw};
      const p:AtlasPlacement=space?{...pose,height:1.05,feet:[],rampAngle:0,rampLength:distance-10,distance,valid:true,reason:''}
        :solveAtlasGround((x,z)=>groundHeight(world,x,z),pose,distance);
      if(!best)best=p;
      if(!p.valid)continue;
      let clear=true;
      for(let z=-14;z<=distance+8;z+=2)for(let x=-10.6;x<=10.6;x+=2.12) {
        if(z>ATLAS.rear+(space?10:0)&&Math.abs(x)>4.8)continue;
        const point=atlasPoint(p,x,0,z);
        if(Math.abs(point.x)>world.bounds-5||Math.abs(point.z)>world.bounds-5||world.solids.some(s=>contains(s,point,2)))clear=false;
      }
      if(!clear)continue;
      const score=p.height+(distance-20)*.2+Math.min(step,24-step)*.04;
      if(score<bestScore){best=p;bestScore=score;}
    }
  }
  if(!Number.isFinite(bestScore))best={...best!,valid:false,reason:'ATLAS benötigt freien, mäßig geneigten Platz für vier Füße und die Ausfahrt neben der Ladezone.'};
  cache.set(world,best!);return best!;
}
export function atlasReserved(world:LevelWorld,x:number,z:number,padding=2) {
  const p=atlasPlacement(world),local=atlasLocal(p,x,z);
  return local.z>=ATLAS.front-padding&&local.z<=p.distance+ATLAS.exitClearance+padding
    &&Math.abs(local.x)<(local.z>ATLAS.rear?ATLAS.rampHalfWidth:11)+padding;
}

/** The platform is an additional support surface only during automatic deployment. */
export function atlasDriveSurface(world:LevelWorld,p:AtlasPlacement,x:number,z:number) {
  const local=atlasLocal(p,x,z),ground=groundHeight(world,x,z);
  if(Math.abs(local.x)>ATLAS.rampHalfWidth||local.z < -8 ||local.z>p.distance)return ground;
  const deck=p.height-Math.max(0,local.z-ATLAS.rear)*Math.tan(p.rampAngle);
  return Math.max(ground,deck);
}
