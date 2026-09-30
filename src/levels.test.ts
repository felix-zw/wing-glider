import { setVelocity } from './flight-motion';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLevelWorld, getSolidFootprint, groundHeight, type LevelId, type Solid } from './levels';
import { COLLISION, CONFIG, SPACE } from './config';
import { contains, clearLine, moveOutside, sweep } from './collision';
import { createState, advance, neutralInput, isProtected } from './simulation';
import { advanceResources, inventoryTotal, selectDeposit, surfacePoint, RESOURCES, RESOURCE_TYPES, unloadResources } from './resources';
import { applyMissionEvent } from './missions';
import { impact } from './hazards';
import { findRoute } from './navigation';

const diamond: Solid = { id: 'diamond', kind: 'asteroid', x: 10, z: -5, radius: 10, height: 8,
  footprint: [{ x: 0, z: -10 }, { x: 10, z: 0 }, { x: 0, z: 10 }, { x: -10, z: 0 }] };

test('polygon collisions use rendered facets and keep empty bounding-box corners flyable', () => {
  assert.deepEqual(getSolidFootprint(diamond), [{ x: 10, z: -15 }, { x: 20, z: -5 }, { x: 10, z: 5 }, { x: 0, z: -5 }]);
  assert.ok(contains(diamond, { x: 10, z: -5 }));
  assert.ok(!contains(diamond, { x: 18, z: 3 }, 2));
  assert.equal(sweep({ x: 16, z: 3 }, { x: 20, z: 3 }, [diamond], 2), null);
  const hit = sweep({ x: -30, z: -5 }, { x: 50, z: -5 }, [diamond], 2)!;
  assert.ok(hit); assert.ok(Math.abs(hit.x + 2) < 1e-7); assert.ok(Math.abs(hit.nx + 1) < 1e-7);
  assert.equal(getSolidFootprint({ id: 'shield', kind: 'asteroid', x: 0, z: 0, radius: 22, height: 10 }), null);
});

test('rounded polygon corner sweeps preserve real gaps and stop grazing impacts', () => {
  const box: Solid = { id: 'box', kind: 'cliff', x: 0, z: 0, halfX: 5, halfZ: 5, height: 10 };
  assert.ok(!contains(box, { x: 6.5, z: 6.5 }, 2), 'the square expanded AABB is not the collision shape');
  const hit = sweep({ x: 8, z: 6 }, { x: 3, z: 6 }, [box], 2)!;
  assert.ok(Math.abs(hit.x - (5 + Math.sqrt(3))) < 1e-7);
  assert.ok(Math.abs(hit.nz - 0.5) < 1e-7);
  assert.equal(sweep({ x: 8, z: 7 }, { x: 3, z: 7 }, [box], 2), null, 'exact tangent motion stays free');
  const separation = moveOutside({ x: 6, z: 6 }, { x: 6, z: 6 }, [box], 2);
  assert.ok(separation.contact); assert.ok(!contains(box, separation.position, 2));
});

test('starts-inside separation handles polygon centres and outward travel', () => {
  for (const solid of [diamond, ...getLevelWorld().solids]) {
    for (const to of [solid, { x: solid.x + 100, z: solid.z + 100 }]) {
      const result = moveOutside(solid, to, [solid], COLLISION.shipRadius);
      assert.equal(result.contact?.t, 0); assert.ok(!contains(solid, result.position, COLLISION.shipRadius));
    }
  }
});

test('navigation uses polygon corners and every returned segment clears the ship radius', () => {
  const world = { ...getLevelWorld('belt'), solids: [diamond] };
  const from = { x: -20, z: -5 }, goal = { x: 40, z: -5 }, route = findRoute(world, from, goal);
  assert.ok(route.length > 1); assert.deepEqual(route.at(-1), goal);
  let previous = from;
  for (const next of route) { assert.equal(sweep(previous, next, world.solids, COLLISION.shipRadius + 0.2), null); previous = next; }
  const gapFrom = { x: 18, z: 6 }, gapGoal = { x: 24, z: 6 };
  assert.deepEqual(findRoute(world, gapFrom, gapGoal), [gapGoal]);
});

test('planet ore strip samples remain attached to the actual collision facet', () => {
  for (const id of ['aster'] as const) {
    const world = getLevelWorld(id);
    for (const solid of world.solids) {
      assert.ok(solid.footprint && Object.isFrozen(solid.footprint));
      assert.ok(solid.footprint.every(Object.isFrozen));
    }
    for (const deposit of world.deposits.filter(d => d.surface?.kind !== 'ground')) {
      const host = world.solids.find(s => s.id === deposit.structureId)!, surface = deposit.surface!;
      for (const offset of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const p = surfacePoint(deposit, offset * surface.width, world);
        assert.ok(!contains(host, p), `${deposit.id}: ore sample inside body`);
        const inside = { x: p.x - surface.nx * 0.3, z: p.z - surface.nz * 0.3 };
        assert.ok(contains(host, inside), `${deposit.id}: ore detached from its facet`);
        const hit = sweep(p, inside, [host])!;
        assert.ok(Math.abs(hit.t - 0.5) < 1e-6, `${deposit.id}: expected 0.15m surface offset`);
      }
    }
  }
});

for (const id of ['aster', 'belt'] as const) {
  test(`${id}: world definitions are immutable, have 18 attached veins, and safe spawn/base`, () => {
    const world = getLevelWorld(id), a = createState(id), b = createState(id);
    assert.deepEqual(a, b); assert.equal(world.deposits.length, 18);
    assert.ok(Object.isFrozen(world)); assert.ok(Object.isFrozen(world.structures));
    for (const resource of RESOURCE_TYPES) assert.equal(world.deposits.filter(d => d.resource === resource).length, 6);
    for (const d of world.deposits) {
      assert.ok(world.structures.some(s => s.id === d.structureId)); assert.ok(d.surface);
      const p = { x: d.x + d.surface!.nx * 10, z: d.z + d.surface!.nz * 10 };
      assert.ok(!world.solids.some(s => contains(s, p, COLLISION.shipRadius)), `${d.id}: ${JSON.stringify({ p, blockedBy: world.solids.filter(s => contains(s, p, COLLISION.shipRadius)).map(s => s.id) })}`);
      const actor = { ...p, y: groundHeight(world, p.x, p.z) + 3.2, turret: Math.atan2(d.x - p.x, -(d.z - p.z)), speed: 0 };
      assert.equal(selectDeposit([d], actor, world)?.id, d.id, `unreachable ${d.id}`);
    }
    assert.ok(!world.solids.some(s => contains(s, a, COLLISION.shipRadius)));
    assert.ok(!world.solids.some(s => contains(s, world.base, world.base.radius + COLLISION.shipRadius)));
    a.resources.deposits[0].remaining--; assert.equal(b.resources.deposits[0].remaining, 12); assert.equal(world.deposits[0].remaining, 12);
  });
  test(`${id}: every vein can be exhausted, collected and delivered without losing resources`, () => {
    const world = getLevelWorld(id), s = createState(id);
    const emit = (event: Parameters<typeof applyMissionEvent>[2]) => applyMissionEvent(world.definition.mission, s.mission, event, s.elapsed);
    for (const d of s.resources.deposits) {
      const surface = d.surface!;
      const distance=id==='belt'?10:6;
      s.x = d.x + surface.nx * distance; s.z = d.z + surface.nz * distance; s.turret = Math.atan2(d.x - s.x, -(d.z - s.z));
      for (let i = 0; i < 120 * (12 * RESOURCES[d.resource].seconds + 4); i++) {
        const cell=d.surface?.cells?.find(c=>c.mass>1e-8);if(cell){const n=cell.normal,len=Math.hypot(n.x,n.z);s.x=cell.x+n.x/len*10;s.z=cell.z+n.z/len*10;s.turret=Math.atan2(cell.x-s.x,-(cell.z-s.z));}

        advanceResources(s.resources, { ...s, y: groundHeight(world, s.x, s.z) + 3.2 }, true, 1 / 120, emit, world);
        s.elapsed += 1 / 120;
        assert.ok(s.resources.fragments.every(f => !world.solids.some(solid => contains(solid, f, 0.24))), 'fragment embedded in a solid');
        if (inventoryTotal(s.resources.cargo) >= 29.999999) unloadResources(s.resources, { ...world.base, turret: 0, speed: 0 }, emit,world);
      }
      assert.equal(d.remaining, 0, d.id);
    }
    unloadResources(s.resources, { ...world.base, turret: 0, speed: 0 }, emit,world);
    for (const resource of RESOURCE_TYPES) assert.ok(Math.abs(s.resources.storage[resource]-72)<1e-6, resource);
    assert.equal(s.resources.fragments.length, 0); assert.ok(s.mission.completed);
  });
}
test('Aster has climbable hills distinct from unscalable walls', () => {
  const world = getLevelWorld();
  for (const s of world.structures) {
    if (s.kind === 'hill') { assert.ok(groundHeight(world, s.x, s.z) > 28); assert.ok(!world.solids.includes(s as never)); }
    else if (s.kind === 'cliff') { assert.ok(s.height > 50); assert.ok(contains(s, s)); assert.ok(groundHeight(world, s.x, s.z) < s.height); }
  }
});
test('swept collision stops high-speed crossings and permits slow harmless contact', () => {
  const world = getLevelWorld();
  assert.ok(sweep({ x: -100, z: 45 }, { x: 0, z: 45 }, world.solids, COLLISION.shipRadius));
  const s = createState(); s.x = 0; s.z = 45; s.heading = -Math.PI / 2; setVelocity(s,38);
  advance(s, neutralInput(), 1); assert.ok(s.x > -17.51); assert.ok(s.health < 100); assert.equal(s.lastDamage, 'wall');
  assert.ok(!world.solids.some(solid => contains(solid, s, COLLISION.shipRadius)));
  const slow = createState(); slow.x = -17.4; slow.z = 45; slow.heading = -Math.PI / 2; setVelocity(slow,2);
  advance(slow, neutralInput(), 0.2); assert.equal(slow.health, 100);
  const first = s.health; impact(s, 38, 'wall'); const hit = s.health;
  impact(s, 38, 'wall'); assert.equal(s.health, hit); assert.ok(hit <= first);
});
test('solid hosts occlude opposite-side veins and block fragment attraction', () => {
  for (const id of ['aster', 'belt'] as LevelId[]) {
    const world = getLevelWorld(id), s = createState(id), d = s.resources.deposits.find(d => d.surface?.kind !== 'ground')!;
    const host = world.solids.find(h => h.id === d.structureId)!;
    const opposite = { x: host.x - d.surface!.nx * (host.kind === 'asteroid' ? host.radius + 8 : 14), z: host.z - d.surface!.nz * (host.kind === 'asteroid' ? host.radius + 8 : 14) };
    assert.ok(!clearLine(opposite, d, world.solids));
    assert.equal(selectDeposit([d], { ...opposite, speed: 0, turret: Math.atan2(d.x - opposite.x, -(d.z - opposite.z)) }, world), null);
  }
  const s = createState(), world = { ...getLevelWorld(), solids: [{ id: 'thin-wall', kind: 'cliff' as const, x: -55, z: 45, halfX: 1, halfZ: 23, height: 60 }] };
  s.x = -58.6; s.z = 45;
  s.resources.fragments = [{ id: 0, resource: 'ferrite', x: -53.5, z: 45, age: 1, vx: 0, vz: 0 }];
  advanceResources(s.resources, s, false, 1, () => {}, world);
  assert.equal(s.resources.cargo.ferrite, 0); assert.equal(s.resources.fragments[0].x, -53.5);
});
test('space has no weather damage, phases or storm accumulation and ATLAS stays safe', () => {
  const s = createState('belt'); advance(s, neutralInput(), 180);
  assert.equal(s.health, 100); assert.equal(s.phaseTime, 0); assert.equal(s.storms, 0); assert.equal(s.phase, 'calm');
  assert.ok(isProtected(s)); assert.equal(getLevelWorld('belt').shelters.length, 0);
  assert.ok(s.environment.kind === 'space');
  if (s.environment.kind === 'space') for (const a of s.environment.asteroids) assert.ok(Math.hypot(a.x-getLevelWorld('belt').base.x, a.z-getLevelWorld('belt').base.z) >= SPACE.shieldRadius + a.radius);
});
test('moving asteroid causes collision damage and correctly records death', () => {
  const s = createState('belt'); s.x = -10; s.z = 80; s.health = 5;
  assert.ok(s.environment.kind === 'space');
  if (s.environment.kind === 'space') s.environment.asteroids = [{ id: 0, x: -10, z: 65, radius: 2, vx: 0, vz: 12, rotation: 0, respawns: 0 }];
  advance(s, neutralInput(), 1.5); assert.equal(s.dead, true); assert.equal(s.lastDamage, 'asteroid');
  const before = structuredClone(s); advance(s, { ...neutralInput(), mine: true }, 5); assert.deepEqual(s, before);
});
test('asteroids bounce off large bodies, respawn away from the player, and freeze with zero time', () => {
  const s = createState('belt'), world = getLevelWorld('belt');
  if (s.environment.kind !== 'space') throw new Error('wrong environment');
  const host=world.solids[0],edge=getSolidFootprint(host)!.reduce((a,b)=>a.x>b.x?a:b);
  s.environment.asteroids = [{ id: 0, x: edge.x+9, z: edge.z, radius: 2, vx: -12, vz: 0, rotation: 0, respawns: 0 }];
  const frozen = structuredClone(s); advance(s, neutralInput(), 0); assert.deepEqual(s, frozen);
  advance(s, neutralInput(), 2); const a = s.environment.asteroids[0]; assert.ok(a.vx > 0);
  assert.ok(!world.solids.some(solid => contains(solid, a, a.radius)));
  a.x = CONFIG.worldHalf + 14; advance(s, neutralInput(), 0.1);
  assert.equal(a.respawns, 1); assert.ok(Math.hypot(a.x - s.x, a.z - s.z) > 45);
});
test('space hazard motion is reproducible at 30 and 144 FPS', () => {
  const a = createState('belt'), b = createState('belt');
  for (let i = 0; i < 150; i++) advance(a, neutralInput(), 1 / 30);
  for (let i = 0; i < 720; i++) advance(b, neutralInput(), 1 / 144);
  if (a.environment.kind !== 'space' || b.environment.kind !== 'space') throw new Error('wrong environment');
  a.environment.asteroids.forEach((rock, i) => { const other = b.environment.kind === 'space' ? b.environment.asteroids[i] : rock; assert.ok(Math.hypot(rock.x - other.x, rock.z - other.z) < 0.1); });
});
test('level changes and same-level restarts never reuse mutable state', () => {
  const a = createState('aster'); a.resources.cargo.crystal = 5; a.resources.storage.ferrite = 30; a.mission.completed = true;
  const b = createState('belt'), c = createState('aster');
  assert.equal(inventoryTotal(b.resources.cargo), 0); assert.equal(inventoryTotal(c.resources.storage), 0);
  assert.equal(b.mission.completed, false); assert.equal(c.mission.completed, false);
  assert.notEqual(getLevelWorld('aster').definition.mission.id, getLevelWorld('belt').definition.mission.id);
});
