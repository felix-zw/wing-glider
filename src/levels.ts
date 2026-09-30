import {themeLighting,type LightingDefinition} from './lighting';
import type {AsteroidAsset} from './asset-catalog';
import { type MissionDefinition } from './missions';
import { DOCUMENTS, validateDocument, type LevelDocument } from './level-document';
import { THEMES, type ThemeDefinition } from './themes';
import {resolveOreCell} from './ore-paint';
import {registerSculpt,retainSculpts} from './sculpt-runtime';
import { bedrockUplift } from './geology';
import type { Deposit, Position, ResourceId } from './resources';

export type LevelId = string;
export interface Shelter extends Position { name: string; radius: number }
/** Local X/Z contours may include disjoint rocks and interior openings. */
interface RockFootprint { query?:AsteroidAsset;footprint?: readonly Position[]; footprints?:readonly (readonly Position[])[]; assetId?: string; rotation?: number; scale?: number; facing?: number }
export type Structure =
  | (Position & { id: string; kind: 'hill'; radius: number; height: number })
  | (Position & RockFootprint & { id: string; kind: 'cliff'; halfX: number; halfZ: number; height: number })
  | (Position & RockFootprint & { id: string; kind: 'asteroid'; radius: number; height: number });
export type Solid = Exclude<Structure, { kind: 'hill' }>;
export interface LevelDefinition { id: LevelId; name: string; subtitle: string; description: string; environment: 'planet' | 'space'; seed: number; mission: MissionDefinition }
export interface LevelWorld { lighting:LightingDefinition; definition: LevelDefinition; spawn: Position; structures: readonly Structure[]; solids: readonly Solid[]; shelters: readonly Shelter[]; deposits: readonly Deposit[]; base: Position & {radius:number;maxUnloadSpeed:number;name:string}; theme: ThemeDefinition; bounds: number; revision: number }
export const LEVELS: Record<LevelId, LevelDefinition> = {};
export function seededRandom(initial: number) { let seed = initial; return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const footprintCache = new WeakMap<Solid, readonly Position[]>();
const footprintsCache = new WeakMap<Solid,readonly (readonly Position[])[]>();
export function getSolidFootprints(solid:Solid):readonly (readonly Position[])[] {
  let loops=footprintsCache.get(solid);if(loops)return loops;
  if(solid.kind==='asteroid'&&!solid.footprint&&!solid.footprints)return [];
  const local=solid.footprints??(solid.footprint?[solid.footprint]:solid.kind==='cliff'?[[
    {x:-solid.halfX,z:-solid.halfZ},{x:solid.halfX,z:-solid.halfZ},{x:solid.halfX,z:solid.halfZ},{x:-solid.halfX,z:solid.halfZ},
  ]]:[]);
  const c=Math.cos(solid.rotation??0),n=Math.sin(solid.rotation??0),k=solid.scale??1;
  loops=Object.freeze(local.map(loop=>Object.freeze(loop.map(p=>Object.freeze({x:solid.x+(p.x*c-p.z*n)*k,z:solid.z+(p.x*n+p.z*c)*k})))));
  footprintsCache.set(solid,loops);return loops;
}
/** Exact static rock boundary shared by rendering, navigation, ore placement and collision.
 * A null boundary denotes the circular dynamic/shield colliders used by the simulation.
 */
export function getSolidFootprint(solid: Solid): readonly Position[] | null {
  if(solid.footprints)return getSolidFootprints(solid)[0]??null;
  if (solid.kind === 'asteroid' && !solid.footprint) return null;
  let points = footprintCache.get(solid);
  if (!points) {
    const local = solid.footprint ?? (solid.kind === 'cliff' ? [
      { x: -solid.halfX, z: -solid.halfZ }, { x: solid.halfX, z: -solid.halfZ },
      { x: solid.halfX, z: solid.halfZ }, { x: -solid.halfX, z: solid.halfZ },
    ] : []);
    const c=Math.cos(solid.rotation??0), n=Math.sin(solid.rotation??0), k=solid.scale??1;
    points = Object.freeze(local.map(p => Object.freeze({ x: solid.x+(p.x*c-p.z*n)*k, z: solid.z+(p.x*n+p.z*c)*k })));
    footprintCache.set(solid, points);
  }
  return points;
}

function cliffFootprint(halfX: number, halfZ: number, index: number): Position[] {
  // Chamfered strata, with different broken ends for each ridge. Interior canyon
  // faces remain long enough to carry a coherent nine-metre ore seam.
  const shape = [ [-0.72, -1], [0.43, -0.97], [1, -0.68], [1, 0.60], [0.63, 1], [-0.47, 0.94], [-1, 0.57], [-1, -0.61] ];
  return shape.map(([x, z]) => ({ x: x * halfX, z: z * halfZ * (1 - (index % 3) * 0.025) }));
}
/** Intersect a direction from the host centre with its actual polygon edge. */
export function sampleRockSurface(solid: Solid, angle: number): Position & { nx: number; nz: number; availableWidth: number } {
  const points = getSolidFootprint(solid), dx = Math.cos(angle), dz = Math.sin(angle);
  if (!points) return { x: solid.x + dx * (solid.kind === 'asteroid' ? solid.radius : 0), z: solid.z + dz * (solid.kind === 'asteroid' ? solid.radius : 0), nx: dx, nz: dz, availableWidth: 0 };
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], ex = b.x - a.x, ez = b.z - a.z;
    const denom = dx * ez - dz * ex;
    if (Math.abs(denom) < 1e-8) continue;
    const ax = a.x - solid.x, az = a.z - solid.z;
    const t = (ax * ez - az * ex) / denom, u = (ax * dz - az * dx) / denom;
    if (t < 0 || u < 0 || u > 1) continue;
    // Centre the seam on this facet, avoiding a tangent strip extending through
    // a neighbouring facet at a sharp corner.
    const length = Math.hypot(ex, ez);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, nx: ez / length, nz: -ex / length, availableWidth: length * 0.82 };
  }
  throw new Error(`Invalid convex rock footprint: ${solid.id}`);
}
const cache = new Map<LevelId, LevelWorld>();
let revision=0;
export function compileLevel(document: LevelDocument): LevelWorld {
  const errors=validateDocument(document).filter(i=>i.severity==='error');
  if(errors.length)throw new Error(errors[0].message);
  const d=structuredClone(document);
  const structures:Structure[]=d.objects.map(o=>{
    if(o.assetId==='sculpt-asteroid'){
      const sculpt=d.sculpts![String(o.parameters.sculptId)],asset=registerSculpt(d.id,o.id,sculpt,o.scale);
      return {kind:'asteroid',id:o.id,x:o.x,z:o.z,assetId:asset.id,query:asset,rotation:o.rotation,scale:o.scale,
        radius:Math.max(0,...asset.footprints!.flat().map(p=>Math.hypot(p.x,p.z)))*o.scale,height:72*o.scale,footprint:asset.footprint,footprints:asset.footprints};
    }
    const p=o.parameters;
    if(o.assetId==='hill')return {kind:'hill',id:o.id,x:o.x,z:o.z,radius:Number(p.radius)*o.scale,height:Number(p.height)*o.scale};
    const halfX=Number(p.halfX),halfZ=Number(p.halfZ);
    return {kind:'cliff',id:o.id,x:o.x,z:o.z,rotation:o.rotation,scale:o.scale,facing:Number(p.facing??(Number(o.id.split('-').at(-1))%2===0?1:-1)),halfX:halfX*o.scale,halfZ:halfZ*o.scale,height:Number(p.height)*o.scale,
      footprint:cliffFootprint(halfX,halfZ,Number(p.variant??0))};
  });
  const definition:LevelDefinition={id:d.id,name:d.name,subtitle:d.subtitle,description:d.description,environment:d.environment,seed:d.seed,
    mission:{id:d.id+'-delivery',title:'Wertvolle Fracht.',objective:{id:'delivery',kind:'all',label:'Rohstoffe an ATLAS liefern',children:(['ferrite','copper','crystal'] as const).filter(r=>d.delivery[r]>0).map(r=>({id:r+'-delivery',kind:'count',label:{ferrite:'Ferrit',copper:'Kupfererz',crystal:'Kristalle'}[r],event:'delivered',resource:r,amount:d.delivery[r]}))}}};
  const world:LevelWorld={lighting:d.lighting??themeLighting(THEMES[d.themeId]),definition,spawn:d.spawn,base:d.base,shelters:d.shelters,structures,solids:structures.filter((s):s is Solid=>s.kind!=='hill'),deposits:[],theme:structuredClone(THEMES[d.themeId]),bounds:d.bounds,revision:++revision};
  world.deposits=d.deposits.map(ore=>{
    const host=world.structures.find(s=>s.id===ore.structureId)!;
    if(ore.paint&&host.kind==='asteroid'){
      const cells=ore.paint.cells.map(cell=>resolveOreCell(host,cell)),p=cells[0],width=Math.max(...cells.map(c=>Math.hypot(c.x-p.x,c.z-p.z)+c.radius))*2;
      return {emission:ore.emission,id:ore.id,resource:ore.resource,structureId:host.id,x:p.x,z:p.z,remaining:ore.amount,initialAmount:ore.amount,progress:0,
        surface:{kind:'asteroid',y:p.y,nx:p.normal.x,nz:p.normal.z,width,cells,invalid:cells.some(c=>!c.valid)}};
    }
    const surface={...ore.surface!},x=ore.x!,z=ore.z!;
    surface.y=groundHeight(world,x,z)+.3;
    return {emission:ore.emission,id:ore.id,resource:ore.resource,structureId:host.id,x,z,remaining:ore.amount,initialAmount:ore.amount,progress:0,surface};
  });
  const freeze=(value:any):any=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  return freeze(world);
}
export function registerLevel(document:LevelDocument):LevelWorld {
  const world=compileLevel(document); DOCUMENTS.set(document.id,structuredClone(document));LEVELS[document.id]=world.definition;cache.set(document.id,world);return world;
}
/** Adopt a worker-built revision without repeating surface or navigation work. */
export function installLevel(document:LevelDocument,world:LevelWorld):LevelWorld {
  retainSculpts(document.id,document.objects.map(o=>o.id));
  if(Object.isFrozen(world)){DOCUMENTS.set(document.id,document);LEVELS[document.id]=world.definition;cache.set(document.id,world);return world;}
  for(const solid of world.solids)if(solid.kind==='asteroid'&&!solid.query)solid.query=registerSculpt(document.id,solid.id,document.sculpts![String(document.objects.find(o=>o.id===solid.id)!.parameters.sculptId)],solid.scale);
  const freeze=(value:any):any=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  world.revision=++revision;freeze(world);DOCUMENTS.set(document.id,document);LEVELS[document.id]=world.definition;cache.set(document.id,world);return world;
}
export function getLevelWorld(id:LevelId='aster'):LevelWorld {
  const found=cache.get(id);if(found)return found;
  const document=DOCUMENTS.get(id);if(!document)throw new Error('Unbekanntes Level: '+id);
  return registerLevel(document);
}
for(const d of DOCUMENTS.values())LEVELS[d.id]={id:d.id,name:d.name,subtitle:d.subtitle,description:d.description,environment:d.environment,seed:d.seed,mission:{id:'loading',title:'Wertvolle Fracht.',objective:{id:'delivery',kind:'all',label:'Liefern',children:[]}}};
function terrainHeight(world: LevelWorld, x: number, z: number, uplift: boolean): number {
  if (world.definition.environment === 'space') return 0;
  const seed = world.definition.seed * 0.001;
  let h = 9 + 6 * Math.sin(x * 0.025 + seed) * Math.cos(z * 0.029) + 3 * Math.sin(x * 0.057 + z * 0.038) + 1.4 * Math.cos(z * 0.11 - x * 0.045);
  let hills = 0;
  for (const hill of world.structures) if (hill.kind === 'hill') {
    const r = Math.hypot(x - hill.x, z - hill.z) / hill.radius;
    if (r < 1) hills += hill.height * (1 - r * r) ** 2;
  }
  // Join existing hills and the bedrock ridges; stacking their heights would
  // create artificial humps and obscure vehicles in the canyon below.
  h += uplift ? Math.max(hills, bedrockUplift(world, x, z)) : hills;
  for (const s of world.shelters) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.radius+18) { const t = Math.min(1, Math.max(0, (d - s.radius) / 18)); h = 1.5 + (h - 1.5) * t * t * (3 - 2 * t); }
  }
  const baseDistance=Math.hypot(x-world.base.x,z-world.base.z);
  if(baseDistance<world.base.radius+8 && !world.shelters.some(s=>Math.hypot(s.x-world.base.x,s.z-world.base.z)<1)){
    const t=Math.min(1,Math.max(0,(baseDistance-world.base.radius)/(8)));h=1.5+(h-1.5)*t*t*(3-2*t);
  }
  return h;
}

export const groundHeight = (world: LevelWorld, x: number, z: number) => terrainHeight(world, x, z, true);
/** Fixed geological datum keeps exposed crags embedded as their slopes rise. */
export const bedrockDatum = (world: LevelWorld, x: number, z: number) => terrainHeight(world, x, z, false);
