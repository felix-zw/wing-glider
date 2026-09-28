import { RESOURCE_CONFIG as R, TRANSPORTER } from './config';
import { getLevelWorld, groundHeight, type LevelWorld } from './levels';
import { clearLine, moveOutside } from './collision';

export const RESOURCE_TYPES = ['ferrite', 'copper', 'crystal'] as const;
export type ResourceId = typeof RESOURCE_TYPES[number];
export const RESOURCES = {
  ferrite: { name: 'Ferrit', seconds: 1, color: '#a9b9c4', rock: '#414e59', metalness: 0.85, roughness: 0.3, shape: 'metal' },
  copper: { name: 'Kupfererz', seconds: 1.4, color: '#f3a05c', rock: '#92442c', metalness: 0.65, roughness: 0.38, shape: 'cluster' },
  crystal: { name: 'Kristall', seconds: 1.8, color: '#83f6ee', rock: '#8c68cd', metalness: 0.25, roughness: 0.15, shape: 'spire' },
} as const;
export type Inventory = Record<ResourceId, number>;
export interface Position { x: number; z: number }
export interface Surface { kind: 'ground' | 'wall' | 'asteroid'; y: number; nx: number; nz: number; width: number }
export interface Deposit extends Position { id: string; resource: ResourceId; remaining: number; progress: number; structureId?: string; surface?: Surface }
export interface Fragment extends Position { id: number; resource: ResourceId; age: number; vx: number; vz: number }
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
export const baseDistance = (p: Position) => Math.hypot(p.x - TRANSPORTER.x, p.z - TRANSPORTER.z);

export function createResourceState(world: LevelWorld = getLevelWorld()): ResourceState {
  const deposits = world.deposits.map(d => ({ ...d, surface: d.surface ? { ...d.surface } : undefined }));
  return { deposits, fragments: [], cargo: emptyInventory(), storage: emptyInventory(), nextFragmentId: 0,
    targetId: null, hitPoint: null, laserActive: false, notice: '', noticeTime: 0 };
}

export function surfacePoint(d: Deposit, offset = 0, world?: LevelWorld, outward = 0): Position & { y: number } {
  const x = d.x - (d.surface?.nz ?? 0) * offset + (d.surface?.nx ?? 0) * outward, z = d.z + (d.surface?.nx ?? 1) * offset + (d.surface?.nz ?? 0) * outward;
  const terrainBound = world && (d.surface?.kind === 'ground' || d.surface?.kind === 'wall');
  return { x, z, y: terrainBound ? groundHeight(world, x, z) + (d.surface?.kind === 'wall' ? .7 : .4) : (d.surface?.y ?? 0) + .4 };
}
export function findTarget(deposits: readonly Deposit[], actor: ResourceActor, world?: LevelWorld) {
  let result: { deposit: Deposit; point: Position & { y: number } } | null = null, bestAngle = Infinity, bestDistance = Infinity;
  for (const deposit of deposits) {
    if (deposit.remaining <= 0) continue;
    const width = deposit.surface?.width ?? 0;
    if (Math.hypot(deposit.x - actor.x, deposit.z - actor.z) > R.laserRange + width / 2 + 4) continue;
    // Sample the visible patch, not the host body's center. Endpoints and center are included.
    for (const offset of width ? [-0.5, -0.25, 0, 0.25, 0.5].map(t => t * width) : [0]) for (const outward of deposit.surface?.kind === 'ground' ? [-2, 0, 2] : [0]) {
    const point = surfacePoint(deposit, offset, world, outward);
    const dx = point.x - actor.x, dz = point.z - actor.z, distance = Math.hypot(dx, dz);
    if (distance > R.laserRange + 1e-8) continue;
    const angle = distance < 0.001 ? 0 : Math.abs(Math.atan2(Math.sin(Math.atan2(dx, -dz) - actor.turret), Math.cos(Math.atan2(dx, -dz) - actor.turret)));
    if (angle <= R.aimAssist + 1e-8 && (angle < bestAngle - 1e-8 || (Math.abs(angle - bestAngle) <= 1e-8 && distance < bestDistance))) {
      if (world && !clearLine(actor, point, world.solids)) continue;
      if (world && world.definition.environment === 'planet' && actor.y !== undefined) {
        let blocked = false;
        for (let t = 0.1; t < 0.95; t += 0.1) if (groundHeight(world, actor.x + dx * t, actor.z + dz * t) > actor.y + (point.y - actor.y) * t) { blocked = true; break; }
        if (blocked) continue;
      }
      result = { deposit, point }; bestAngle = angle; bestDistance = distance;
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
    s.cargo[f.resource]++; emit({ kind: 'collected', resource: f.resource, amount: 1 }); return false;
  });
  const selection = findTarget(s.deposits, actor, world), target = selection?.deposit;
  s.hitPoint = selection?.point ?? null;
  s.targetId = target?.id ?? null; s.laserActive = mine && !!target;
  if (!mine || !target) return;
  target.progress += dt;
  const duration = RESOURCES[target.resource].seconds;
  while (target.progress >= duration - 1e-8 && target.remaining > 0) {
    target.progress = Math.max(0, target.progress - duration); target.remaining--;
    const id = s.nextFragmentId++;
    const surface = target.surface, point = selection!.point;
    const outward = surface && surface.kind !== 'ground';
    const angle = outward ? Math.atan2(surface.nx, surface.nz) + Math.sin(id * 2.4) * 1.2 : id * 2.399963229728653;
    s.fragments.push({ id, resource: target.resource, x: point.x + (outward ? surface.nx * 0.65 : 0), z: point.z + (outward ? surface.nz * 0.65 : 0), age: 0,
      vx: Math.sin(angle) * R.ejectSpeed, vz: Math.cos(angle) * R.ejectSpeed });
    emit({ kind: 'mined', resource: target.resource, amount: 1 });
  }
  if (target.remaining === 0) { target.progress = 0; s.laserActive = false; s.targetId = null; }
}

export function unloadResources(s: ResourceState, actor: ResourceActor, emit: (event: ResourceEvent) => void): void {
  const total = inventoryTotal(s.cargo);
  s.noticeTime = 3;
  if (baseDistance(actor) > TRANSPORTER.radius) { s.notice = 'Zum Entladen in die ATLAS-Ladezone fliegen.'; return; }
  if (Math.abs(actor.speed) > TRANSPORTER.maxUnloadSpeed) { s.notice = 'Zum Entladen abbremsen · maximal 7 km/h.'; return; }
  if (!total) { s.notice = 'Der Frachtraum ist leer.'; return; }
  for (const resource of RESOURCE_TYPES) {
    const amount = s.cargo[resource];
    if (amount > 0) { s.storage[resource] += amount; s.cargo[resource] = 0; emit({ kind: 'delivered', resource, amount }); }
  }
  s.notice = `${total} Einheiten an ATLAS geliefert.`;
}
