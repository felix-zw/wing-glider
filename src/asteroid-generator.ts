import {baseDistance,SCULPT_SHAPES,type SculptDefinition,type SculptCompiled,type SculptMesh} from './sculpt';
import {newRockGlow} from './lighting';
import {oreMass,type OreLayer,type Triple} from './ore-paint';
import type {ResourceId} from './resources';

export type GeneratorAction='form'|'ore'|'glow'|'core'|'all';
export interface GeneratorOptions {shape:'random'|keyof typeof SCULPT_SHAPES;roughness:number;density:number;resource:'all'|ResourceId;profile:'random'|'warm'|'cold'}
export const DEFAULT_GENERATOR:GeneratorOptions={shape:'random',roughness:.65,density:.55,resource:'all',profile:'random'};
export interface GeneratedOre {resource:ResourceId;paint:OreLayer;amount:number}
export interface GenerationRequest {epoch:number;source:SculptDefinition;scale:number;seed:number;action:GeneratorAction;options:GeneratorOptions;compiled?:SculptCompiled}
export interface GenerationResult {epoch:number;source:SculptDefinition;compiled?:SculptCompiled;ores?:GeneratedOre[];error?:string}

/** Separate seeded streams keep ore, surface glow and the core reproducible independently. */
function random(seed:number){let a=seed>>>0;return ()=>{a+=0x6d2b79f5;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const unit=(r:()=>number):Triple=>{const y=r()*2-1,a=r()*Math.PI*2,l=Math.sqrt(1-y*y);return [Math.cos(a)*l,y,Math.sin(a)*l];};
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
const dot=(a:number[],b:number[])=>a.reduce((v,n,i)=>v+n*b[i],0);
const rounded=(value:number,step:number)=>Number((Math.round(value/step)*step).toFixed(2));

export function generateForm(source:SculptDefinition,seed:number,options:GeneratorOptions):SculptDefinition {
  const s=structuredClone(source),r=random(seed),shapes=Object.keys(SCULPT_SHAPES) as (keyof typeof SCULPT_SHAPES)[];
  s.seed=seed;s.shape=options.shape==='random'?shapes[Math.floor(r()*shapes.length)]:options.shape;
  // Shape regeneration preserves authored materials and both painting channels.
  s.strokes=s.strokes.filter(p=>p.tool==='paint');
  s.variation={scale:[.65+r()*.2,.65+r()*.2,.65+r()*.2],rotation:[(r()-.5)*.7,(r()-.5)*Math.PI*2,(r()-.5)*.7],cuts:[],chips:[]};
  for(let i=0;i<1+Math.floor(options.roughness*4);i++)s.variation.cuts.push({normal:unit(r),offset:17+r()*13});
  for(let i=0;i<3+Math.floor(options.roughness*10);i++){
    const n=unit(r);let outer=42,inner=outer;
    while(inner>2&&baseDistance(s,...n.map(v=>v*inner) as Triple)>0)inner-=1;
    if(inner<=2)continue;
    for(let j=0;j<8;j++){const mid=(inner+outer)/2;if(baseDistance(s,...n.map(v=>v*mid) as Triple)<0)inner=mid;else outer=mid;}
    const radius=3+r()*5+options.roughness*3;
    s.variation.chips.push({center:n.map(v=>Math.max(-35,Math.min(35,v*(outer+radius*.35)))) as Triple,radii:[radius*(.7+r()*.4),radius*(.7+r()*.4),radius*(.7+r()*.4)]});
  }
  return s;
}

interface Sample {position:Triple;normal:Triple;area:number}
function surfaceSamples(mesh:SculptMesh):Sample[]{
  const samples:Sample[]=[];
  for(let i=0;i<mesh.indices.length;i+=3){
    const ids=mesh.indices.slice(i,i+3),[a,b,c]=ids.map(j=>mesh.positions.slice(j*3,j*3+3)),u=b.map((v,j)=>v-a[j]),v=c.map((p,j)=>p-a[j]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n);if(length<.01)continue;
    if(dot(n,mesh.normals.slice(ids[0]*3,ids[0]*3+3))<0)for(let j=0;j<3;j++)n[j]*=-1;
    samples.push({position:a.map((p,j)=>(p+b[j]+c[j])/3) as Triple,normal:n.map(p=>p/length) as Triple,area:length/2});
  }
  return samples;
}
function choose(samples:Sample[],r:()=>number){const total=samples.reduce((n,p)=>n+p.area,0);let a=r()*total;for(const s of samples){a-=s.area;if(a<=0)return s;}return samples.at(-1)!;}

export function generateOres(compiled:SculptCompiled,scale:number,seed:number,options:GeneratorOptions):GeneratedOre[]{
  const r=random(seed^0x2b910f6a),all=surfaceSamples(compiled.high);
  // The game flies in a plane: bias veins towards lateral surfaces within laser reach.
  const candidates=all.filter(s=>Math.abs(s.position[1]*scale)<4.5&&Math.abs(s.normal[1])<.7);
  if(!candidates.length)throw Error('Keine geeignete Erzfläche in der Flughöhe. Form anpassen oder einen anderen Asteroiden wählen.');
  const resources=options.resource==='all'?['ferrite','copper','crystal'] as const:[options.resource];
  const ores:GeneratedOre[]=[],used:Triple[]=[],anchors:Triple[]=[];
  for(const resource of resources)for(let vein=0;vein<1+Math.floor(options.density*2.9);vein++){
    let anchor:Sample|undefined;for(let attempt=0;attempt<80;attempt++){const p=choose(candidates,r);if(anchors.every(a=>distance(a,p.position)>8)){anchor=p;break;}}
    if(!anchor)continue;
    const radius=4+options.density*4+r()*2,paint:OreLayer={version:1,cells:[]};
    const near=candidates.filter(s=>distance(s.position,anchor!.position)<radius&&dot(s.normal,anchor!.normal)>.55).sort((a,b)=>distance(a.position,anchor!.position)-distance(b.position,anchor!.position));
    for(const s of near){const fade=1-distance(s.position,anchor.position)/radius;if(r()>.4+fade*.6||used.some(p=>distance(p,s.position)<1.45))continue;
      const thickness=(.3+options.density*.9+r()*.45)*(.35+.65*fade);
      paint.cells.push({position:[...s.position],normal:[...s.normal],radius:.85,thickness});used.push(s.position);if(paint.cells.length>=96)break;
    }
    if(paint.cells.length){anchors.push(anchor.position);ores.push({resource,paint,amount:oreMass(paint,scale)});}
  }
  if(!ores.length)throw Error('Auf dieser Form konnte keine Erzschicht erzeugt werden.');
  return ores;
}

function glowColor(seed:number,profile:GeneratorOptions['profile']){const r=random(seed^0x624a3917),warm=profile==='warm'||profile==='random'&&r()>.5;return warm?['#ff8b36','#ff5933','#ffc45e'][Math.floor(r()*3)]:['#58d7ff','#5ef5bd','#a394ff'][Math.floor(r()*3)];}
export function generateSurfaceGlow(source:SculptDefinition,compiled:SculptCompiled,seed:number,options:GeneratorOptions){
  const s=structuredClone(source),r=random(seed^0x916ead12),samples=surfaceSamples(compiled.high);s.glow??=newRockGlow();
  s.glow.color=glowColor(seed,options.profile);s.glow.intensity=rounded(1.5+r()*2,.1);s.glow.cracks=rounded(.75+r()*.2,.05);
  s.strokes=s.strokes.filter(p=>!(p.tool==='paint'&&p.layer==='glow'));
  if(samples.length)for(let i=0;i<4;i++){const p=choose(samples,r);s.strokes.push({tool:'paint',layer:'glow',center:[...p.position],radius:8+r()*9,strength:.85,falloff:.7,seconds:.25});}
  return s;
}
export function generateCore(source:SculptDefinition,compiled:SculptCompiled,seed:number,options:GeneratorOptions){
  const s=structuredClone(source),r=random(seed^0x318ba071),samples=surfaceSamples(compiled.high);s.glow??=newRockGlow();
  // Prefer exposed interior faces, making an open core readable without making rock transparent.
  const inner=[...samples].sort((a,b)=>Math.hypot(...a.position)-Math.hypot(...b.position)).slice(0,Math.max(1,Math.floor(samples.length*.12)));
  const anchor=inner.length?choose(inner,r):null;
  s.glow.core={enabled:true,color:glowColor(seed,options.profile),intensity:rounded(2+r()*3,.1),center:anchor?anchor.position.map((v,i)=>rounded(Math.max(-30,Math.min(30,v-anchor.normal[i]*6)),.5)) as Triple:[0,0,0],radii:[rounded(12+r()*9,.5),rounded(12+r()*9,.5),rounded(12+r()*9,.5)],softness:rounded(.18+r()*.22,.05)};
  return s;
}
