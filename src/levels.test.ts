import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLevelWorld, groundHeight, type LevelId } from './levels';
import { COLLISION, CONFIG, SPACE } from './config';
import { contains, clearLine, sweep } from './collision';
import { createState, advance, neutralInput, isProtected } from './simulation';
import { advanceResources, inventoryTotal, selectDeposit, RESOURCES, RESOURCE_TYPES, unloadResources } from './resources';
import { applyMissionEvent } from './missions';
import { impact } from './hazards';

for (const id of ['aster', 'belt'] as const) {
  test(`${id}: world definitions are immutable, have 18 attached veins, and safe spawn/base`, () => {
    const world = getLevelWorld(id), a = createState(id), b = createState(id);
    assert.deepEqual(a, b); assert.equal(world.deposits.length, 18);
    assert.ok(Object.isFrozen(world)); assert.ok(Object.isFrozen(world.structures));
    for (const resource of RESOURCE_TYPES) assert.equal(world.deposits.filter(d => d.resource === resource).length, 6);
    for (const d of world.deposits) {
      assert.ok(world.structures.some(s => s.id === d.structureId)); assert.ok(d.surface);
      const p = { x: d.x + d.surface!.nx * 6, z: d.z + d.surface!.nz * 6 };
      assert.ok(!world.solids.some(s => contains(s, p, COLLISION.shipRadius)), d.id);
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
      s.x = d.x + surface.nx * 6; s.z = d.z + surface.nz * 6; s.turret = Math.atan2(d.x - s.x, -(d.z - s.z));
      for (let i = 0; i < 120 * (12 * RESOURCES[d.resource].seconds + 2); i++) {
        advanceResources(s.resources, { ...s, y: groundHeight(world, s.x, s.z) + 3.2 }, true, 1 / 120, emit, world);
        s.elapsed += 1 / 120;
        assert.ok(s.resources.fragments.every(f => !world.solids.some(solid => contains(solid, f, 0.24))), 'fragment embedded in a solid');
        if (inventoryTotal(s.resources.cargo) === 30) unloadResources(s.resources, { x: 0, z: 0, turret: 0, speed: 0 }, emit);
      }
      assert.equal(d.remaining, 0, d.id);
    }
    unloadResources(s.resources, { x: 0, z: 0, turret: 0, speed: 0 }, emit);
    for (const resource of RESOURCE_TYPES) assert.equal(s.resources.storage[resource], 72, resource);
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
  const s = createState(); s.x = 0; s.z = 45; s.heading = -Math.PI / 2; s.speed = 38;
  advance(s, neutralInput(), 1); assert.ok(s.x > -17.51); assert.ok(s.health < 100); assert.equal(s.lastDamage, 'wall');
  assert.ok(!world.solids.some(solid => contains(solid, s, COLLISION.shipRadius)));
  const slow = createState(); slow.x = -17.4; slow.z = 45; slow.heading = -Math.PI / 2; slow.speed = 2;
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
  if (s.environment.kind === 'space') for (const a of s.environment.asteroids) assert.ok(Math.hypot(a.x, a.z) >= SPACE.shieldRadius + a.radius);
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
  s.environment.asteroids = [{ id: 0, x: 70, z: -10, radius: 2, vx: -12, vz: 0, rotation: 0, respawns: 0 }];
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
