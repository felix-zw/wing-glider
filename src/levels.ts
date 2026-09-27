import { CONFIG, RESOURCE_CONFIG as R, TRANSPORTER } from './config';
import { FIRST_MISSION, type MissionDefinition } from './missions';
import type { Deposit, Position, ResourceId } from './resources';

export type LevelId = 'aster' | 'belt';
export interface Shelter extends Position { name: string; radius: number }
export type Structure =
  | (Position & { id: string; kind: 'hill'; radius: number; height: number })
  | (Position & { id: string; kind: 'cliff'; halfX: number; halfZ: number; height: number })
  | (Position & { id: string; kind: 'asteroid'; radius: number; height: number });
export type Solid = Exclude<Structure, { kind: 'hill' }>;
export interface LevelDefinition { id: LevelId; name: string; subtitle: string; description: string; environment: 'planet' | 'space'; seed: number; mission: MissionDefinition }
export interface LevelWorld { definition: LevelDefinition; spawn: Position; structures: readonly Structure[]; solids: readonly Solid[]; shelters: readonly Shelter[]; deposits: readonly Deposit[]; base: typeof TRANSPORTER }
export const LEVELS: Record<LevelId, LevelDefinition> = {
  aster: { id: 'aster', name: 'Aster', subtitle: 'BERGE & SCHLUCHTEN', description: 'Erzadern in hohen Hügeln und steilen Felswänden. Suche Schutz vor Sandstürmen.', environment: 'planet', seed: 2409, mission: FIRST_MISSION },
  belt: { id: 'belt', name: 'Asteroidengürtel', subtitle: 'ZWISCHEN DEN STERNEN', description: 'Baue an großen Asteroiden ab. Weiche fliegenden Felsbrocken aus und kehre zu ATLAS zurück.', environment: 'space', seed: 7113,
    mission: { ...FIRST_MISSION, id: 'belt-first-delivery', title: 'Schätze im Vakuum.' } },
};
export function seededRandom(initial: number) { let seed = initial; return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const cache = new Map<LevelId, LevelWorld>();
export function getLevelWorld(id: LevelId = 'aster'): LevelWorld {
  const cached = cache.get(id); if (cached) return cached;
  const structures: Structure[] = [], deposits: Deposit[] = [];
  const shelters: Shelter[] = id === 'aster' ? [-140, 0, 140].flatMap((z, row) => [-140, 0, 140].map((x, col) => ({ x, z, name: `S${row * 3 + col + 1}`, radius: CONFIG.shelterRadius }))) : [];
  const world: LevelWorld = { definition: LEVELS[id], spawn: id === 'aster' ? { x: 25, z: 36 } : { x: 0, z: 12 }, structures, solids: [], shelters, deposits, base: TRANSPORTER };
  if (id === 'aster') {
    [[42, 9, 37, 29], [74, 92, 43, 35], [-62, -55, 36, 32], [118, -82, 40, 36], [-146, 64, 38, 34], [-66, 165, 34, 29]].forEach(([x, z, radius, height], i) => structures.push({ id: `hill-${i}`, kind: 'hill', x, z, radius, height }));
    [[-55, 45, 5, 23], [-25, 45, 5, 23], [100, 35, 23, 5], [100, 65, 23, 5], [-100, -105, 23, 5], [-100, -75, 23, 5]].forEach(([x, z, halfX, halfZ], i) => structures.push({ id: `cliff-${i}`, kind: 'cliff', x, z, halfX, halfZ, height: 58 + i * 2 }));
  } else {
    [[40, -10, 17], [-60, -30, 23], [65, 65, 22], [-85, 75, 24], [130, -80, 26], [-135, -100, 21], [155, 120, 23], [-60, 155, 22], [30, -160, 28]].forEach(([x, z, radius], i) => structures.push({ id: `asteroid-${i}`, kind: 'asteroid', x, z, radius, height: radius * 1.3 }));
  }
  world.solids = structures.filter((s): s is Solid => s.kind !== 'hill');
  const types: ResourceId[] = ['ferrite', 'copper', 'crystal'];
  const add = (host: Structure, x: number, z: number, nx: number, nz: number, width: number) => {
    const index = deposits.length, y = host.kind === 'asteroid' ? 2.5 : groundHeight(world, x, z) + 0.3;
    deposits.push({ id: `${id}-vein-${index}`, resource: types[index % 3], x, z, remaining: R.unitsPerDeposit, progress: 0,
      structureId: host.id, surface: { kind: host.kind === 'hill' ? 'ground' : host.kind === 'cliff' ? 'wall' : 'asteroid', y, nx, nz, width } });
  };
  for (const host of structures) {
    if (host.kind === 'hill') {
      const angle = Math.atan2(36 - host.z, 25 - host.x);
      const angles = host.id === 'hill-0' ? [angle - 0.7, angle, angle + 0.7] : host.id === 'hill-5' ? [angle] : [angle - 0.35, angle + 0.7];
      for (const a of angles) add(host, host.x + Math.cos(a) * host.radius * 0.62, host.z + Math.sin(a) * host.radius * 0.62, Math.cos(a), Math.sin(a), 7);
    } else if (host.kind === 'cliff') {
      const i = Number(host.id.split('-')[1]), sign = i % 2 === 0 ? 1 : -1;
      const nx = host.halfX < host.halfZ ? sign : 0, nz = host.halfX < host.halfZ ? 0 : sign;
      add(host, host.x + nx * (host.halfX + 0.15), host.z + nz * (host.halfZ + 0.15), nx, nz, 9);
    } else {
      const angle = Math.atan2(-host.z, -host.x);
      for (const a of [angle - 0.48, angle + 0.48]) add(host, host.x + Math.cos(a) * (host.radius + 0.15), host.z + Math.sin(a) * (host.radius + 0.15), Math.cos(a), Math.sin(a), 6);
    }
  }
  // Definitions are shared by simulation and rendering, never used as mutable expedition state.
  for (const d of deposits) { if (d.surface) Object.freeze(d.surface); Object.freeze(d); }
  structures.forEach(Object.freeze); shelters.forEach(Object.freeze);
  Object.freeze(structures); Object.freeze(world.solids); Object.freeze(deposits); Object.freeze(shelters);
  cache.set(id, Object.freeze(world)); return world;
}
export function groundHeight(world: LevelWorld, x: number, z: number): number {
  if (world.definition.environment === 'space') return 0;
  const seed = world.definition.seed * 0.001;
  let h = 9 + 6 * Math.sin(x * 0.025 + seed) * Math.cos(z * 0.029) + 3 * Math.sin(x * 0.057 + z * 0.038) + 1.4 * Math.cos(z * 0.11 - x * 0.045);
  for (const hill of world.structures) if (hill.kind === 'hill') {
    const r = Math.hypot(x - hill.x, z - hill.z) / hill.radius;
    if (r < 1) h += hill.height * (1 - r * r) ** 2;
  }
  for (const s of world.shelters) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < 30) { const t = Math.min(1, Math.max(0, (d - 12) / 18)); h = 1.5 + (h - 1.5) * t * t * (3 - 2 * t); }
  }
  return h;
}
