import { ASTEROIDS } from './asset-catalog';
import type { AsteroidAsset } from './asset-catalog';
import type { Solid } from './levels';
export interface Vec3 { x: number; y: number; z: number }
export type RockPlacement = Solid & { assetId?: string; rotation?: number; scale?: number };
interface Tree {lo:number[];hi:number[];triangles?:number[];left?:Tree;right?:Tree}
const trees=new WeakMap<AsteroidAsset,Tree>();
function treeFor(a:AsteroidAsset){
  let tree=trees.get(a);if(tree)return tree;
  const boxes=Array.from({length:a.indices.length/3},(_,j)=>{
    const points=a.indices.slice(j*3,j*3+3).map(i=>a.vertices[i]);
    return {id:j*3,lo:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),hi:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
  });
  const build=(items:typeof boxes):Tree=>{
    const lo=[0,1,2].map(i=>Math.min(...items.map(p=>p.lo[i]))),hi=[0,1,2].map(i=>Math.max(...items.map(p=>p.hi[i])));
    if(items.length<=12)return {lo,hi,triangles:items.map(p=>p.id)};
    const axis=[0,1,2].sort((i,j)=>(hi[j]-lo[j])-(hi[i]-lo[i]))[0];items.sort((a,b)=>(a.lo[axis]+a.hi[axis])-(b.lo[axis]+b.hi[axis]));
    const mid=Math.floor(items.length/2);return {lo,hi,left:build(items.slice(0,mid)),right:build(items.slice(mid))};
  };
  tree=build(boxes);trees.set(a,tree);return tree;
}
function candidates(tree:Tree,o:number[],d:number[],max:number,out:number[]){
  let low=0,high=max;
  for(let i=0;i<3;i++){
    if(Math.abs(d[i])<1e-12){if(o[i]<tree.lo[i]||o[i]>tree.hi[i])return;continue;}
    const a=(tree.lo[i]-o[i])/d[i],b=(tree.hi[i]-o[i])/d[i];low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));if(low>high)return;
  }
  if(tree.triangles)out.push(...tree.triangles);else{candidates(tree.left!,o,d,max,out);candidates(tree.right!,o,d,max,out);}
}
export const transformRockPoint = (s: RockPlacement, p: number[]): Vec3 => {
  const c = Math.cos(s.rotation ?? 0), n = Math.sin(s.rotation ?? 0), k = s.scale ?? 1;
  return { x: s.x + (p[0]*c-p[2]*n)*k, y: 2.4+p[1]*k, z: s.z+(p[0]*n+p[2]*c)*k };
};
export function transformRockNormal(s: RockPlacement, p: number[]): Vec3 {
  const c = Math.cos(s.rotation ?? 0), n = Math.sin(s.rotation ?? 0);
  return {x:p[0]*c-p[2]*n,y:p[1],z:p[0]*n+p[2]*c};
}
/** Small exported query meshes keep surface tests independent of Three/WebGL. */
export function rayRock(s: RockPlacement, origin: Vec3, direction: Vec3, maxDistance = Infinity): (Vec3 & {distance:number; normal:Vec3}) | null {
  const asset = s.query??(s.assetId && ASTEROIDS[s.assetId]); if (!asset) return null;
  if (!asset.indices.length) return null;
  const k=s.scale??1, c=Math.cos(s.rotation??0), n=Math.sin(s.rotation??0), ox=origin.x-s.x, oz=origin.z-s.z;
  const o=[(ox*c+oz*n)/k,(origin.y-2.4)/k,(-ox*n+oz*c)/k];
  const d=[(direction.x*c+direction.z*n)/k,direction.y/k,(-direction.x*n+direction.z*c)/k];
  let distance=maxDistance, normal:Vec3|null=null;
  const selected:number[]=[];candidates(treeFor(asset),o,d,maxDistance,selected);
  for(const i of selected){
    const a=asset.vertices[asset.indices[i]],b=asset.vertices[asset.indices[i+1]],v=asset.vertices[asset.indices[i+2]];
    const e=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], f=[v[0]-a[0],v[1]-a[1],v[2]-a[2]];
    const h=[d[1]*f[2]-d[2]*f[1],d[2]*f[0]-d[0]*f[2],d[0]*f[1]-d[1]*f[0]];
    const det=e[0]*h[0]+e[1]*h[1]+e[2]*h[2]; if(Math.abs(det)<1e-9)continue;
    const q=[o[0]-a[0],o[1]-a[1],o[2]-a[2]], u=(q[0]*h[0]+q[1]*h[1]+q[2]*h[2])/det;
    if(u<0||u>1)continue;
    const r=[q[1]*e[2]-q[2]*e[1],q[2]*e[0]-q[0]*e[2],q[0]*e[1]-q[1]*e[0]];
    const w=(d[0]*r[0]+d[1]*r[1]+d[2]*r[2])/det; if(w<0||u+w>1)continue;
    const t=(f[0]*r[0]+f[1]*r[1]+f[2]*r[2])/det; if(t<0||t>=distance)continue;
    distance=t; const nx=e[1]*f[2]-e[2]*f[1],ny=e[2]*f[0]-e[0]*f[2],nz=e[0]*f[1]-e[1]*f[0],len=Math.hypot(nx,ny,nz);
    normal=transformRockNormal(s,[nx/len,ny/len,nz/len]);
  }
  return normal ? {x:origin.x+direction.x*distance,y:origin.y+direction.y*distance,z:origin.z+direction.z*distance,distance,normal}:null;
}
