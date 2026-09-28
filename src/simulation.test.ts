import { forwardSpeed, setVelocity, motionState } from './flight-motion';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, advance, createState, deadzone, isProtected, nearestShelter, neutralInput, shelters, terrainHeight } from './simulation';
import { getLevelWorld } from './levels';
import { contains } from './collision';
import { COLLISION } from './config';
import { shelterRoute } from './navigation';
import { impact } from './hazards';
import { findTarget } from './resources';
import { vehiclePose, vehicleLaserOrigin } from './vehicle-pose';

test('starts stationary with full hull and a fresh weather cycle', () => {
  const s = createState();
  assert.equal(s.speed, 0); assert.equal(s.health, 100); assert.equal(s.phase, 'calm');
  advance(s, { ...neutralInput(), thrust: 1 }, 1);
  assert.ok(s.speed > 13 && s.speed < 14); assert.ok(s.z < 36);
});
test('caps speed, coasts down and prioritizes braking over thrust', () => {
  const s = createState(); setVelocity(s,50);
  advance(s, { ...neutralInput(), thrust: 1 }, 1/120);
  assert.ok(s.speed<=CONFIG.maxSpeed&&s.speed>37.9);
  const speed=s.speed;advance(s, neutralInput(), .2);assert.ok(Math.abs(s.speed-(speed-.64))<1e-6);
  advance(s, { ...neutralInput(), thrust: 1, brake: 1 }, 2); assert.equal(s.speed, 0);
  const x=s.x,z=s.z;advance(s,{...neutralInput(),brake:1},1);
  assert.equal(s.x,x);assert.equal(s.z,z);
  advance(s,neutralInput(),.01);advance(s,{...neutralInput(),brake:1},.5);
  assert.ok(forwardSpeed(s)<0&&s.z>z);
});

test('reverse transitions agree at 30 and 144 FPS, including frames that cross zero', () => {
  const a=createState(),b=createState();setVelocity(a,15);setVelocity(b,15);
  for(const input of [{...neutralInput(),brake:.7},neutralInput(),{...neutralInput(),brake:.7},{...neutralInput(),thrust:.6}]) {
    for(let i=0;i<30;i++)advance(a,input,1/30);
    for(let i=0;i<144;i++)advance(b,input,1/144);
    assert.ok(Math.abs(a.speed-b.speed)<.02);
    assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.1);
  }
});

test('backwards travel stops at map boundaries and rock walls and can pull away', () => {
  const edge = createState(); edge.z = 207; setVelocity(edge,-CONFIG.maxReverseSpeed);
  advance(edge, neutralInput(), 1);
  assert.equal(edge.z, 207); assert.equal(edge.speed, 0);
  advance(edge, { ...neutralInput(), thrust: 1 }, 0.4); assert.ok(edge.z < 207);
  const wall = createState(); wall.x = -10; wall.z = 45; wall.heading = Math.PI / 2; setVelocity(wall,-CONFIG.maxReverseSpeed);
  advance(wall, neutralInput(), 2);
  const boundary = -20 + COLLISION.shipRadius;
  assert.ok(wall.x >= boundary && wall.x <= boundary + 0.0021);
  assert.ok(!getLevelWorld().solids.some(solid => contains(solid, wall, COLLISION.shipRadius)));
  assert.equal(wall.health, 100, 'the slow reverse cap is below damaging wall impact speed');
  advance(wall, neutralInput(), 0.1); assert.equal(wall.speed, 0);
  const stopped = wall.x; advance(wall, { ...neutralInput(), thrust: 1 }, 0.4); assert.ok(wall.x > stopped);
});
test('reverse uses impact magnitude and signed relative velocity for moving hazards', () => {
  const wall = createState(); impact(wall, -12, 'wall'); assert.equal(wall.health, 91);
  const s = createState('belt'); s.x = -10; s.z = 80; setVelocity(s,-CONFIG.maxReverseSpeed);
  if (s.environment.kind !== 'space') throw new Error('wrong environment');
  s.environment.asteroids = [{ id: 0, x: -10, z: 88, radius: 2, vx: 0, vz: -12, rotation: 0, respawns: 0 }];
  advance(s, neutralInput(), 0.3);
  assert.equal(s.lastDamage, 'asteroid'); assert.ok(s.health<83&&s.health>81);
});
test('unloading enforces the speed limit in both directions', () => {
  const s = createState(); s.x = 0; s.z = 0; setVelocity(s,-3); s.resources.cargo.copper = 4;
  advance(s, { ...neutralInput(), unloadPressed: true }, 1 / 120);
  assert.equal(s.resources.storage.copper, 0); assert.equal(s.resources.cargo.copper, 4);
  assert.match(s.resources.notice, /abbremsen/);
  setVelocity(s,-2);
  advance(s, { ...neutralInput(), unloadPressed: true }, 1 / 120);
  assert.equal(s.resources.storage.copper, 4); assert.equal(s.resources.cargo.copper, 0);
});

test('sideways drift cannot unload and rock contact preserves tangential travel',()=>{
  const delivery=createState();delivery.x=delivery.z=0;setVelocity(delivery,0,4);delivery.resources.cargo.copper=3;
  advance(delivery,{...neutralInput(),unloadPressed:true},1/120);
  assert.equal(delivery.resources.storage.copper,0);assert.match(delivery.resources.notice,/abbremsen/);
  const wall=createState();wall.x=-14.5;wall.z=45;setVelocity(wall,12,-20);
  advance(wall,{...neutralInput(),handbrake:1},.2);
  assert.ok(Math.abs(wall.vx)<.01&&wall.vz<-10,'impact removes the inward component while retaining travel along the wall');
  assert.ok(wall.z<43&&wall.x>=-15.502);
});
test('can turn in place while turret holds its independent world direction', () => {
  const s = createState();
  advance(s, { ...neutralInput(), steer: 1, aim: 0.75 }, 1);
  assert.ok(s.heading>1.7&&s.heading<1.9); assert.equal(s.turret, 0.75);
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
  const { resources, mission, environment, levelId, impactCooldown, lastDamage, surfacePose, ...flight } = createState();
  assert.equal(levelId, 'aster'); assert.equal(environment.kind, 'planet'); assert.equal(impactCooldown, 0); assert.equal(lastDamage, null);
  assert.equal(surfacePose, null);
  assert.deepEqual(flight, { ...motionState(), x: 25, z: 36, heading: 0, turret: 0, speed: 0, health: 100, phase: 'calm', phaseTime: 0, elapsed: 0, storms: 0, distance: 0, dead: false });
  assert.equal(resources.fragments.length, 0); assert.equal(mission.completed, false);
});
test('world boundary blocks outward movement but allows turning away', () => {
  const s = createState(); s.z = -207; setVelocity(s,30);
  advance(s, { ...neutralInput(), thrust: 1 }, 2); assert.equal(s.z, -207); assert.equal(s.speed, 0);
  s.heading = Math.PI; advance(s, { ...neutralInput(), thrust: 1 }, 1); assert.ok(s.z > -207);
});
test('deterministic terrain has flat shelter floors and varying hills', () => {
  for (const s of shelters) { assert.equal(terrainHeight(s.x, s.z), 1.5); assert.equal(terrainHeight(s.x + 10, s.z), 1.5); }
  assert.equal(terrainHeight(35, 26), terrainHeight(35, 26));
  assert.notEqual(terrainHeight(35, 26), terrainHeight(80, 40));
  assert.equal(deadzone(0.1), 0); assert.equal(deadzone(-0.1), 0); assert.equal(deadzone(1), 1);
});

test('terrain clearance and mining share the actual raised laser origin on slopes', () => {
  const s = createState(), world = getLevelWorld('aster');
  s.x = 13.635612099385316; s.z = 20.44721337235155; s.heading = s.turret = 2.029203673205103;
  s.resources.deposits = s.resources.deposits.filter(d => d.id === 'aster-vein-1');
  const oldActor = { ...s, y: terrainHeight(s.x, s.z) + CONFIG.hoverHeight + 0.8 };
  assert.equal(findTarget(s.resources.deposits, oldActor, world), null, 'former flat-hover ray was terrain-occluded');
  advance(s, { ...neutralInput(), mine: true, aim: s.turret }, 1 / 120);
  assert.ok(s.surfacePose);
  const origin = vehicleLaserOrigin(s.surfacePose, s);
  assert.ok(origin.y > oldActor.y + 1.5);
  assert.equal(s.resources.targetId, 'aster-vein-1'); assert.ok(s.resources.laserActive);
  assert.ok(s.resources.deposits[0].progress > 0);
  assert.deepEqual({ x: s.surfacePose.x, z: s.surfacePose.z, heading: s.surfacePose.heading, elapsed: s.surfacePose.elapsed },
    { x: s.x, z: s.z, heading: s.heading, elapsed: s.elapsed });
});

test('surface pose freezes on pause and refreshes after external placement or a restart', () => {
  const s = createState(); advance(s, { ...neutralInput(), thrust: 1, steer: 0.4 }, 0.3);
  const frozen = structuredClone(s.surfacePose);
  advance(s, { ...neutralInput(), thrust: 1, steer: -1 }, 0);
  assert.deepEqual(s.surfacePose, frozen);
  s.x = 0; s.z = 0; setVelocity(s,0); s.heading = 2.4; s.yawRate=0;
  advance(s, neutralInput(), 1 / 120);
  const expected = vehiclePose((x, z) => terrainHeight(x, z), { x: s.x, z: s.z, heading: s.heading,
    hover: CONFIG.hoverHeight + Math.sin(s.elapsed * 3) * 0.09, bank: 0 }, null, 1 / 120);
  assert.ok(s.surfacePose); assert.deepEqual({ height: s.surfacePose.height, pitch: s.surfacePose.pitch, roll: s.surfacePose.roll }, expected);
  assert.equal(createState().surfacePose, null);
  const space = createState('belt'); advance(space, neutralInput(), 1 / 120); assert.equal(space.surfacePose, null);
});
test('results are equivalent at 30 and 144 render frames per second', () => {
  const a = createState(), b = createState();
  const input = { ...neutralInput(), thrust: 1, steer: 0.3 };
  for (let i = 0; i < 90; i++) advance(a, input, 1 / 30);
  for (let i = 0; i < 432; i++) advance(b, input, 1 / 144);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.15);
  assert.ok(Math.abs(a.speed - b.speed) < 0.05);
});
test('every sampled map location can turn, reach and brake within the warning window', () => {
  // Conservative pilot follows visibility-graph waypoints, stopping before each turn.
  for (let x = -207; x <= 207; x += 23) for (let z = -207; z <= 207; z += 23) {
    if (getLevelWorld().solids.some(wall => contains(wall, { x, z }, COLLISION.shipRadius + 0.2))) continue;
    const s = createState(); s.x = x; s.z = z; s.heading = Math.PI;
    const route = shelterRoute(s); assert.ok(route.points.length > 0);
    for (const goal of route.points) {
    if (isProtected(s) && Math.abs(s.speed) < 0.1) break;
    const desired = Math.atan2(goal.x - s.x, -(goal.z - s.z));
    let delta = Math.atan2(Math.sin(desired - s.heading), Math.cos(desired - s.heading));
    while(s.elapsed<12&&(Math.abs(delta)>.005||Math.abs(s.yawRate)>.03)) {
      advance(s,{...neutralInput(),steer:Math.max(-1,Math.min(1,delta*8-s.yawRate*.25))},1/120);
      delta=Math.atan2(Math.sin(desired-s.heading),Math.cos(desired-s.heading));
    }
    while (s.elapsed < 12 && !(Math.hypot(goal.x - s.x, goal.z - s.z) < 0.6 && Math.abs(s.speed) < 0.1) && !(isProtected(s) && Math.abs(s.speed) < 0.1)) {
      const d = Math.hypot(goal.x - s.x, goal.z - s.z);
      const brakingDistance = s.speed ** 2 / (2 * CONFIG.braking);
      const braking = d <= brakingDistance + 0.4 && s.speed > 0;
      // Stop at each waypoint; the next driving phase releases the brake.
      const dt = braking ? Math.min(1 / 120, s.speed / CONFIG.braking) : 1 / 120;
      advance(s, { ...neutralInput(), thrust: d > brakingDistance + 0.4 ? 1 : 0, brake: braking ? 1 : 0,
        steer: Math.max(-1,Math.min(1,Math.atan2(Math.sin(desired-s.heading),Math.cos(desired-s.heading))*8-s.yawRate*.25)) }, dt);
    }
    }
    assert.ok(isProtected(s) && Math.abs(s.speed) < 0.1, `shelter unreachable from ${x}/${z}, route ${JSON.stringify(route)}`);
    assert.equal(s.health, 100, `route from ${x}/${z} hit a wall`);
  }
});
