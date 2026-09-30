import { COLLISION, CONFIG } from './config';
import { contains, sweep } from './collision';
import { getLevelWorld, getSolidFootprints, type LevelWorld } from './levels';
import type { Position } from './resources';

const radius = COLLISION.shipRadius + 0.2;
const graphCache = new WeakMap<LevelWorld, { nodes: Position[]; edges: number[][] }>();
function visibilityGraph(world: LevelWorld) {
  const cached = graphCache.get(world); if (cached) return cached;
  const nodes: Position[] = [];
  for (const s of world.solids) {
    const footprints = getSolidFootprints(s);
    if (footprints.length) for(const footprint of footprints)for (let i = 0; i < footprint.length; i++) {
      if(footprint.length>32&&i%4!==0)continue;
      const prev = footprint[(i + footprint.length - 1) % footprint.length], p = footprint[i], next = footprint[(i + 1) % footprint.length];
      const al = Math.hypot(p.x - prev.x, p.z - prev.z), bl = Math.hypot(next.x - p.x, next.z - p.z);
      const ax = (p.z - prev.z) / al, az = -(p.x - prev.x) / al, bx = (next.z - p.z) / bl, bz = -(next.x - p.x) / bl;
      const scale = (radius + 2) / (1 + ax * bx + az * bz);
      nodes.push({ x: p.x + (ax + bx) * scale, z: p.z + (az + bz) * scale });
    }
    else if (s.kind === 'asteroid'&&!s.footprints) for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, r = (s.radius + radius + 2) / Math.cos(Math.PI / 16);
      nodes.push({ x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r });
    }
  }
  const valid = nodes.filter(p => Math.abs(p.x) < world.bounds - 3 && Math.abs(p.z) < world.bounds - 3 && !world.solids.some(s => contains(s, p, radius)));
  const edges = valid.map((a, i) => valid.map((b, j) => i !== j && !sweep(a, b, world.solids, radius) ? Math.hypot(a.x - b.x, a.z - b.z) + 30 : Infinity));
  const graph = { nodes: valid, edges }; graphCache.set(world, graph); return graph;
}

export function findRoute(world: LevelWorld, start: Position, goal: Position): Position[] {
  if (!sweep(start, goal, world.solids, radius)) return [goal];
  const graph = visibilityGraph(world), nodes: Position[] = [start, goal, ...graph.nodes];
  const startEdges = nodes.map(p => !sweep(start, p, world.solids, radius) ? Math.hypot(start.x - p.x, start.z - p.z) + 30 : Infinity);
  const goalEdges = nodes.map(p => !sweep(goal, p, world.solids, radius) ? Math.hypot(goal.x - p.x, goal.z - p.z) + 30 : Infinity);
  const distances = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>(); distances[0] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || distances[i] < distances[current])) current = i;
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === 1) { const path: Position[] = []; for (let n = 1; n !== 0; n = previous[n]) path.unshift(nodes[n]); return path; }
    visited.add(current);
    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i)) continue;
      const edge = current === 0 ? startEdges[i] : i === 1 ? goalEdges[current] : graph.edges[current - 2][i - 2];
      const cost = distances[current] + edge;
      if (cost < distances[i]) { distances[i] = cost; previous[i] = current; }
    }
  }
  return [];
}
export function estimateRouteSeconds(start: Position, heading: number, route: readonly Position[]) {
  let point = start, time = 0;
  const a = CONFIG.acceleration - CONFIG.drag, b = CONFIG.braking, max = CONFIG.maxSpeed;
  for (const target of route) {
    const dx = target.x - point.x, dz = target.z - point.z, distance = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, -dz); time += Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading))) / CONFIG.turnRate;
    const peak = Math.min(max, Math.sqrt(2 * distance / (1 / a + 1 / b)));
    time += peak / a + peak / b + Math.max(0, distance - peak * peak / 2 * (1 / a + 1 / b)) / max;
    point = target; heading = angle;
  }
  return time;
}
export function shelterRoute(start: Position & { heading: number; levelId?:string }) {
  const world = getLevelWorld(start.levelId);
  const routes = (world.shelters.length?world.shelters:[{...world.base,name:'ATLAS'}]).map(shelter => { const points = findRoute(world, start, shelter); return { shelter, points, seconds: points.length ? estimateRouteSeconds(start, start.heading, points) : Infinity }; });
  return routes.reduce((a, b) => a.seconds < b.seconds ? a : b);
}
