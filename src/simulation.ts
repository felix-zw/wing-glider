export const CONFIG = {
  seed: 2409, worldHalf: 210, maxSpeed: 38, acceleration: 17,
  drag: 3.2, braking: 42, turnRate: 1.9, hoverHeight: 2.4,
  calmSeconds: 45, warningSeconds: 12, stormSeconds: 15,
  maxHealth: 100, stormDamage: 10, shelterRadius: 12, deadzone: 0.16,
} as const;

export interface Point { x: number; z: number }
export const shelters = [-140, 0, 140].flatMap((z, row) =>
  [-140, 0, 140].map((x, col) => ({ x, z, name: `S${row * 3 + col + 1}`, radius: CONFIG.shelterRadius })),
);
export type Phase = 'calm' | 'warning' | 'storm';
export interface FlightInput { thrust: number; brake: number; steer: number; aim: number | null }
export interface State extends Point {
  heading: number; turret: number; speed: number; health: number;
  phase: Phase; phaseTime: number; elapsed: number; storms: number; distance: number; dead: boolean;
}
export const neutralInput = (): FlightInput => ({ thrust: 0, brake: 0, steer: 0, aim: null });
export function createState(): State {
  return { x: 25, z: 36, heading: 0, turret: 0, speed: 0, health: CONFIG.maxHealth,
    phase: 'calm', phaseTime: 0, elapsed: 0, storms: 0, distance: 0, dead: false };
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
export function isProtected(p: Point): boolean {
  return shelters.some(s => Math.hypot(p.x - s.x, p.z - s.z) <= s.radius);
}

// Both rendering and flight sample this deterministic height field.
export function terrainHeight(x: number, z: number): number {
  const seed = CONFIG.seed * 0.001;
  let h = 9 + 6 * Math.sin(x * 0.025 + seed) * Math.cos(z * 0.029)
    + 3 * Math.sin(x * 0.057 + z * 0.038) + 1.4 * Math.cos(z * 0.11 - x * 0.045);
  for (const s of shelters) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < 30) {
      const t = clamp((d - 12) / 18, 0, 1);
      const blend = t * t * (3 - 2 * t);
      h = 1.5 + (h - 1.5) * blend;
    }
  }
  return h;
}

// Fixed substeps make phase boundaries, damage and motion independent of render rate.
export function advance(s: State, input: FlightInput, seconds: number): void {
  let remaining = Math.max(0, seconds);
  while (remaining > 1e-9 && !s.dead) {
    const dt = Math.min(remaining, 1 / 120, phaseDuration(s.phase) - s.phaseTime);
    remaining -= dt;
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
    if (s.x !== nextX || s.z !== nextZ) s.speed = Math.max(0, s.speed - CONFIG.braking * dt);
    s.distance += Math.hypot(s.x - oldX, s.z - oldZ);
    if (s.phase === 'storm' && !isProtected(s)) s.health = Math.max(0, s.health - CONFIG.stormDamage * dt);
    s.elapsed += dt;
    s.phaseTime += dt;
    if (s.health <= 1e-7) { s.health = 0; s.dead = true; s.speed = 0; }
    if (s.phaseTime >= phaseDuration(s.phase) - 1e-8) {
      if (s.phase === 'storm') s.storms++;
      s.phase = s.phase === 'calm' ? 'warning' : s.phase === 'warning' ? 'storm' : 'calm';
      s.phaseTime = 0;
    }
  }
}
