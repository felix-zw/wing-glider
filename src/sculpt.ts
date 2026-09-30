import {edgeTable as rawEdges,triTable as rawTriangles} from 'three/addons/objects/MarchingCubes.js';
import {validRockGlow,type RockGlow} from './lighting';

export type SculptTool='add'|'subtract'|'grab'|'smooth'|'flatten'|'paint'|'ore';
export type PaintLayer='coarse'|'smooth'|'weathered'|'color'|'glow';
export interface SculptStroke {tool:SculptTool;center:[number,number,number];radius:number;strength:number;falloff?:number;delta?:[number,number,number];normal?:[number,number,number];layer?:PaintLayer; seconds?:number;erase?:boolean}
export interface SculptVariation {scale:[number,number,number];rotation:[number,number,number];cuts:{normal:[number,number,number];offset:number}[];chips:{center:[number,number,number];radii:[number,number,number]}[]}
export interface SculptDefinition {
  version:2;id:string;name:string;shape:'slab'|'split'|'long'|'block'|'mass'|'round';seed:number;
  strokes:SculptStroke[];material:{scale:number;angularity:number;relief:number;weathering:number};
  glow?:RockGlow;
  variation?:SculptVariation;
}
export interface SculptMesh {positions:number[];normals:number[];indices:number[];paint:number[];glow?:number[]}
export interface SculptCompiled {high:SculptMesh;standard:SculptMesh;vertices:number[][];indices:number[];contours:{x:number;z:number}[][]}
const EXTENT=72;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const edgeTable=rawEdges as unknown as Int32Array,triTable=rawTriangles as unknown as Int32Array;
const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const edgeCorners=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];

export function newSculpt(id:string,shape:SculptDefinition['shape']='round'):SculptDefinition {
  return {version:2,id,name:shape==='round'?'Eigener Asteroid':SCULPT_SHAPES[shape],shape,seed:Math.floor(Math.random()*100000),strokes:[],material:{scale:1,angularity:.65,relief:.7,weathering:.4}};
}
export function validSculpt(value:unknown):value is SculptDefinition {
  const s=value as SculptDefinition;
  return !!s&&s.version===2&&typeof s.id==='string'&&/^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(s.id)&&typeof s.name==='string'&&s.name.length<=100
    &&['slab','split','long','block','mass','round'].includes(s.shape)&&Number.isSafeInteger(s.seed)&&Array.isArray(s.strokes)&&s.strokes.length<=60000
    &&s.strokes.every(p=>p&&['add','subtract','grab','smooth','flatten','paint'].includes(p.tool)&&Array.isArray(p.center)&&p.center.length===3&&p.center.every(v=>Number.isFinite(v)&&Math.abs(v)<=36)&&Number.isFinite(p.radius)&&p.radius>=1&&p.radius<=25&&Number.isFinite(p.strength)&&p.strength>=0&&p.strength<=1&&(p.falloff===undefined||Number.isFinite(p.falloff)&&p.falloff>=0&&p.falloff<=1)&&(!p.delta||p.delta.length===3&&p.delta.every(v=>Number.isFinite(v)&&Math.abs(v)<=15))&&(!p.normal||p.normal.length===3&&p.normal.every(Number.isFinite))&&(p.seconds===undefined||Number.isFinite(p.seconds)&&p.seconds>0&&p.seconds<=.25)&&(p.erase===undefined||typeof p.erase==='boolean')&&(!p.layer||['coarse','smooth','weathered','color','glow'].includes(p.layer)))
    &&(!s.glow||validRockGlow(s.glow))&&(!s.variation||validVariation(s.variation))&&!!s.material&&Object.entries({scale:[.25,4],angularity:[0,1],relief:[0,1],weathering:[0,1]}).every(([k,[a,b]])=>Number.isFinite((s.material as any)[k])&&(s.material as any)[k]>=a&&(s.material as any)[k]<=b);
}
const triple=(p:unknown,a:number,b:number):p is [number,number,number]=>Array.isArray(p)&&p.length===3&&p.every(v=>Number.isFinite(v)&&v>=a&&v<=b);
function validVariation(v:SculptVariation){return !!v&&triple(v.scale,.55,1.1)&&triple(v.rotation,-Math.PI,Math.PI)&&Array.isArray(v.cuts)&&v.cuts.length<=8&&v.cuts.every(c=>c&&triple(c.normal,-1,1)&&Math.abs(Math.hypot(...c.normal)-1)<.02&&Number.isFinite(c.offset)&&c.offset>=10&&c.offset<=34)&&Array.isArray(v.chips)&&v.chips.length<=16&&v.chips.every(c=>c&&triple(c.center,-36,36)&&triple(c.radii,2,14));}

export const SCULPT_SHAPES = {slab:'Bruchplatte',split:'Angeschnittener Körper',block:'Quaderähnlicher Brocken',long:'Länglicher Splitter',mass:'Felsmasse'} as const;
const ellipsoid=(x:number,y:number,z:number,a:number,b:number,c:number)=>(Math.hypot(x/a,y/b,z/c)-1)*Math.min(a,b,c);
function box(x:number,y:number,z:number,a:number,b:number,c:number,r:number){
  const q=[Math.abs(x)-a+r,Math.abs(y)-b+r,Math.abs(z)-c+r];
  return Math.hypot(...q.map(v=>Math.max(0,v)))+Math.min(0,Math.max(...q))-r;
}
/** Broad planes are real volume boundaries; chips are not a repeated cross-cut. */
function shapeDistance(s:SculptDefinition,x:number,y:number,z:number){
  let d:number;
  switch(s.shape){
    case 'slab': d=Math.max(box(x,y,z,29,10,23,3.8),y+x*.12-z*.07-7,-x+z*.32-27);break;
    case 'block':d=Math.max(box(x,y,z,23,21,22,4),x+y*.52+z*.33-32,-x-y*.55+z*.16-29);break;
    case 'split':{
      d=Math.max(ellipsoid(x,y,z,25,24,26),x*.3+y*.72+z*.63-8);
      d=Math.max(d,-box(x-3+(z-8)*.25,y-5,z-8,11,14,12,2.5),-box(x+8,y-9+z*.18,z-3,9,10,8,2));break;
    }
    case 'long':d=Math.max(box(x+y*.27,y,z-x*.18,31,12,13,3),x+z*.7-y*.2-28,-x+y*.7-z*.4-27);break;
    case 'mass': d=Math.min(box(x+11,y+5,z-2,18,17,20,6),box(x-12,y-7,z+6,17,18,17,4));
      d=Math.max(d,-ellipsoid(x+2,y+7,z-19,9,9,13),x*.5+y*.8+z*.3-29);break;
    default:d=ellipsoid(x,y,z,23,21,22);
  }
  const seed=s.seed*.00013;
  // Low-frequency, coherent broken beds keep planar character and asymmetric edges.
  const warp=.48*Math.sin(x*.23+z*.11+seed)*Math.cos(y*.17-z*.08)+.28*Math.sin(z*.39-y*.22+seed*13);
  const chip=ellipsoid(x-19,y+11,z-12,7,6,8);
  return Math.max(d+warp,-chip);
}
/** Generated variants retain broad planes; irregular chips are separate, seeded features. */
export function baseDistance(s:SculptDefinition,x:number,y:number,z:number){
  const v=s.variation;if(!v)return shapeDistance(s,x,y,z);
  const original=[x,y,z],p=[x,y,z];
  for(let axis=2;axis>=0;axis--){const a=(axis+1)%3,b=(axis+2)%3,c=Math.cos(v.rotation[axis]),n=Math.sin(v.rotation[axis]),u=p[a];p[a]=u*c+p[b]*n;p[b]=-u*n+p[b]*c;}
  let d=shapeDistance(s,p[0]/v.scale[0],p[1]/v.scale[1],p[2]/v.scale[2])*Math.min(...v.scale);
  for(const cut of v.cuts)d=Math.max(d,original.reduce((sum,p,i)=>sum+p*cut.normal[i],0)-cut.offset);
  for(const chip of v.chips)d=Math.max(d,-ellipsoid(x-chip.center[0],y-chip.center[1],z-chip.center[2],...chip.radii));
  return d;
}
interface Grid {n:number;step:number;field:Float32Array;paint:Float32Array;glow:Float32Array}
const idx=(n:number,x:number,y:number,z:number)=>x+n*(y+n*z);
function gridFor(s:SculptDefinition,n:number):Grid {
  const step=EXTENT/(n-1),field=new Float32Array(n*n*n);
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)field[idx(n,x,y,z)]=baseDistance(s,x*step-36,y*step-36,z*step-36);
  const paint=new Float32Array(n*n*n*4);for(let i=0;i<field.length;i++){paint[i*4]=.65;}
  const grid={n,step,field,paint,glow:new Float32Array(field.length)};
  if(s.shape==='split')for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const px=x*step-36,py=y*step-36,pz=z*step-36;
    const cut=Math.abs(px*.3+py*.72+pz*.63-8),cavity=Math.min(Math.abs(box(px-3+(pz-8)*.25,py-5,pz-8,11,14,12,2.5)),Math.abs(box(px+8,py-9+pz*.18,pz-3,9,10,8,2)));
    if(cut<3||cavity<2){const i=idx(n,x,y,z)*4;paint[i]=.25;paint[i+1]=.65;}
  }
  for(const stroke of s.strokes)applyStroke(grid,stroke);
  return grid;
}
function sample(grid:Grid,p:[number,number,number],source=grid.field){
  const {n,step}=grid,a=p.map(v=>clamp((v+36)/step,0,n-1.001)),x=Math.floor(a[0]),y=Math.floor(a[1]),z=Math.floor(a[2]);
  const tx=a[0]-x,ty=a[1]-y,tz=a[2]-z,m=(i:number,j:number,k:number)=>source[idx(n,i,j,k)];
  const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
  return lerp(lerp(lerp(m(x,y,z),m(x+1,y,z),tx),lerp(m(x,y+1,z),m(x+1,y+1,z),tx),ty),lerp(lerp(m(x,y,z+1),m(x+1,y,z+1),tx),lerp(m(x,y+1,z+1),m(x+1,y+1,z+1),tx),ty),tz);
}
function applyStroke(grid:Grid,p:SculptStroke){
  const {n,step,field}=grid,old=(p.tool==='grab'||p.tool==='smooth')?field.slice():field;
  const reach=p.radius+(p.tool==='grab'?Math.hypot(...(p.delta??[0,0,0])):0);
  const min=p.center.map(v=>clamp(Math.floor((v-reach+36)/step),1,n-2)),max=p.center.map(v=>clamp(Math.ceil((v+reach+36)/step),1,n-2));
  for(let z=min[2];z<=max[2];z++)for(let y=min[1];y<=max[1];y++)for(let x=min[0];x<=max[0];x++){
    const world:[number,number,number]=[x*step-36,y*step-36,z*step-36];
    const d=Math.hypot(world[0]-p.center[0],world[1]-p.center[1],world[2]-p.center[2]);if(d>reach)continue;
    const edge=clamp((1-d/p.radius)/Math.max(.05,p.falloff??.5),0,1),fade=edge*edge*(3-2*edge)*p.strength,i=idx(n,x,y,z),before=old[i],dt=p.seconds??.05;
    if(p.tool==='paint'&&p.layer==='glow'){
      grid.glow[i]+=((p.erase?0:1)-grid.glow[i])*Math.min(1,fade*dt*5);
    }else if(p.tool==='paint'){
      const channel=({coarse:0,smooth:1,weathered:2,color:3} as const)[p.layer as Exclude<PaintLayer,'glow'>??'coarse'];
      for(let k=0;k<4;k++)grid.paint[i*4+k]+=((k===channel?1:0)-grid.paint[i*4+k])*Math.min(1,fade*dt*5);
    }else if(p.tool==='add'||p.tool==='subtract'){
      field[i]=clamp(before+(p.tool==='add'?-1:1)*fade*dt*14,-72,72);
    }else if(p.tool==='grab'){
      const delta=p.delta??[0,0,0];field[i]=sample(grid,[world[0]-delta[0]*fade,world[1]-delta[1]*fade,world[2]-delta[2]*fade],old);
    }else if(p.tool==='smooth'){
      const average=(old[idx(n,x-1,y,z)]+old[idx(n,x+1,y,z)]+old[idx(n,x,y-1,z)]+old[idx(n,x,y+1,z)]+old[idx(n,x,y,z-1)]+old[idx(n,x,y,z+1)])/6;
      field[i]=before+(average-before)*Math.min(1,fade*dt*18);
    }else if(p.tool==='flatten'){
      const normal=p.normal??[0,1,0],plane=(world[0]-p.center[0])*normal[0]+(world[1]-p.center[1])*normal[1]+(world[2]-p.center[2])*normal[2];
      field[i]=before+(plane-before)*Math.min(1,fade*dt*14);
    }
  }
}
function paintAt(grid:Grid,p:number[]){
  const {n,step}=grid;const a=p.map(v=>clamp(Math.round((v+36)/step),0,n-1)),i=idx(n,a[0],a[1],a[2])*4;
  return Array.from(grid.paint.subarray(i,i+4));
}
function mesh(grid:Grid,s:SculptDefinition,min:[number,number,number],max:[number,number,number]):SculptMesh {
  const {n,step,field}=grid,positions:number[]=[],normals:number[]=[],indices:number[]=[],paint:number[]=[],glow:number[]=[],edgeCache=new Map<string,number>();
  for(let z=min[2];z<max[2];z++)for(let y=min[1];y<max[1];y++)for(let x=min[0];x<max[0];x++){
    const nodes=corners.map(([a,b,c])=>idx(n,x+a,y+b,z+c)),values=nodes.map(i=>field[i]);
    let code=0;for(let k=0;k<8;k++)if(values[k]<0)code|=1<<k;
    const bits=edgeTable[code];if(!bits)continue;
    const edgeVertex:number[]=[];
    for(let e=0;e<12;e++)if(bits&(1<<e)){
      const [a,b]=edgeCorners[e],key=nodes[a]<nodes[b]?nodes[a]+':'+nodes[b]:nodes[b]+':'+nodes[a];let vertex=edgeCache.get(key);
      if(vertex===undefined){const t=clamp(values[a]/(values[a]-values[b]),0,1),point=corners[a].map((v,k)=>([x,y,z][k]+v+(corners[b][k]-v)*t)*step-36);
        const h=step*.4,gradient=[0,1,2].map(axis=>{const a=point.slice() as [number,number,number],b=point.slice() as [number,number,number];a[axis]+=h;b[axis]-=h;return sample(grid,a)-sample(grid,b);});
        const length=Math.hypot(...gradient)||1;
        vertex=positions.length/3;positions.push(...point);normals.push(...gradient.map(v=>v/length));paint.push(...paintAt(grid,point));glow.push(sample(grid,point as [number,number,number],grid.glow));edgeCache.set(key,vertex);}
      edgeVertex[e]=vertex;
    }
    for(let t=code*16;triTable[t]!==-1;t+=3)indices.push(edgeVertex[triTable[t]],edgeVertex[triTable[t+2]],edgeVertex[triTable[t+1]]);
  }
  return {positions,normals,indices,paint,glow};
}
function contoursFrom(grid:Grid,scale=1){
  const {n,step,field}=grid,inside=(x:number,z:number)=>{
    for(const h of [-1.8,-.9,0,.9,1.8,2.7,3.6])if(sample(grid,[x*step-36,h/scale,z*step-36],field)<0)return true;
    return false;
  };
  const occupied=new Uint8Array((n-1)*(n-1)),index=(x:number,z:number)=>x+(n-1)*z;
  for(let z=0;z<n-1;z++)for(let x=0;x<n-1;x++)occupied[index(x,z)]=inside(x+.5,z+.5)?1:0;
  const borders=new Map<string,string[]>(),vertex=(x:number,z:number)=>x+','+z,add=(a:string,b:string)=>{const list=borders.get(a)??[];list.push(b);borders.set(a,list);};
  for(let z=0;z<n-1;z++)for(let x=0;x<n-1;x++)if(occupied[index(x,z)]){
    if(z===0||!occupied[index(x,z-1)])add(vertex(x,z),vertex(x+1,z));
    if(x===n-2||!occupied[index(x+1,z)])add(vertex(x+1,z),vertex(x+1,z+1));
    if(z===n-2||!occupied[index(x,z+1)])add(vertex(x+1,z+1),vertex(x,z+1));
    if(x===0||!occupied[index(x-1,z)])add(vertex(x,z+1),vertex(x,z));
  }
  const loops:{x:number;z:number}[][]=[];
  while(borders.size){const first=borders.keys().next().value as string,points:string[]=[first];let current=first;
    for(let guard=0;guard<n*n*4;guard++){
      const choices=borders.get(current);if(!choices?.length)break;const next=choices.pop()!;if(!choices.length)borders.delete(current);
      if(next===first)break;points.push(next);current=next;
    }
    if(points.length>=4)loops.push(points.map(p=>{const [x,z]=p.split(',').map(Number);return {x:x*step-36,z:z*step-36};}));
  }
  return loops;
}
function merge(chunks:Map<string,SculptMesh>):SculptMesh {
  const result:SculptMesh={positions:[],normals:[],indices:[],paint:[],glow:[]};
  for(const chunk of chunks.values()){
    const offset=result.positions.length/3;result.positions.push(...chunk.positions);result.normals.push(...chunk.normals);
    result.paint.push(...chunk.paint);result.glow!.push(...(chunk.glow??new Array(chunk.positions.length/3).fill(0)));for(const index of chunk.indices)result.indices.push(index+offset);
  }
  return result;
}
/** The worker retains density samples and triangulates only cells touched by a stroke. */
export class SculptBuilder {
  private high:Grid;private standard:Grid;private chunks=[new Map<string,SculptMesh>(),new Map<string,SculptMesh>()];
  private source:SculptDefinition;
  constructor(source:SculptDefinition){this.source=structuredClone(source);this.high=gridFor(source,49);this.standard=gridFor(source,31);
    this.rebuild(this.high,this.chunks[0],source);this.rebuild(this.standard,this.chunks[1],source);
  }
  private rebuild(grid:Grid,chunks:Map<string,SculptMesh>,source:SculptDefinition,dirty?:SculptStroke[]){
    const changed:Record<string,SculptMesh>={};const count=Math.ceil((grid.n-1)/12);
    for(let z=0;z<count;z++)for(let y=0;y<count;y++)for(let x=0;x<count;x++){
      const min:[number,number,number]=[x*12,y*12,z*12],max:[number,number,number]=min.map(v=>Math.min(v+12,grid.n-1)) as [number,number,number];
      if(dirty&&!dirty.some(stroke=>{
        const reach=stroke.radius+(stroke.tool==='grab'?Math.hypot(...(stroke.delta??[0,0,0])):0)+grid.step*2;
        return [0,1,2].every(axis=>stroke.center[axis]+reach>=min[axis]*grid.step-36&&stroke.center[axis]-reach<=max[axis]*grid.step-36);
      }))continue;
      const key=`${x},${y},${z}`,chunk=mesh(grid,source,min,max);chunks.set(key,chunk);changed[key]=chunk;
    }
    return changed;
  }
  preview(){return Object.fromEntries(this.chunks[0]);}
  append(strokes:SculptStroke[]){
    for(const stroke of strokes)applyStroke(this.high,stroke);
    this.source.strokes.push(...structuredClone(strokes));
    return this.rebuild(this.high,this.chunks[0],this.source,strokes);
  }
  update(next:SculptDefinition){
    const previous=this.source.strokes;
    if(next.id!==this.source.id||next.shape!==this.source.shape||next.seed!==this.source.seed||JSON.stringify(next.variation)!==JSON.stringify(this.source.variation)||next.strokes.length<previous.length||JSON.stringify(next.strokes.slice(0,previous.length))!==JSON.stringify(previous)){
      this.source=structuredClone(next);this.high=gridFor(next,49);this.standard=gridFor(next,31);this.chunks=[new Map(),new Map()];
      this.rebuild(this.high,this.chunks[0],next);this.rebuild(this.standard,this.chunks[1],next);return this.compile();
    }
    const added=next.strokes.slice(previous.length);
    for(const stroke of added){applyStroke(this.high,stroke);applyStroke(this.standard,stroke);}
    this.source=structuredClone(next);
    if(added.length){this.rebuild(this.high,this.chunks[0],next,added);this.rebuild(this.standard,this.chunks[1],next,added);}
    return this.compile();
  }
  finish(scale=1):SculptCompiled {
    this.standard=gridFor(this.source,31);this.rebuild(this.standard,this.chunks[1],this.source);return this.compile(scale);
  }
  compile(scale=1):SculptCompiled {
    const bounded=(initial:SculptMesh,grid:Grid,limit:number)=>{
      let result=initial,n=grid.n;
      while(result.indices.length/3>limit&&n>9){n-=2;grid=gridFor(this.source,n);result=mesh(grid,this.source,[0,0,0],[n-1,n-1,n-1]);}
      return {result,grid};
    };
    const detailed=bounded(merge(this.chunks[0]),this.high,40000),high=detailed.result,standard=bounded(merge(this.chunks[1]),this.standard,12000).result,vertices:number[][]=[];
    for(let i=0;i<high.positions.length;i+=3)vertices.push(high.positions.slice(i,i+3));
    return {high,standard,vertices,indices:high.indices,contours:contoursFrom(detailed.grid,scale)};
  }
}
export const compileSculpt=(source:SculptDefinition,scale=1)=>new SculptBuilder(source).compile(scale);
/** Immediate placement silhouette; authoritative meshes are built off-thread. */
export function previewSculpt(source:SculptDefinition):SculptMesh {const grid=gridFor(source,13);return mesh(grid,source,[0,0,0],[12,12,12]);}
