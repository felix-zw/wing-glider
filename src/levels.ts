import { CONFIG, RESOURCE_CONFIG as R, TRANSPORTER } from './config';
import { FIRST_MISSION, type MissionDefinition } from './missions';
import { bedrockUplift } from './geology';
import type { Deposit, Position, ResourceId } from './resources';

export type LevelId = 'aster' | 'belt';
export interface Shelter extends Position { name: string; radius: number }
/** Convex, counter-clockwise vertices in host-local X/Z coordinates. */
interface RockFootprint { footprint?: readonly Position[] }
export type Structure =
  | (Position & { id: string; kind: 'hill'; radius: number; height: number })
  | (Position & RockFootprint & { id: string; kind: 'cliff'; halfX: number; halfZ: number; height: number })
  | (Position & RockFootprint & { id: string; kind: 'asteroid'; radius: number; height: number });
export type Solid = Exclude<Structure, { kind: 'hill' }>;
export interface LevelDefinition { id: LevelId; name: string; subtitle: string; description: string; environment: 'planet' | 'space'; seed: number; mission: MissionDefinition }
export interface LevelWorld { definition: LevelDefinition; spawn: Position; structures: readonly Structure[]; solids: readonly Solid[]; shelters: readonly Shelter[]; deposits: readonly Deposit[]; base: typeof TRANSPORTER }
export const LEVELS: Record<LevelId, LevelDefinition> = {
  aster: { id: 'aster', name: 'Aster', subtitle: 'BERGE & SCHLUCHTEN', description: 'Erzadern in hohen Hügeln und steilen Felswänden. Suche Schutz vor Sandstürmen.', environment: 'planet', seed: 2409, mission: FIRST_MISSION },
  belt: { id: 'belt', name: 'Asteroidengürtel', subtitle: 'ZWISCHEN DEN STERNEN', description: 'Baue an großen Asteroiden ab. Weiche fliegenden Felsbrocken aus und kehre zu ATLAS zurück.', environment: 'space', seed: 7113,
    mission: { ...FIRST_MISSION, id: 'belt-first-delivery', title: 'Schätze im Vakuum.' } },
};
export function seededRandom(initial: number) { let seed = initial; return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const footprintCache = new WeakMap<Solid, readonly Position[]>();
/** Exact static rock boundary shared by rendering, navigation, ore placement and collision.
 * A null boundary denotes the circular dynamic/shield colliders used by the simulation.
 */
export function getSolidFootprint(solid: Solid): readonly Position[] | null {
  if (solid.kind === 'asteroid' && !solid.footprint) return null;
  let points = footprintCache.get(solid);
  if (!points) {
    const local = solid.footprint ?? (solid.kind === 'cliff' ? [
      { x: -solid.halfX, z: -solid.halfZ }, { x: solid.halfX, z: -solid.halfZ },
      { x: solid.halfX, z: solid.halfZ }, { x: -solid.halfX, z: solid.halfZ },
    ] : []);
    points = Object.freeze(local.map(p => Object.freeze({ x: p.x + solid.x, z: p.z + solid.z })));
    footprintCache.set(solid, points);
  }
  return points;
}

function convexHull(points: Position[]): Position[] {
  const sorted = points.sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a: Position, b: Position, c: Position) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const half = (list: Position[]) => {
    const result: Position[] = [];
    for (const p of list) { while (result.length > 1 && cross(result[result.length - 2], result[result.length - 1], p) <= 0) result.pop(); result.push(p); }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
function cliffFootprint(halfX: number, halfZ: number, index: number): Position[] {
  // Chamfered strata, with different broken ends for each ridge. Interior canyon
  // faces remain long enough to carry a coherent nine-metre ore seam.
  const shape = [ [-0.72, -1], [0.43, -0.97], [1, -0.68], [1, 0.60], [0.63, 1], [-0.47, 0.94], [-1, 0.57], [-1, -0.61] ];
  return shape.map(([x, z]) => ({ x: x * halfX, z: z * halfZ * (1 - (index % 3) * 0.025) }));
}
function asteroidFootprint(radius: number, index: number): Position[] {
  const random = seededRandom(5701 + index * 719), rotation = index * 0.73;
  const aspect = [0.82, 1.04, 0.91, 0.76, 1.12][index % 5];
  return convexHull(Array.from({ length: 11 }, (_, i) => {
    const angle = i / 11 * Math.PI * 2, r = radius * (0.82 + random() * 0.18);
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r * aspect;
    return { x: x * Math.cos(rotation) - z * Math.sin(rotation), z: x * Math.sin(rotation) + z * Math.cos(rotation) };
  }));
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
export function getLevelWorld(id: LevelId = 'aster'): LevelWorld {
  const cached = cache.get(id); if (cached) return cached;
  const structures: Structure[] = [], deposits: Deposit[] = [];
  const shelters: Shelter[] = id === 'aster' ? [-140, 0, 140].flatMap((z, row) => [-140, 0, 140].map((x, col) => ({ x, z, name: `S${row * 3 + col + 1}`, radius: CONFIG.shelterRadius }))) : [];
  const world: LevelWorld = { definition: LEVELS[id], spawn: id === 'aster' ? { x: 25, z: 36 } : { x: 0, z: 12 }, structures, solids: [], shelters, deposits, base: TRANSPORTER };
  if (id === 'aster') {
    [[42, 9, 37, 29], [74, 92, 43, 35], [-62, -55, 36, 32], [118, -82, 40, 36], [-146, 64, 38, 34], [-66, 165, 34, 29]].forEach(([x, z, radius, height], i) => structures.push({ id: `hill-${i}`, kind: 'hill', x, z, radius, height }));
    [[-55, 45, 5, 23], [-25, 45, 5, 23], [100, 35, 23, 5], [100, 65, 23, 5], [-100, -105, 23, 5], [-100, -75, 23, 5]].forEach(([x, z, halfX, halfZ], i) => structures.push({ id: `cliff-${i}`, kind: 'cliff', x, z, halfX, halfZ, height: 58 + i * 2, footprint: cliffFootprint(halfX, halfZ, i) }));
  } else {
    [[40, -10, 17], [-60, -30, 23], [65, 65, 22], [-85, 75, 24], [130, -80, 26], [-135, -100, 21], [155, 120, 23], [-60, 155, 22], [30, -160, 28]].forEach(([x, z, radius], i) => structures.push({ id: `asteroid-${i}`, kind: 'asteroid', x, z, radius, height: radius * (1.15 + i % 3 * 0.13), footprint: asteroidFootprint(radius, i) }));
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
      const angles = host.id === 'hill-0' ? [angle - 0.7, angle, angle + 0.7] : host.id === 'hill-5' ? [angle] : [angle - 0.35, angle + (host.id === 'hill-1' ? 0.6 : 0.7)];
      for (const a of angles) add(host, host.x + Math.cos(a) * host.radius * 0.62, host.z + Math.sin(a) * host.radius * 0.62, Math.cos(a), Math.sin(a), 7);
    } else if (host.kind === 'cliff') {
      const i = Number(host.id.split('-')[1]), sign = i % 2 === 0 ? 1 : -1;
      const nx = host.halfX < host.halfZ ? sign : 0, nz = host.halfX < host.halfZ ? 0 : sign;
      const point = sampleRockSurface(host, Math.atan2(nz, nx));
      add(host, point.x + point.nx * 0.15, point.z + point.nz * 0.15, point.nx, point.nz, Math.min(9, point.availableWidth));
    } else {
      const angle = Math.atan2(-host.z, -host.x);
      for (const a of [angle - 0.48, angle + 0.48]) {
        const point = sampleRockSurface(host, a);
        add(host, point.x + point.nx * 0.15, point.z + point.nz * 0.15, point.nx, point.nz, Math.min(6, point.availableWidth));
      }
    }
  }
  // Definitions are shared by simulation and rendering, never used as mutable expedition state.
  for (const d of deposits) { if (d.surface) Object.freeze(d.surface); Object.freeze(d); }
  for (const structure of structures) if (structure.kind !== 'hill' && structure.footprint) { structure.footprint.forEach(Object.freeze); Object.freeze(structure.footprint); }
  structures.forEach(Object.freeze); shelters.forEach(Object.freeze);
  Object.freeze(structures); Object.freeze(world.solids); Object.freeze(deposits); Object.freeze(shelters);
  cache.set(id, Object.freeze(world)); return world;
}
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
    if (d < 30) { const t = Math.min(1, Math.max(0, (d - 12) / 18)); h = 1.5 + (h - 1.5) * t * t * (3 - 2 * t); }
  }
  return h;
}

export const groundHeight = (world: LevelWorld, x: number, z: number) => terrainHeight(world, x, z, true);
/** Fixed geological datum keeps exposed crags embedded as their slopes rise. */
export const bedrockDatum = (world: LevelWorld, x: number, z: number) => terrainHeight(world, x, z, false);
