import { COLLISION, CONFIG } from './config';
import { sweep } from './collision';
import { getLevelWorld, type LevelWorld } from './levels';
import type { Position } from './resources';

export function findRoute(world: LevelWorld, start: Position, goal: Position): Position[] {
  const radius = COLLISION.shipRadius + 0.2;
  if (!sweep(start, goal, world.solids, radius)) return [goal];
  const nodes: Position[] = [start, goal];
  for (const s of world.solids) {
    if (s.kind === 'cliff') for (const x of [-1, 1]) for (const z of [-1, 1]) nodes.push({ x: s.x + x * (s.halfX + radius + 2), z: s.z + z * (s.halfZ + radius + 2) });
    else for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = (s.radius + radius + 2) / Math.cos(Math.PI / 16); nodes.push({ x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r }); }
  }
  const distances = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>(); distances[0] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || distances[i] < distances[current])) current = i;
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === 1) { const path: Position[] = []; for (let n = 1; n !== 0; n = previous[n]) path.unshift(nodes[n]); return path; }
    visited.add(current);
    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i) || sweep(nodes[current], nodes[i], world.solids, radius)) continue;
      const cost = distances[current] + Math.hypot(nodes[i].x - nodes[current].x, nodes[i].z - nodes[current].z) + 30;
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
export function shelterRoute(start: Position & { heading: number }) {
  const world = getLevelWorld('aster');
  const routes = world.shelters.map(shelter => { const points = findRoute(world, start, shelter); return { shelter, points, seconds: points.length ? estimateRouteSeconds(start, start.heading, points) : Infinity }; });
  return routes.reduce((a, b) => a.seconds < b.seconds ? a : b);
}
