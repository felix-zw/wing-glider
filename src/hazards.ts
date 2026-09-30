import { COLLISION, SPACE } from './config';
import { contains, moveOutside, sweep } from './collision';
import { seededRandom, type LevelWorld, type Solid } from './levels';
import type { Position } from './resources';

export interface FlyingAsteroid extends Position { id: number; radius: number; vx: number; vz: number; rotation: number; respawns: number }
export interface CollisionActor extends Position { vx:number; vz:number; health: number; impactCooldown: number; lastDamage: 'storm' | 'wall' | 'asteroid' | null }
export function impact(s: CollisionActor, relativeSpeed: number, cause: 'wall' | 'asteroid') {
  relativeSpeed = Math.abs(relativeSpeed);
  if (relativeSpeed <= COLLISION.damageThreshold || s.impactCooldown > 0) return;
  s.health = Math.max(0, s.health - Math.min(COLLISION.maxDamage, (relativeSpeed - COLLISION.damageThreshold) * COLLISION.damageScale));
  s.impactCooldown = COLLISION.cooldown; s.lastDamage = cause;
}
function spawn(id: number, respawns: number, world: LevelWorld, player: Position): FlyingAsteroid {
  const random = seededRandom(world.definition.seed + id * 911 + respawns * 7103), radius = 1.5 + random() * 1.5;
  const speed = SPACE.minSpeed + random() * (SPACE.maxSpeed - SPACE.minSpeed);
  let x = 0, z = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    const edge = Math.floor(random() * 4), along = (random() * 2 - 1) * world.bounds;
    x = edge < 2 ? (edge === 0 ? -1 : 1) * (world.bounds + 5) : along;
    z = edge >= 2 ? (edge === 2 ? -1 : 1) * (world.bounds + 5) : along;
    if (Math.hypot(x - player.x, z - player.z) > 45 && !world.solids.some(s => contains(s, { x, z }, radius))) break;
  }
  const tx = (random() * 2 - 1) * 160, tz = (random() * 2 - 1) * 160, length = Math.hypot(tx - x, tz - z);
  return { id, respawns, x, z, radius, vx: (tx - x) / length * speed, vz: (tz - z) / length * speed, rotation: random() * Math.PI * 2 };
}
export const createHazards = (world: LevelWorld) => Array.from({ length: SPACE.hazardCount }, (_, id) => spawn(id, 0, world, world.spawn));
export function advanceHazards(asteroids: FlyingAsteroid[], world: LevelWorld, player: CollisionActor, previous: Position, dt: number) {
  const shield: Solid = { kind: 'asteroid', id: 'shield', x: world.base.x, z: world.base.z, radius: SPACE.shieldRadius + COLLISION.shipRadius, height: 10 };
  const obstacles = [...world.solids, shield];
  for (const a of asteroids) {
    const old = { x: a.x, z: a.z };
    const moved = moveOutside(a, { x: a.x + a.vx * dt, z: a.z + a.vz * dt }, obstacles, a.radius);
    a.x = moved.position.x; a.z = moved.position.z; a.rotation += dt * 0.4;
    if (moved.contact) {
      const dot = a.vx * moved.contact.nx + a.vz * moved.contact.nz;
      if (dot < 0) { a.vx -= 2 * dot * moved.contact.nx; a.vz -= 2 * dot * moved.contact.nz; }
    }
    const hit = sweep({ x: previous.x - old.x, z: previous.z - old.z }, { x: player.x - a.x, z: player.z - a.z },
      [{ kind: 'asteroid', id: `hazard-${a.id}`, x: 0, z: 0, radius: a.radius, height: a.radius * 2 }], COLLISION.shipRadius);
    if (hit && Math.hypot(player.x - world.base.x, player.z - world.base.z) > SPACE.shieldRadius) {
      impact(player, Math.hypot(player.vx-a.vx,player.vz-a.vz), 'asteroid');
      const separated = { x: a.x + hit.nx * (a.radius + COLLISION.shipRadius + 0.01), z: a.z + hit.nz * (a.radius + COLLISION.shipRadius + 0.01) };
      const safe = moveOutside(previous, separated, world.solids, COLLISION.shipRadius).position;
      player.x = Math.max(-world.bounds + 3, Math.min(world.bounds - 3, safe.x));
      player.z = Math.max(-world.bounds + 3, Math.min(world.bounds - 3, safe.z)); player.vx *= 0.35;player.vz *= 0.35;
      const dot = a.vx * hit.nx + a.vz * hit.nz;
      if (dot > 0) { a.vx -= 2 * dot * hit.nx; a.vz -= 2 * dot * hit.nz; }
    }
    if (Math.abs(a.x) > world.bounds + 12 || Math.abs(a.z) > world.bounds + 12) Object.assign(a, spawn(a.id, a.respawns + 1, world, player));
  }
}
