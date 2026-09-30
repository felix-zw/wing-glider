import { getSolidFootprints, type Solid } from './levels';
import type { Position } from './resources';

export interface Contact extends Position { t: number; nx: number; nz: number; solid: Solid }
const EPS = 1e-7;

/** Even-odd occupancy supports disjoint islands and interior tunnels. */
function boundary(loops: readonly (readonly Position[])[], p: Position) {
  let inside = false, distanceSq = Infinity, x = 0, z = 0, nx = 0, nz = 0;
  for (const points of loops)for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], ex = b.x - a.x, ez = b.z - a.z;
    const lengthSq = ex * ex + ez * ez, length = Math.sqrt(lengthSq);
    if ((a.z>p.z)!==(b.z>p.z) && p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x) inside=!inside;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / lengthSq));
    const qx = a.x + u * ex, qz = a.z + u * ez, d = (p.x - qx) ** 2 + (p.z - qz) ** 2;
    if (d < distanceSq) { distanceSq = d; x = qx; z = qz; nx = ez / length; nz = -ex / length; }
  }
  const distance = Math.sqrt(distanceSq);
  if (distance>EPS){nx=(inside?x-p.x:p.x-x)/distance;nz=(inside?z-p.z:p.z-z)/distance;}
  return { distance: inside ? -distance : distance, x, z, nx, nz };
}

export function contains(s: Solid, p: Position, radius = 0): boolean {
  const loops = getSolidFootprints(s);
  if (loops.length) return boundary(loops, p).distance < radius - EPS;
  return s.kind === 'asteroid' && !s.footprints && Math.hypot(p.x - s.x, p.z - s.z) < s.radius + radius - EPS;
}

/** Continuous disk-vs-circle / disk-vs-convex-polygon sweep.
 * Polygon offsets use rounded vertex arcs, so diagonal gaps are not blocked by
 * the expanded AABB or the pointed corners of a simple half-plane expansion.
 */
export function sweep(from: Position, to: Position, solids: readonly Solid[], radius = 0): Contact | null {
  const dx = to.x - from.x, dz = to.z - from.z, speedSq = dx * dx + dz * dz;
  let best: Contact | null = null;
  const record = (solid: Solid, t: number, nx: number, nz: number) => {
    if (t >= -EPS && t <= 1 && (!best || t < best.t)) {
      t = Math.max(0, t); best = { t, nx, nz, x: from.x + dx * t, z: from.z + dz * t, solid };
    }
  };
  const circle = (solid: Solid, x: number, z: number, r: number) => {
    const ox = from.x - x, oz = from.z - z, b = ox * dx + oz * dz, c = ox * ox + oz * oz - r * r;
    if (c < -EPS) { const l = Math.hypot(ox, oz); record(solid, 0, l ? ox / l : 1, l ? oz / l : 0); }
    else if (speedSq > 1e-12 && b < 0 && b * b - speedSq * c >= 0) {
      const t = (-b - Math.sqrt(b * b - speedSq * c)) / speedSq;
      const nx = (ox + dx * t) / r, nz = (oz + dz * t) / r;
      if (dx * nx + dz * nz < -EPS) record(solid, t, nx, nz);
    }
  };
  for (const solid of solids) {
    const loops = getSolidFootprints(solid);
    if (!loops.length) { if (solid.kind === 'asteroid'&&!solid.footprints) circle(solid, solid.x, solid.z, solid.radius + radius); continue; }
    const start = boundary(loops, from);
    if (start.distance < radius - EPS) { record(solid, 0, start.nx, start.nz); continue; }
    for(const points of loops)for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], ex = b.x - a.x, ez = b.z - a.z;
      const lengthSq = ex * ex + ez * ez, length = Math.sqrt(lengthSq), nx = ez / length, nz = -ex / length;
      const approaching = dx * nx + dz * nz;
      if (approaching < -EPS) {
        const t = (radius - ((from.x - a.x) * nx + (from.z - a.z) * nz)) / approaching;
        const u = ((from.x + dx * t - a.x) * ex + (from.z + dz * t - a.z) * ez) / lengthSq;
        if (u >= -EPS && u <= 1 + EPS) record(solid, t, nx, nz);
      }
      if (radius > 0) circle(solid, a.x, a.z, radius);
    }
  }
  return best;
}

export function moveOutside(from: Position, to: Position, solids: readonly Solid[], radius = 0): { position: Position; contact: Contact | null } {
  const contact = sweep(from, to, solids, radius);
  if (!contact) return { position: to, contact: null };
  const position = { x: contact.x + contact.nx * 0.002, z: contact.z + contact.nz * 0.002 };
  // A resumed/spawned object can start inside more than one touching body. Use
  // exact nearest boundaries repeatedly instead of assuming a first hit fixes it.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const solid of solids) {
      const loops = getSolidFootprints(solid);
      if (loops.length) {
        const near = boundary(loops, position);
        if (near.distance >= radius - EPS) continue;
        position.x = near.x + near.nx * (radius + 0.002); position.z = near.z + near.nz * (radius + 0.002); changed = true;
      } else if (solid.kind === 'asteroid'&&!solid.footprints && contains(solid, position, radius)) {
        const dx = position.x - solid.x, dz = position.z - solid.z, length = Math.hypot(dx, dz);
        position.x = solid.x + (length ? dx / length : 1) * (solid.radius + radius + 0.002);
        position.z = solid.z + (length ? dz / length : 0) * (solid.radius + radius + 0.002); changed = true;
      }
    }
    if (!changed) break;
  }
  return { position, contact };
}
export const clearLine = (from: Position, to: Position, solids: readonly Solid[]) => {
  const hit = sweep(from, to, solids); return !hit || hit.t >= 1 - 1e-5;
};
