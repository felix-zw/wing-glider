import { COLLISION, CONFIG, SPACE } from './config';
import { getLevelWorld, groundHeight, type LevelId } from './levels';
import { moveOutside } from './collision';
import { advanceHazards, createHazards, impact, type FlyingAsteroid } from './hazards';
import { advanceResources, createResourceState, unloadResources, type ResourceState, type ResourceEvent } from './resources';
import { applyMissionEvent, createMissionProgress, type MissionProgress } from './missions';
import { vehiclePose, vehicleLaserOrigin, type VehiclePose } from './vehicle-pose';
export { CONFIG } from './config';

export interface Point { x: number; z: number }
export const shelters = getLevelWorld('aster').shelters;
export type Phase = 'calm' | 'warning' | 'storm';
export interface FlightInput { thrust: number; brake: number; steer: number; aim: number | null; mine: boolean; unloadPressed: boolean }
export interface State extends Point {
  /** Speed is signed: positive along heading, negative while reversing. */
  heading: number; turret: number; speed: number; health: number;
  phase: Phase; phaseTime: number; elapsed: number; storms: number; distance: number; dead: boolean;
  resources: ResourceState; mission: MissionProgress;
  levelId: LevelId; environment: { kind: 'planet' } | { kind: 'space'; asteroids: FlyingAsteroid[] };
  impactCooldown: number; lastDamage: 'storm' | 'wall' | 'asteroid' | null;
  surfacePose: (VehiclePose & { x: number; z: number; heading: number; elapsed: number }) | null;
}
export const neutralInput = (): FlightInput => ({ thrust: 0, brake: 0, steer: 0, aim: null, mine: false, unloadPressed: false });
export function createState(levelId: LevelId = 'aster'): State {
  const world = getLevelWorld(levelId);
  return { ...world.spawn, heading: 0, turret: 0, speed: 0, health: CONFIG.maxHealth,
    phase: 'calm', phaseTime: 0, elapsed: 0, storms: 0, distance: 0, dead: false,
    resources: createResourceState(world), mission: createMissionProgress(), levelId, impactCooldown: 0, lastDamage: null, surfacePose: null,
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

function approachRest(speed: number, amount: number): number {
  const magnitude = Math.max(0, Math.abs(speed) - amount);
  return magnitude > 1e-9 ? Math.sign(speed) * magnitude : 0;
}
function driveSpeed(speed: number, input: FlightInput, dt: number): number {
  const brake = clamp(input.brake, 0, 1), thrust = clamp(input.thrust, 0, 1);
  if (brake > 0) {
    if (speed > 0) {
      // Spend the stopping time first. Only the remainder can power reverse,
      // including when one caller's frame straddles the zero-speed transition.
      const stoppingTime = Math.min(dt, speed / (CONFIG.braking * brake));
      speed = approachRest(speed, CONFIG.braking * brake * stoppingTime); dt -= stoppingTime;
    }
    if (dt > 0) speed = Math.max(-CONFIG.maxReverseSpeed, speed - CONFIG.reverseAcceleration * brake * dt);
  } else if (thrust > 0) {
    if (speed < 0) {
      const stoppingTime = Math.min(dt, -speed / (CONFIG.braking * thrust));
      speed = approachRest(speed, CONFIG.braking * thrust * stoppingTime); dt -= stoppingTime;
    }
    if (dt > 0) speed = clamp(speed + (CONFIG.acceleration * thrust - CONFIG.drag) * dt, 0, CONFIG.maxSpeed);
  } else speed = approachRest(speed, CONFIG.drag * dt);
  return Math.abs(speed) > 1e-9 ? speed : 0;
}

// Fixed substeps make phase boundaries, damage and motion independent of render rate.
export function advance(s: State, input: FlightInput, seconds: number): void {
  let remaining = Math.max(0, seconds);
  const world = getLevelWorld(s.levelId);
  const height = (x: number, z: number) => groundHeight(world, x, z);
  const emit = (event: ResourceEvent) => applyMissionEvent(world.definition.mission, s.mission, event, s.elapsed);
  if (remaining > 1e-9 && !s.dead && input.unloadPressed) unloadResources(s.resources, s, emit);
  while (remaining > 1e-9 && !s.dead) {
    const dt = Math.min(remaining, 1 / 120, s.environment.kind === 'planet' ? phaseDuration(s.phase) - s.phaseTime : Infinity);
    remaining -= dt;
    // External fixture placement/restarts invalidate smoothing history. Normal
    // flight reuses exactly the previous authoritative simulation pose.
    const oldPose = s.surfacePose;
    const previousPose = oldPose && oldPose.x === s.x && oldPose.z === s.z && oldPose.heading === s.heading && oldPose.elapsed === s.elapsed ? oldPose : null;
    s.impactCooldown = Math.max(0, s.impactCooldown - dt);
    s.heading += clamp(input.steer, -1, 1) * CONFIG.turnRate * dt;
    if (input.aim !== null) s.turret = input.aim;
    s.speed = driveSpeed(s.speed, input, dt);
    const oldX = s.x, oldZ = s.z;
    const nextX = s.x + Math.sin(s.heading) * s.speed * dt;
    const nextZ = s.z - Math.cos(s.heading) * s.speed * dt;
    s.x = clamp(nextX, -CONFIG.worldHalf + 3, CONFIG.worldHalf - 3);
    s.z = clamp(nextZ, -CONFIG.worldHalf + 3, CONFIG.worldHalf - 3);
    const movement = moveOutside({ x: oldX, z: oldZ }, s, world.solids, COLLISION.shipRadius);
    s.x = movement.position.x; s.z = movement.position.z;
    if (movement.contact) { impact(s, Math.abs(s.speed), s.levelId === 'aster' ? 'wall' : 'asteroid'); s.speed = 0; }
    if (s.environment.kind === 'space') advanceHazards(s.environment.asteroids, world, s, { x: oldX, z: oldZ }, dt);
    if (s.x !== nextX || s.z !== nextZ) s.speed = approachRest(s.speed, CONFIG.braking * dt);
    s.distance += Math.hypot(s.x - oldX, s.z - oldZ);
    if (s.environment.kind === 'planet' && s.phase === 'storm' && !isProtected(s)) { s.health = Math.max(0, s.health - CONFIG.stormDamage * dt); s.lastDamage = 'storm'; }
    s.elapsed += dt;
    s.surfacePose = s.environment.kind === 'planet' ? {
      ...vehiclePose(height, { x: s.x, z: s.z, heading: s.heading,
        hover: CONFIG.hoverHeight + Math.sin(s.elapsed * 3) * 0.09,
        bank: clamp(clamp(input.steer, -1, 1) * CONFIG.turnRate * 0.025, -0.045, 0.045) }, previousPose, dt),
      x: s.x, z: s.z, heading: s.heading, elapsed: s.elapsed,
    } : null;
    if (s.environment.kind === 'planet') s.phaseTime += dt;
    if (s.health <= 1e-7) { s.health = 0; s.dead = true; s.speed = 0; s.resources.laserActive = false; }
    if (!s.dead) {
      const laserY = s.surfacePose ? vehicleLaserOrigin(s.surfacePose, s).y : SPACE.flightHeight + 0.8;
      advanceResources(s.resources, { ...s, y: laserY }, input.mine, dt, emit, world);
    }
    if (s.environment.kind === 'planet' && s.phaseTime >= phaseDuration(s.phase) - 1e-8) {
      if (s.phase === 'storm') s.storms++;
      s.phase = s.phase === 'calm' ? 'warning' : s.phase === 'warning' ? 'storm' : 'calm';
      s.phaseTime = 0;
    }
  }
}
