import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAsteroidGeometry } from './asteroid-rock';
import { getLevelWorld, getSolidFootprint } from './levels';

const world = getLevelWorld('belt');

test('every asteroid keeps exact collision and ore contact through the mining band', () => {
  for (const solid of world.solids) {
    if (solid.kind !== 'asteroid') continue;
    const geometry = createAsteroidGeometry(solid), material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
    const mesh = new THREE.Mesh(geometry, material), footprint = getSolidFootprint(solid)!;
    mesh.updateMatrixWorld();
    for (let i = 0; i < footprint.length; i++) {
      const a = footprint[i], b = footprint[(i + 1) % footprint.length];
      const length = Math.hypot(b.x - a.x, b.z - a.z), nx = (b.z - a.z) / length, nz = -(b.x - a.x) / length;
      for (const along of [.17, .50, .83]) for (const y of [-.9, 2.9, 7.3]) {
        const x = a.x + (b.x - a.x) * along, z = a.z + (b.z - a.z) * along;
        const ray = new THREE.Raycaster(new THREE.Vector3(x + nx * 5, y, z + nz * 5), new THREE.Vector3(-nx, 0, -nz));
        const hit = ray.intersectObject(mesh, false)[0];
        assert.ok(hit, `${solid.id}: open or inward-facing facet ${i} at ${y}`);
        assert.ok(Math.hypot(hit.point.x - x, hit.point.z - z) < 1e-4, `${solid.id}: visual face differs from collider`);
      }
    }
    for (const d of world.deposits.filter(d => d.structureId === solid.id)) {
      const normal = d.surface!, y = normal.y + .44;
      const ray = new THREE.Raycaster(new THREE.Vector3(d.x + normal.nx * 4, y, d.z + normal.nz * 4), new THREE.Vector3(-normal.nx, 0, -normal.nz));
      assert.ok(Math.abs(ray.intersectObject(mesh, false)[0].distance - 4.15) < 1e-4, `${d.id}: ore anchor is embedded or floating`);
    }
    geometry.dispose(); material.dispose();
  }
});

test('fractured asteroids are closed outward-facing volumes within the navigation footprint and geometry budget', () => {
  for (const solid of world.solids) {
    if (solid.kind !== 'asteroid') continue;
    const geometry = createAsteroidGeometry(solid), p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    const footprint = getSolidFootprint(solid)!, edges = new Map<string, number>();
    assert.ok(p.count / 3 < 10000, `${solid.id}: excessive triangle count`);
    let volume = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cross = new THREE.Vector3();
    const key = (v: THREE.Vector3) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      assert.ok(cross.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq() > 1e-12, `${solid.id}: degenerate facet`);
      volume += a.dot(cross.crossVectors(b, c)) / 6;
      for (const v of [a, b, c]) {
        assert.ok(Number.isFinite(v.x + v.y + v.z));
        for (let edge = 0; edge < footprint.length; edge++) {
          const start = footprint[edge], end = footprint[(edge + 1) % footprint.length];
          const distance = ((end.x - start.x) * (v.z - start.z) - (end.z - start.z) * (v.x - start.x)) / Math.hypot(end.x - start.x, end.z - start.z);
          assert.ok(distance >= -2e-5, `${solid.id}: rock intrudes into flight corridor`);
        }
      }
      for (const [u, v] of [[a, b], [b, c], [c, a]]) { const pair = [key(u), key(v)].sort().join('|'); edges.set(pair, (edges.get(pair) ?? 0) + 1); }
    }
    assert.ok(volume > solid.radius ** 3, `${solid.id}: inside-out or collapsed volume`);
    assert.ok([...edges.values()].every(uses => uses === 2), `${solid.id}: surface is not watertight`);
    for (const component of n.array) assert.ok(Number.isFinite(component));
    geometry.dispose();
  }
});

test('asteroid fractures are deterministic and differ across bodies', () => {
  const solids = world.solids.filter(s => s.kind === 'asteroid');
  const a = createAsteroidGeometry(solids[0]), repeat = createAsteroidGeometry(solids[0]), other = createAsteroidGeometry(solids[1]);
  assert.deepEqual(a.getAttribute('position').array, repeat.getAttribute('position').array);
  assert.notDeepEqual(a.getAttribute('position').array, other.getAttribute('position').array);
  a.dispose(); repeat.dispose(); other.dispose();
});
