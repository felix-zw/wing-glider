import type { Solid } from './levels';
import type { Position } from './resources';

export interface Contact extends Position { t: number; nx: number; nz: number; solid: Solid }
export function contains(s: Solid, p: Position, radius = 0): boolean {
  return s.kind === 'asteroid' ? Math.hypot(p.x - s.x, p.z - s.z) < s.radius + radius - 1e-7
    : Math.abs(p.x - s.x) < s.halfX + radius - 1e-7 && Math.abs(p.z - s.z) < s.halfZ + radius - 1e-7;
}
export function sweep(from: Position, to: Position, solids: readonly Solid[], radius = 0): Contact | null {
  const dx = to.x - from.x, dz = to.z - from.z;
  let best: Contact | null = null;
  for (const s of solids) {
    let t = Infinity, nx = 0, nz = 0;
    if (s.kind === 'asteroid') {
      const ox = from.x - s.x, oz = from.z - s.z, r = s.radius + radius;
      const a = dx * dx + dz * dz, b = ox * dx + oz * dz, c = ox * ox + oz * oz - r * r;
      if (c < -1e-7) { t = 0; const l = Math.hypot(ox, oz) || 1; nx = ox / l; nz = oz / l; if (!ox && !oz) nx = 1; }
      else if (a > 1e-12 && b < 0 && b * b - a * c >= 0) { t = (-b - Math.sqrt(b * b - a * c)) / a; nx = (ox + dx * t) / r; nz = (oz + dz * t) / r; }
    } else {
      const hx = s.halfX + radius, hz = s.halfZ + radius;
      if (contains(s, from, radius)) {
        t = 0;
        if (hx - Math.abs(from.x - s.x) < hz - Math.abs(from.z - s.z)) nx = from.x >= s.x ? 1 : -1;
        else nz = from.z >= s.z ? 1 : -1;
      } else {
        let entry = -Infinity, exit = Infinity;
        for (const [origin, delta, min, max, axis] of [[from.x, dx, s.x - hx, s.x + hx, 0], [from.z, dz, s.z - hz, s.z + hz, 1]]) {
          if (Math.abs(delta) < 1e-12) { if (origin < min || origin > max) exit = -Infinity; continue; }
          const lo = Math.min((min - origin) / delta, (max - origin) / delta), hi = Math.max((min - origin) / delta, (max - origin) / delta);
          if (lo > entry) { entry = lo; nx = axis === 0 ? -Math.sign(delta) : 0; nz = axis === 1 ? -Math.sign(delta) : 0; }
          exit = Math.min(exit, hi);
        }
        if (entry <= exit && entry >= -1e-8) t = Math.max(0, entry);
      }
    }
    if (t >= 0 && t <= 1 && (!best || t < best.t)) best = { t, nx, nz, x: from.x + dx * t, z: from.z + dz * t, solid: s };
  }
  return best;
}
export function moveOutside(from: Position, to: Position, solids: readonly Solid[], radius = 0): { position: Position; contact: Contact | null } {
  const contact = sweep(from, to, solids, radius);
  if (!contact) return { position: to, contact: null };
  let { x, z } = contact;
  if (contains(contact.solid, from, radius)) {
    const s = contact.solid;
    if (s.kind === 'asteroid') { x = s.x + contact.nx * (s.radius + radius); z = s.z + contact.nz * (s.radius + radius); }
    else { if (contact.nx) x = s.x + contact.nx * (s.halfX + radius); if (contact.nz) z = s.z + contact.nz * (s.halfZ + radius); }
  }
  return { position: { x: x + contact.nx * 0.002, z: z + contact.nz * 0.002 }, contact };
}
export const clearLine = (from: Position, to: Position, solids: readonly Solid[]) => {
  const hit = sweep(from, to, solids); return !hit || hit.t >= 1 - 1e-5;
};
