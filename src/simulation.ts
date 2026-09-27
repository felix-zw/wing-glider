import { COLLISION, CONFIG, SPACE } from './config';
import { getLevelWorld, groundHeight, type LevelId } from './levels';
import { moveOutside } from './collision';
import { advanceHazards, createHazards, impact, type FlyingAsteroid } from './hazards';
import { advanceResources, createResourceState, unloadResources, type ResourceState, type ResourceEvent } from './resources';
import { applyMissionEvent, createMissionProgress, type MissionProgress } from './missions';
export { CONFIG } from './config';

export interface Point { x: number; z: number }
export const shelters = getLevelWorld('aster').shelters;
export type Phase = 'calm' | 'warning' | 'storm';
export interface FlightInput { thrust: number; brake: number; steer: number; aim: number | null; mine: boolean; unloadPressed: boolean }
export interface State extends Point {
  heading: number; turret: number; speed: number; health: number;
  phase: Phase; phaseTime: number; elapsed: number; storms: number; distance: number; dead: boolean;
  resources: ResourceState; mission: MissionProgress;
  levelId: LevelId; environment: { kind: 'planet' } | { kind: 'space'; asteroids: FlyingAsteroid[] };
  impactCooldown: number; lastDamage: 'storm' | 'wall' | 'asteroid' | null;
}
export const neutralInput = (): FlightInput => ({ thrust: 0, brake: 0, steer: 0, aim: null, mine: false, unloadPressed: false });
export function createState(levelId: LevelId = 'aster'): State {
  const world = getLevelWorld(levelId);
  return { ...world.spawn, heading: 0, turret: 0, speed: 0, health: CONFIG.maxHealth,
    phase: 'calm', phaseTime: 0, elapsed: 0, storms: 0, distance: 0, dead: false,
    resources: createResourceState(world), mission: createMissionProgress(), levelId, impactCooldown: 0, lastDamage: null,
    environment: levelId === 'aster' ? { kind: 'planet' } : { kind: 'space', asteroids: createHazards(world) } };
}
export function phaseDuration(phase: Phase): number {
  return phase === 'calm' ? CONFIG.calmSeconds : phase === 'warning' ? CONFIG.warningSeconds : CONFIG.stormSeconds;
}
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export function deadzone(n: number): number {
  return Math.abs(n) <= CONFIG.deadzone ? 0 : Math.sign(n) * (Math.abs(n) - CONFIG.deadzone) / (1 - CONFIG.deadzone);
}
export function nearestShelter(p: Point) {
  return shelters.reduce((a, b) => Math.hypot(p.x - a.x, p.z - a.z) < Math.hypot(p.x - b.x, p.z - b.z) ? a : b);
}
export function isProtected(p: Point & { levelId?: LevelId }): boolean {
  if (p.levelId === 'belt') return Math.hypot(p.x, p.z) <= SPACE.shieldRadius;
  return shelters.some(s => Math.hypot(p.x - s.x, p.z - s.z) <= s.radius);
}

// Both rendering and flight sample this deterministic height field.
export const terrainHeight = (x: number, z: number, levelId: LevelId = 'aster') => groundHeight(getLevelWorld(levelId), x, z);

// Fixed substeps make phase boundaries, damage and motion independent of render rate.
export function advance(s: State, input: FlightInput, seconds: number): void {
  let remaining = Math.max(0, seconds);
  const world = getLevelWorld(s.levelId);
  const emit = (event: ResourceEvent) => applyMissionEvent(world.definition.mission, s.mission, event, s.elapsed);
  if (remaining > 1e-9 && !s.dead && input.unloadPressed) unloadResources(s.resources, s, emit);
  while (remaining > 1e-9 && !s.dead) {
    const dt = Math.min(remaining, 1 / 120, s.environment.kind === 'planet' ? phaseDuration(s.phase) - s.phaseTime : Infinity);
    remaining -= dt;
    s.impactCooldown = Math.max(0, s.impactCooldown - dt);
    s.heading += clamp(input.steer, -1, 1) * CONFIG.turnRate * dt;
    if (input.aim !== null) s.turret = input.aim;
    const accel = input.brake > 0 ? -CONFIG.braking * clamp(input.brake, 0, 1)
      : CONFIG.acceleration * clamp(input.thrust, 0, 1) - CONFIG.drag;
    s.speed = clamp(s.speed + accel * dt, 0, CONFIG.maxSpeed);
    const oldX = s.x, oldZ = s.z;
    const nextX = s.x + Math.sin(s.heading) * s.speed * dt;
    const nextZ = s.z - Math.cos(s.heading) * s.speed * dt;
    s.x = clamp(nextX, -CONFIG.worldHalf + 3, CONFIG.worldHalf - 3);
    s.z = clamp(nextZ, -CONFIG.worldHalf + 3, CONFIG.worldHalf - 3);
    const movement = moveOutside({ x: oldX, z: oldZ }, s, world.solids, COLLISION.shipRadius);
    s.x = movement.position.x; s.z = movement.position.z;
    if (movement.contact) { impact(s, s.speed, s.levelId === 'aster' ? 'wall' : 'asteroid'); s.speed = 0; }
    if (s.environment.kind === 'space') advanceHazards(s.environment.asteroids, world, s, { x: oldX, z: oldZ }, dt);
    if (s.x !== nextX || s.z !== nextZ) s.speed = Math.max(0, s.speed - CONFIG.braking * dt);
    s.distance += Math.hypot(s.x - oldX, s.z - oldZ);
    if (s.environment.kind === 'planet' && s.phase === 'storm' && !isProtected(s)) { s.health = Math.max(0, s.health - CONFIG.stormDamage * dt); s.lastDamage = 'storm'; }
    s.elapsed += dt;
    if (s.environment.kind === 'planet') s.phaseTime += dt;
    if (s.health <= 1e-7) { s.health = 0; s.dead = true; s.speed = 0; s.resources.laserActive = false; }
    if (!s.dead) advanceResources(s.resources, { ...s, y: terrainHeight(s.x, s.z, s.levelId) + CONFIG.hoverHeight + 0.8 }, input.mine, dt, emit, world);
    if (s.environment.kind === 'planet' && s.phaseTime >= phaseDuration(s.phase) - 1e-8) {
      if (s.phase === 'storm') s.storms++;
      s.phase = s.phase === 'calm' ? 'warning' : s.phase === 'warning' ? 'storm' : 'calm';
      s.phaseTime = 0;
    }
  }
}
