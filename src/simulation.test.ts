import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, advance, createState, deadzone, isProtected, nearestShelter, neutralInput, shelters, terrainHeight } from './simulation';
import { getLevelWorld } from './levels';
import { contains } from './collision';
import { COLLISION } from './config';
import { shelterRoute } from './navigation';

test('starts stationary with full hull and a fresh weather cycle', () => {
  const s = createState();
  assert.equal(s.speed, 0); assert.equal(s.health, 100); assert.equal(s.phase, 'calm');
  advance(s, { ...neutralInput(), thrust: 1 }, 1);
  assert.ok(s.speed > 13 && s.speed < 14); assert.ok(s.z < 36);
});
test('caps speed, coasts down and prioritizes braking over thrust', () => {
  const s = createState();
  advance(s, { ...neutralInput(), thrust: 1, steer: 1 }, 4);
  assert.equal(s.speed, CONFIG.maxSpeed);
  advance(s, neutralInput(), 1); assert.ok(Math.abs(s.speed - 34.8) < 0.001);
  advance(s, { ...neutralInput(), thrust: 1, brake: 1 }, 1); assert.equal(s.speed, 0);
  const x = s.x, z = s.z;
  advance(s, { ...neutralInput(), brake: 1 }, 2); assert.equal(s.x, x); assert.equal(s.z, z);
});
test('can turn in place while turret holds its independent world direction', () => {
  const s = createState();
  advance(s, { ...neutralInput(), steer: 1, aim: 0.75 }, 1);
  assert.ok(Math.abs(s.heading - 1.9) < 0.00001); assert.equal(s.turret, 0.75);
  assert.equal(s.x, 25); assert.equal(s.z, 36);
  advance(s, { ...neutralInput(), steer: 1 }, 1); assert.equal(s.turret, 0.75);
});
test('weather phases transition exactly and repeat after a sheltered storm', () => {
  const s = createState(); s.x = 0; s.z = 0;
  advance(s, neutralInput(), 45); assert.equal(s.phase, 'warning'); assert.equal(s.phaseTime, 0);
  advance(s, neutralInput(), 12); assert.equal(s.phase, 'storm');
  advance(s, neutralInput(), 15); assert.equal(s.phase, 'calm'); assert.equal(s.storms, 1); assert.equal(s.health, 100);
});
test('only inner shelter boundaries protect; no regeneration', () => {
  assert.equal(isProtected({ x: 12, z: 0 }), true);
  assert.equal(isProtected({ x: 12.001, z: 0 }), false);
  const s = createState(); s.phase = 'storm';
  advance(s, neutralInput(), 3); assert.ok(Math.abs(s.health - 70) < 0.001);
  s.x = 0; s.z = 0; advance(s, neutralInput(), 20);
  assert.ok(Math.abs(s.health - 70) < 0.001); assert.equal(s.dead, false);
});
test('death stops simulation and a restart is independent', () => {
  const s = createState(); s.phase = 'storm';
  advance(s, neutralInput(), 11); assert.equal(s.dead, true); assert.equal(s.health, 0);
  const elapsed = s.elapsed; advance(s, { ...neutralInput(), thrust: 1 }, 10); assert.equal(s.elapsed, elapsed);
  const { resources, mission, environment, levelId, impactCooldown, lastDamage, ...flight } = createState();
  assert.equal(levelId, 'aster'); assert.equal(environment.kind, 'planet'); assert.equal(impactCooldown, 0); assert.equal(lastDamage, null);
  assert.deepEqual(flight, { x: 25, z: 36, heading: 0, turret: 0, speed: 0, health: 100, phase: 'calm', phaseTime: 0, elapsed: 0, storms: 0, distance: 0, dead: false });
  assert.equal(resources.fragments.length, 0); assert.equal(mission.completed, false);
});
test('world boundary blocks outward movement but allows turning away', () => {
  const s = createState(); s.z = -207; s.speed = 30;
  advance(s, { ...neutralInput(), thrust: 1 }, 2); assert.equal(s.z, -207); assert.equal(s.speed, 0);
  s.heading = Math.PI; advance(s, { ...neutralInput(), thrust: 1 }, 1); assert.ok(s.z > -207);
});
test('deterministic terrain has flat shelter floors and varying hills', () => {
  for (const s of shelters) { assert.equal(terrainHeight(s.x, s.z), 1.5); assert.equal(terrainHeight(s.x + 10, s.z), 1.5); }
  assert.equal(terrainHeight(35, 26), terrainHeight(35, 26));
  assert.notEqual(terrainHeight(35, 26), terrainHeight(80, 40));
  assert.equal(deadzone(0.1), 0); assert.equal(deadzone(-0.1), 0); assert.equal(deadzone(1), 1);
});
test('results are equivalent at 30 and 144 render frames per second', () => {
  const a = createState(), b = createState();
  const input = { ...neutralInput(), thrust: 1, steer: 0.3 };
  for (let i = 0; i < 90; i++) advance(a, input, 1 / 30);
  for (let i = 0; i < 432; i++) advance(b, input, 1 / 144);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.15);
  assert.ok(Math.abs(a.speed - b.speed) < 0.0001);
});
test('every sampled map location can turn, reach and brake within the warning window', () => {
  // Conservative pilot follows visibility-graph waypoints, stopping before each turn.
  for (let x = -207; x <= 207; x += 23) for (let z = -207; z <= 207; z += 23) {
    if (getLevelWorld().solids.some(wall => contains(wall, { x, z }, COLLISION.shipRadius + 0.2))) continue;
    const s = createState(); s.x = x; s.z = z; s.heading = Math.PI;
    const route = shelterRoute(s); assert.ok(route.points.length > 0);
    for (const goal of route.points) {
    if (isProtected(s) && s.speed < 0.1) break;
    const desired = Math.atan2(goal.x - s.x, -(goal.z - s.z));
    const delta = Math.atan2(Math.sin(desired - s.heading), Math.cos(desired - s.heading));
    advance(s, { ...neutralInput(), steer: Math.sign(delta) }, Math.abs(delta) / CONFIG.turnRate);
    while (s.elapsed < 12 && !(Math.hypot(goal.x - s.x, goal.z - s.z) < 0.6 && s.speed < 0.1) && !(isProtected(s) && s.speed < 0.1)) {
      const d = Math.hypot(goal.x - s.x, goal.z - s.z);
      const brakingDistance = s.speed ** 2 / (2 * CONFIG.braking);
      advance(s, { ...neutralInput(), thrust: d > brakingDistance + 0.4 ? 1 : 0, brake: d <= brakingDistance + 0.4 ? 1 : 0 }, 1 / 120);
    }
    }
    assert.ok(isProtected(s) && s.speed < 0.1, `shelter unreachable from ${x}/${z}, route ${JSON.stringify(route)}`);
    assert.equal(s.health, 100, `route from ${x}/${z} hit a wall`);
  }
});
