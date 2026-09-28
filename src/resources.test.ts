import { setVelocity } from './flight-motion';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_CONFIG as R, TRANSPORTER } from './config';
import { advance, createState, neutralInput, shelters, isProtected, type State } from './simulation';
import { advanceResources, inventoryTotal, RESOURCE_TYPES, RESOURCES, selectDeposit, type Deposit, type Fragment, type ResourceId } from './resources';
import { applyMissionEvent, createMissionProgress, FIRST_MISSION, objectiveComplete, type MissionDefinition } from './missions';
import { getLevelWorld } from './levels';
import { contains } from './collision';

const mine = { ...neutralInput(), mine: true };
const unload = { ...neutralInput(), unloadPressed: true };
const deposit = (id: string, x: number, z: number): Deposit => ({ id, x, z, resource: 'ferrite', remaining: 12, progress: 0 });
const fragment = (id: number, x: number, z: number, age = 1): Fragment => ({ id, x, z, age, resource: 'ferrite', vx: 0, vz: 0 });
function atDeposit(resource: ResourceId = 'ferrite') {
  const s = createState(), d = s.resources.deposits.find(d => d.resource === resource)!;
  s.x = d.x; s.z = d.z + 6; s.turret = 0; return { s, d };
}
function conserved(s: State) {
  for (const resource of RESOURCE_TYPES) {
    const sum = s.resources.deposits.filter(d => d.resource === resource).reduce((a, d) => a + d.remaining, 0)
      + s.resources.fragments.filter(f => f.resource === resource).length + s.resources.cargo[resource] + s.resources.storage[resource];
    assert.equal(sum, R.depositsPerType * R.unitsPerDeposit, resource);
  }
}

test('surface deposits are deterministic, attached to structures, and outside protected interiors', () => {
  const a = createState(), b = createState(); assert.deepEqual(a.resources, b.resources);
  assert.equal(a.resources.deposits.length, 18);
  for (const id of RESOURCE_TYPES) {
    const deposits = a.resources.deposits.filter(d => d.resource === id);
    assert.equal(deposits.length, 6); assert.ok(deposits.some(d => Math.hypot(d.x - a.x, d.z - a.z) < 40));
  }
  for (const d of a.resources.deposits) {
    assert.ok(Math.abs(d.x) <= 192 && Math.abs(d.z) <= 192);
    assert.ok(shelters.every(s => Math.hypot(d.x - s.x, d.z - s.z) > s.radius));
    assert.ok(getLevelWorld().structures.some(s => s.id === d.structureId));
    assert.ok(!getLevelWorld().solids.some(s => contains(s, d)));
  }
  for (let i = 0; i < 16; i++) assert.ok(isProtected({ x: Math.sin(i) * TRANSPORTER.radius, z: Math.cos(i) * TRANSPORTER.radius }));
});

test('laser respects range, angle, depletion, and angle-then-distance priority', () => {
  const actor = { x: 0, z: 0, turret: 0, speed: 0 };
  const close = deposit('close', 0, -5), far = deposit('far', 0, -20);
  assert.equal(selectDeposit([far, close], actor), close);
  assert.equal(selectDeposit([deposit('off-center', 1, -5), far], actor), far);
  assert.ok(selectDeposit([deposit('edge', 0, -22)], actor));
  assert.equal(selectDeposit([deposit('outside', 0, -22.001)], actor), null);
  assert.ok(selectDeposit([deposit('angle-edge', Math.sin(R.aimAssist) * 20, -Math.cos(R.aimAssist) * 20)], actor));
  assert.equal(selectDeposit([deposit('angle-outside', Math.sin(R.aimAssist + 0.001) * 20, -Math.cos(R.aimAssist + 0.001) * 20)], actor), null);
  close.remaining = 0; assert.equal(selectDeposit([close], actor), null);
  assert.equal(selectDeposit([deposit('behind', 0, 5)], actor), null);
});

for (const resource of RESOURCE_TYPES) test(`${resource} releases only after its mining duration and preserves interrupted progress`, () => {
  const { s, d } = atDeposit(resource), time = RESOURCES[resource].seconds;
  advance(s, mine, time / 2); assert.equal(d.remaining, 12); assert.equal(s.resources.fragments.length, 0);
  const progress = d.progress;
  advance(s, neutralInput(), 0.5); assert.equal(d.progress, progress);
  advance(s, { ...mine, aim: Math.PI }, 0.3); assert.equal(d.progress, progress);
  advance(s, { ...mine, aim: 0 }, time / 2); assert.equal(d.remaining, 11);
  assert.equal(s.resources.fragments.length, 1); assert.equal(inventoryTotal(s.resources.cargo), 0);
  assert.equal(s.resources.fragments[0].age, 0); conserved(s);
});

test('fragments wait for ejection, attract only within range, and are collected once', () => {
  const s = createState(); s.x = 0; s.z = 0;
  s.resources.fragments = [fragment(0, 0, 1, 0), fragment(1, 0, 9), fragment(2, 0, 11)];
  advance(s, neutralInput(), 0.2); assert.equal(s.resources.cargo.ferrite, 0);
  assert.ok(s.resources.fragments[1].z < 9); assert.equal(s.resources.fragments[2].z, 11);
  advance(s, neutralInput(), 1); assert.equal(s.resources.cargo.ferrite, 2);
  advance(s, neutralInput(), 2); assert.equal(s.resources.cargo.ferrite, 2);
  assert.deepEqual(s.resources.fragments.map(f => f.id), [2]);
});

test('full cargo leaves particles available and mining continues until the finite deposit is exhausted', () => {
  const { s, d } = atDeposit(); s.resources.cargo.ferrite = 30;
  advance(s, mine, 14); assert.equal(d.remaining, 0); assert.equal(d.progress, 0);
  assert.equal(s.resources.fragments.length, 12); assert.equal(s.resources.cargo.ferrite, 30);
  assert.equal(s.resources.laserActive, false);
  const positions = s.resources.fragments.map(f => [f.x, f.z]);
  advance(s, mine, 2); assert.deepEqual(s.resources.fragments.map(f => [f.x, f.z]), positions);
  s.resources.cargo.ferrite = 29; advance(s, neutralInput(), 1);
  assert.equal(s.resources.cargo.ferrite, 30); assert.equal(s.resources.fragments.length, 11);
});

test('unloading requires a press, the loading zone, and low speed; one press is not retried across substeps', () => {
  const s = createState(); s.resources.cargo.ferrite = 8;
  advance(s, unload, 0.1); assert.equal(s.resources.cargo.ferrite, 8);
  s.x = 0; s.z = 0; setVelocity(s,3);
  advance(s, { ...unload, brake: 1 }, 0.5); assert.equal(s.resources.cargo.ferrite, 8);
  advance(s, neutralInput(), 0.5); assert.equal(s.resources.storage.ferrite, 0);
  s.x = 8; s.z = 0; setVelocity(s,2);
  advance(s, unload, 0.01); assert.equal(s.resources.cargo.ferrite, 0); assert.equal(s.resources.storage.ferrite, 8);
  advance(s, unload, 1); assert.equal(s.resources.storage.ferrite, 8); assert.equal(s.mission.counts['ferrite-delivery'], 8);
});

test('mining and collecting do not advance the delivery mission; multiple deliveries complete it once', () => {
  const s = createState(); s.x = 0; s.z = 0;
  applyMissionEvent(FIRST_MISSION, s.mission, { kind: 'mined', resource: 'ferrite', amount: 30 }, 0);
  applyMissionEvent(FIRST_MISSION, s.mission, { kind: 'collected', resource: 'ferrite', amount: 30 }, 0);
  assert.deepEqual(s.mission.counts, {});
  s.resources.cargo.ferrite = 30; advance(s, unload, 0.1); assert.equal(s.mission.completed, false);
  s.resources.cargo.copper = 20; s.resources.cargo.crystal = 10; advance(s, unload, 0.1);
  assert.equal(s.mission.completed, true); const completedAt = s.mission.completedAt;
  s.resources.cargo.ferrite = 5; advance(s, unload, 0.1);
  assert.equal(s.resources.storage.ferrite, 35); assert.equal(s.mission.counts['ferrite-delivery'], 30);
  assert.equal(s.mission.completedAt, completedAt); assert.equal(s.dead, false);
});

test('declarative missions support nested all/any, resource filters and unfiltered counts', () => {
  const definition: MissionDefinition = { id: 'test', title: 'Test', objective: { id: 'all', kind: 'all', label: 'All', children: [
    { id: 'collect', kind: 'count', label: 'Collect', event: 'collected', amount: 3 },
    { id: 'either', kind: 'any', label: 'Either', children: [
      { id: 'mine', kind: 'count', label: 'Mine', event: 'mined', resource: 'copper', amount: 2 },
      { id: 'deliver', kind: 'count', label: 'Deliver', event: 'delivered', resource: 'crystal', amount: 1 },
    ] },
  ] } };
  const p = createMissionProgress();
  applyMissionEvent(definition, p, { kind: 'mined', resource: 'ferrite', amount: 20 }, 0); assert.equal(p.counts.mine, undefined);
  applyMissionEvent(definition, p, { kind: 'collected', resource: 'ferrite', amount: 2 }, 1);
  applyMissionEvent(definition, p, { kind: 'collected', resource: 'crystal', amount: 2 }, 2); assert.equal(p.counts.collect, 3);
  assert.equal(objectiveComplete(definition.objective, p), false);
  assert.equal(applyMissionEvent(definition, p, { kind: 'mined', resource: 'copper', amount: 2 }, 3), true);
  assert.equal(applyMissionEvent(definition, p, { kind: 'delivered', resource: 'crystal', amount: 1 }, 4), false);
  assert.equal(p.completedAt, 3);
});

test('zero-time pause, death, and a fresh expedition preserve lifecycle guarantees', () => {
  const { s } = atDeposit(); advance(s, mine, 1.1);
  const paused = structuredClone(s); advance(s, { ...mine, unloadPressed: true }, 0); assert.deepEqual(s, paused);
  s.phase = 'storm'; s.health = 0.001; advance(s, mine, 0.1); assert.equal(s.dead, true); assert.equal(s.resources.laserActive, false);
  const dead = structuredClone(s); advance(s, { ...mine, unloadPressed: true }, 10); assert.deepEqual(s, dead);
  const fresh = createState(); assert.equal(fresh.resources.fragments.length, 0); assert.equal(inventoryTotal(fresh.resources.cargo), 0);
  assert.equal(inventoryTotal(fresh.resources.storage), 0); assert.equal(fresh.mission.completed, false);
  assert.ok(fresh.resources.deposits.every(d => d.remaining === 12 && d.progress === 0));
  assert.notEqual(fresh.resources.deposits[0], s.resources.deposits[0]);
});

test('mining and pickup quantities agree at 30 and 144 FPS', () => {
  const a = atDeposit().s, b = atDeposit().s;
  for (let i = 0; i < 30 * 13; i++) advance(a, mine, 1 / 30);
  for (let i = 0; i < 144 * 13; i++) advance(b, mine, 1 / 144);
  assert.deepEqual(a.resources.cargo, b.resources.cargo);
  assert.equal(a.resources.fragments.length, b.resources.fragments.length);
  assert.equal(a.resources.deposits[0].remaining, b.resources.deposits[0].remaining);
  conserved(a); conserved(b);
});

test('full resource loop conserves each material through mining, capacity limits, pickup and delivery', () => {
  const s = createState();
  const emit = () => {};
  for (const d of s.resources.deposits) {
    s.x = d.x; s.z = d.z + 5; s.turret = 0;
    for (let step = 0; step < 120 * 24; step++) {
      advanceResources(s.resources, s, true, 1 / 120, emit);
      if (inventoryTotal(s.resources.cargo) === 30) {
        const x = s.x, z = s.z; s.x = 0; s.z = 0; advance(s, unload, 0.001); s.x = x; s.z = z;
      }
    }
    conserved(s);
  }
  s.x = 0; s.z = 0; advance(s, unload, 0.001); conserved(s);
  assert.equal(inventoryTotal(s.resources.storage), 216);
  assert.equal(s.resources.fragments.length, 0); assert.equal(s.mission.completed, true);
});
