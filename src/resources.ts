import type {Emission} from './lighting';
import type {LiveOreCell} from './ore-paint';
import { RESOURCE_CONFIG as R } from './config';
import { getLevelWorld, groundHeight, type LevelWorld } from './levels';
import { clearLine, moveOutside } from './collision';
import { rayRock, type Vec3 } from './rock-surface';

export const RESOURCE_TYPES = ['ferrite', 'copper', 'crystal'] as const;
export type ResourceId = typeof RESOURCE_TYPES[number];
export const RESOURCES = {
  ferrite: { name: 'Ferrit', seconds: 1, color: '#a9b9c4', rock: '#414e59', metalness: 0.85, roughness: 0.3, shape: 'metal' },
  copper: { name: 'Kupfererz', seconds: 1.4, color: '#f3a05c', rock: '#92442c', metalness: 0.65, roughness: 0.38, shape: 'cluster' },
  crystal: { name: 'Kristall', seconds: 1.8, color: '#83f6ee', rock: '#8c68cd', metalness: 0.25, roughness: 0.15, shape: 'spire' },
} as const;
export type Inventory = Record<ResourceId, number>;
export interface Position { x: number; z: number }
export interface Surface { kind: 'ground' | 'wall' | 'asteroid'; y: number; nx: number; nz: number; width: number; samples?: (Vec3 & {normal:Vec3})[]; invalid?:boolean; cells?:LiveOreCell[] }
export interface Deposit extends Position { id: string; resource: ResourceId; remaining: number; initialAmount?: number; progress: number; extracted?:number; structureId?: string; surface?: Surface;emission?:Emission }
export interface Fragment extends Position { id: number; resource: ResourceId; amount?:number; age: number; vx: number; vz: number }
export interface ResourceEvent { kind: 'mined' | 'collected' | 'delivered'; resource: ResourceId; amount: number }
export interface ResourceState {
  deposits: Deposit[]; fragments: Fragment[]; cargo: Inventory; storage: Inventory;
  nextFragmentId: number; targetId: string | null; laserActive: boolean;
  hitPoint: (Position & { y: number }) | null;
  notice: string; noticeTime: number;
}
export interface ResourceActor extends Position { turret: number; speed: number; y?: number }
export const emptyInventory = (): Inventory => ({ ferrite: 0, copper: 0, crystal: 0 });
export const inventoryTotal = (inventory: Inventory) => RESOURCE_TYPES.reduce((sum, id) => sum + inventory[id], 0);
export const baseDistance = (p: Position & {levelId?:string}, world=getLevelWorld(p.levelId)) => Math.hypot(p.x-world.base.x,p.z-world.base.z);

export function createResourceState(world: LevelWorld = getLevelWorld()): ResourceState {
  const deposits = structuredClone([...world.deposits]);
  return { deposits, fragments: [], cargo: emptyInventory(), storage: emptyInventory(), nextFragmentId: 0,
    targetId: null, hitPoint: null, laserActive: false, notice: '', noticeTime: 0 };
}

export function surfacePoint(d: Deposit, offset = 0, world?: LevelWorld, outward = 0): Position & { y: number } {
  if(d.surface?.samples){const samples=d.surface.samples;return samples[Math.max(0,Math.min(samples.length-1,Math.round((offset/d.surface.width+.5)*(samples.length-1))))];}
  const x = d.x - (d.surface?.nz ?? 0) * offset + (d.surface?.nx ?? 0) * outward, z = d.z + (d.surface?.nx ?? 1) * offset + (d.surface?.nz ?? 0) * outward;
  const terrainBound = world && (d.surface?.kind === 'ground' || d.surface?.kind === 'wall');
  return { x, z, y: terrainBound ? groundHeight(world, x, z) + (d.surface?.kind === 'wall' ? .7 : .4) : (d.surface?.y ?? 0) + .4 };
}
const dHasSurface=(d:Deposit)=>d.surface?.kind==='asteroid';
export function findTarget(deposits: readonly Deposit[], actor: ResourceActor, world?: LevelWorld) {
  let result: { deposit: Deposit; point: Position & { y: number };cell?:LiveOreCell } | null = null, bestAngle = Infinity, bestDistance = Infinity;
  for (const deposit of deposits) {
    if (deposit.remaining <= 0) continue;
    const width = deposit.surface?.width ?? 0;
    if (Math.hypot(deposit.x - actor.x, deposit.z - actor.z) > R.laserRange + width / 2 + 4) continue;
    const candidates=deposit.surface?.cells?deposit.surface.cells.filter(c=>c.valid&&c.mass>1e-8).map(cell=>({point:cell,cell})):
      (width?[-.5,-.25,0,.25,.5].map(t=>t*width):[0]).flatMap(offset=>(deposit.surface?.kind==='ground'?[-2,0,2]:[0]).map(outward=>({point:surfacePoint(deposit,offset,world,outward),cell:undefined as LiveOreCell|undefined})));
    for(const {point,cell} of candidates){
    const dx = point.x - actor.x, dz = point.z - actor.z, distance = Math.hypot(dx, dz);
    if (distance > R.laserRange + 1e-8 || cell&&Math.hypot(dx,point.y-(actor.y??3.2),dz)>R.laserRange) continue;
    const angle = distance < 0.001 ? 0 : Math.abs(Math.atan2(Math.sin(Math.atan2(dx, -dz) - actor.turret), Math.cos(Math.atan2(dx, -dz) - actor.turret)));
    if (angle <= R.aimAssist + 1e-8 && (angle < bestAngle - 1e-8 || (Math.abs(angle - bestAngle) <= 1e-8 && distance < bestDistance))) {
      if (world && dHasSurface(deposit)) {
        const origin={x:actor.x,y:actor.y??3.2,z:actor.z}, length=Math.hypot(dx,point.y-origin.y,dz);
        const direction={x:dx/length,y:(point.y-origin.y)/length,z:dz/length};
        if(world.solids.some(s=>s.assetId&&rayRock(s,origin,direction,Math.max(0,length-.4))))continue;
      } else if (world && !clearLine(actor, point, world.solids)) continue;
      if (world && world.definition.environment === 'planet' && actor.y !== undefined) {
        let blocked = false;
        for (let t = 0.1; t < 0.95; t += 0.1) if (groundHeight(world, actor.x + dx * t, actor.z + dz * t) > actor.y + (point.y - actor.y) * t) { blocked = true; break; }
        if (blocked) continue;
      }
      result = { deposit, point,cell }; bestAngle = angle; bestDistance = distance;
    }
    }
  }
  return result;
}
export const selectDeposit = (deposits: readonly Deposit[], actor: ResourceActor, world?: LevelWorld) => findTarget(deposits, actor, world)?.deposit ?? null;

export function advanceResources(s: ResourceState, actor: ResourceActor, mine: boolean, dt: number, emit: (event: ResourceEvent) => void, world?: LevelWorld): void {
  s.noticeTime = Math.max(0, s.noticeTime - dt);
  // Existing fragments move before newly mined ones spawn, preserving their full ejection delay.
  s.fragments = s.fragments.filter(f => {
    const ejectDt = Math.min(dt, Math.max(0, R.ejectSeconds - f.age));
    const ejected = moveOutside(f, { x: f.x + f.vx * ejectDt, z: f.z + f.vz * ejectDt }, world?.solids ?? [], 0.25);
    f.x = ejected.position.x; f.z = ejected.position.z; f.age += dt;
    if (ejected.contact) { f.vx = 0; f.vz = 0; }
    if (f.age < R.ejectSeconds || inventoryTotal(s.cargo) >= R.capacity) return true;
    const dx = actor.x - f.x, dz = actor.z - f.z, distance = Math.hypot(dx, dz);
    if (distance > R.magnetRadius || (world && !clearLine(f, actor, world.solids))) return true;
    const travel = Math.min(distance, R.magnetSpeed * (dt - ejectDt));
    if (distance > 0) { f.x += dx / distance * travel; f.z += dz / distance * travel; }
    if (distance - travel > R.pickupRadius) return true;
    const amount=Math.min(f.amount??1,Math.max(0,R.capacity-inventoryTotal(s.cargo)));if(amount<1e-8)return true;
    s.cargo[f.resource]+=amount;emit({kind:'collected',resource:f.resource,amount});
    f.amount=(f.amount??1)-amount;return f.amount>1e-8;
  });
  const selection = findTarget(s.deposits, actor, world), target = selection?.deposit;
  s.hitPoint = selection?.point ?? null;
  s.targetId = target?.id ?? null; s.laserActive = mine && !!target;
  if (!mine || !target) return;
  if(selection?.cell){
    const cell=selection.cell,take=Math.min(cell.mass,dt/RESOURCES[target.resource].seconds,target.remaining);
    cell.mass=Math.max(0,cell.mass-take);target.remaining=Math.max(0,target.remaining-take);target.extracted=(target.extracted??0)+take;
    if(target.remaining<1e-7)target.remaining=0;
    while(target.extracted>=1-1e-8||target.remaining===0&&target.extracted>1e-8){
      const amount=target.extracted>=1-1e-8?1:target.extracted;target.extracted=Math.max(0,target.extracted-amount);
      const n=cell.normal,id=s.nextFragmentId++,release={x:cell.x+n.x*.7,z:cell.z+n.z*.7};
      const safe=world?moveOutside(release,release,world.solids,.25).position:release;
      s.fragments.push({id,resource:target.resource,amount,x:safe.x,z:safe.z,age:0,vx:n.x*R.ejectSpeed,vz:n.z*R.ejectSpeed});
      emit({kind:'mined',resource:target.resource,amount});
    }
    if(!target.remaining){s.laserActive=false;s.targetId=null;}return;
  }
  target.progress += dt;
  const duration = RESOURCES[target.resource].seconds;
  while (target.progress >= duration - 1e-8 && target.remaining > 0) {
    target.progress = Math.max(0, target.progress - duration); target.remaining--;
    const id = s.nextFragmentId++;
    const surface = target.surface, point = selection!.point;
    const outward = surface && surface.kind !== 'ground';
    const angle = outward ? Math.atan2(surface.nx, surface.nz) + Math.sin(id * 2.4) * 1.2 : id * 2.399963229728653;
    const release={x:point.x+(outward?surface.nx*.65:0),z:point.z+(outward?surface.nz*.65:0)};
    const safe=world?moveOutside(release,release,world.solids,.25).position:release;
    s.fragments.push({ id, resource: target.resource, x: safe.x, z: safe.z, age: 0,
      vx: Math.sin(angle) * R.ejectSpeed, vz: Math.cos(angle) * R.ejectSpeed });
    emit({ kind: 'mined', resource: target.resource, amount: 1 });
  }
  if (target.remaining === 0) { target.progress = 0; s.laserActive = false; s.targetId = null; }
}

export function unloadResources(s: ResourceState, actor: ResourceActor, emit: (event: ResourceEvent) => void, world:LevelWorld=getLevelWorld((actor as ResourceActor & {levelId?:string}).levelId)): void {
  const total = inventoryTotal(s.cargo);
  s.noticeTime = 3;
  if (baseDistance(actor,world) > world.base.radius) { s.notice = 'Zum Entladen in die ATLAS-Ladezone fliegen.'; return; }
  if (Math.abs(actor.speed) > world.base.maxUnloadSpeed) { s.notice = 'Zum Entladen abbremsen · maximal 7 km/h.'; return; }
  if (!total) { s.notice = 'Der Frachtraum ist leer.'; return; }
  for (const resource of RESOURCE_TYPES) {
    const amount = s.cargo[resource];
    if (amount > 0) { s.storage[resource] += amount; s.cargo[resource] = 0; emit({ kind: 'delivered', resource, amount }); }
  }
  s.notice = `${total} Einheiten an ATLAS geliefert.`;
}
