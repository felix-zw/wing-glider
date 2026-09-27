import { World } from '../src/world';
import { Controls } from '../src/input';
import { advance, createState, neutralInput, phaseDuration } from '../src/simulation';
import { inventoryTotal, RESOURCES, RESOURCE_TYPES, type ResourceId, type Deposit } from '../src/resources';
import { getLevelWorld, type LevelId } from '../src/levels';

const world = new World(document.getElementById('viewport')!);
const controls = new Controls(world.renderer.domElement, () => {});
const output = document.getElementById('results')!;
let state = createState();
world.reset(state); world.render(state, 1 / 60, 0);
const key = (code: string, down: boolean, repeat = false) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, repeat }));
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); output.textContent += `\nPASS ${message}`; }
function step(seconds: number, aim: number | null = state.turret) {
  controls.pointer.active = aim !== null;
  advance(state, controls.read(aim), seconds); world.render(state, 1 / 60, 0);
}
function deliver() {
  state.x = 0; state.z = 0; state.speed = 0;
  key('KeyE', true); step(0.01); key('KeyE', false);
}
function weatherBreak() {
  state.x = 0; state.z = 0;
  if (state.environment.kind === 'space') return;
  if (state.phase === 'calm') advance(state, neutralInput(), phaseDuration(state.phase) - state.phaseTime);
  while (state.phase !== 'calm') advance(state, neutralInput(), phaseDuration(state.phase) - state.phaseTime);
}
function placeNear(d: Deposit) {
  state.x = d.x + d.surface!.nx * 5; state.z = d.z + d.surface!.nz * 5; state.speed = 0;
  state.turret = Math.atan2(d.x - state.x, -(d.z - state.z));
}
document.getElementById('run')!.addEventListener('click', async () => {
  const button = document.getElementById('run') as HTMLButtonElement; button.disabled = true;
  output.textContent = 'Running controlled browser integration scenario…';
  try {
    state = createState(); controls.clear();
    // Validate edge-triggered keyboard input, including repeat and release behavior.
    key('KeyE', true); check(controls.read(null).unloadPressed, 'E produces one unload press');
    check(!controls.read(null).unloadPressed, 'Held E does not repeat');
    key('KeyE', true, true); check(!controls.read(null).unloadPressed, 'Keyboard repeat does not unload'); key('KeyE', false);
    for (const code of ['KeyX', 'ShiftLeft', 'ShiftRight']) {
      key(code, true); check(controls.read(null).mine, `${code} activates laser`);
      key(code, false); check(!controls.read(null).mine, `${code} releases laser`);
    }
    key('KeyX', true); key('KeyE', true); controls.clear();
    check(!controls.read(null).mine && !controls.read(null).unloadPressed, 'Input clear cancels held and queued actions');
    key('KeyX', false); key('KeyE', false);
    const originalGamepads = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
    const buttons = Array.from({ length: 8 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons };
    try {
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
      buttons[5].pressed = true; buttons[3].pressed = true;
      const pressed = controls.read(null); check(pressed.mine && pressed.unloadPressed, 'Standard gamepad RB mines and Y unloads');
      check(!controls.read(null).unloadPressed, 'Held gamepad Y does not repeat');
      buttons[5].pressed = false; buttons[3].pressed = false;
      check(!controls.read(null).mine, 'Gamepad bumper release stops mining');
      buttons[3].pressed = true; check(controls.read(null).unloadPressed, 'Gamepad Y rearms after release');
    } finally {
      if (originalGamepads) Object.defineProperty(navigator, 'getGamepads', originalGamepads);
      else Reflect.deleteProperty(navigator, 'getGamepads');
      controls.read(null);
    }
    for (const levelId of ['aster', 'belt'] as const) {
    state = createState(levelId); world.reset(state);
    // Resource tour uses controlled positions; hazard encounters are exercised separately below.
    if (state.environment.kind === 'space') state.environment.asteroids = [];
    output.textContent += `\n\nLEVEL: ${levelId}`;
    const quotas: Record<ResourceId, number> = { ferrite: 30, copper: 20, crystal: 10 };
    for (const resource of RESOURCE_TYPES) {
      let mined = 0;
      for (const d of state.resources.deposits.filter(d => d.resource === resource)) {
        if (mined >= quotas[resource]) break;
        weatherBreak(); placeNear(d);
        const count = Math.min(12, quotas[resource] - mined);
        key('KeyX', true); step(count * RESOURCES[resource].seconds); key('KeyX', false); step(1.2);
        mined += count;
        check(d.remaining === 12 - count, `${resource}: ${count} units mined with keyboard laser`);
      }
      if (resource === 'ferrite') {
        check(inventoryTotal(state.resources.cargo) === 30, 'Cargo reaches 30 units');
        check(!state.mission.completed && !state.mission.counts['ferrite-delivery'], 'Onboard resources do not count as delivered');
        // An extra unit remains loose while full, then becomes collectible after unloading.
        const d = state.resources.deposits.find(d => d.resource === resource && d.remaining > 0)!;
        placeNear(d); key('ShiftLeft', true); step(1); key('ShiftLeft', false); step(1);
        check(inventoryTotal(state.resources.cargo) === 30 && state.resources.fragments.length === 1, 'Full cargo leaves mined fragments in the world');
        const x = state.x, z = state.z;
        key('KeyE', true); step(0.01); key('KeyE', false);
        check(state.resources.storage.ferrite === 0, 'E outside loading zone cannot deliver');
        deliver(); check(state.resources.storage.ferrite === 30, 'First delivery credits 30 ferrite');
        state.x = x; state.z = z; step(1);
        check(state.resources.cargo.ferrite === 1 && state.resources.fragments.length === 0, 'Leftover fragment is collected after unloading');
        deliver();
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    check(inventoryTotal(state.resources.cargo) === 30, 'Second mixed load contains 20 copper and 10 crystals');
    deliver(); check(state.mission.completed, 'All delivery objectives complete');
    check(inventoryTotal(state.resources.storage) === 61, 'All deliveries, including surplus, retained in ATLAS');
    const completion = state.mission.completedAt;
    const d = state.resources.deposits.find(d => d.resource === 'crystal' && d.remaining > 0)!;
    weatherBreak(); placeNear(d); key('ShiftRight', true); step(1.8); key('ShiftRight', false); step(1.2); deliver();
    check(state.mission.completedAt === completion && state.resources.storage.crystal === 11, 'Continue mining and delivering after completion');
    const snapshot = JSON.stringify(state); advance(state, { ...neutralInput(), mine: true, unloadPressed: true }, 0);
    check(JSON.stringify(state) === snapshot, 'Zero-time pause freezes gameplay');
    }
    state = createState('aster'); state.x = -5; state.z = 45; state.heading = -Math.PI / 2; state.speed = 38;
    step(1); check(state.lastDamage === 'wall' && state.x > -17.51, 'Aster walls stop the ship and cause impact damage');
    state = createState('belt'); world.reset(state); state.x = -10; state.z = 80;
    if (state.environment.kind === 'space') state.environment.asteroids = [{ id: 0, x: -10, z: 65, radius: 2, vx: 0, vz: 12, rotation: 0, respawns: 0 }];
    step(1.5); check(state.health < 100 && state.lastDamage === 'asteroid', 'Moving asteroids collide with the ship');
    const memory = new Map<LevelId, { geometries: number; textures: number }>();
    for (let i = 0; i < 8; i++) {
      const id: LevelId = i % 2 === 0 ? 'aster' : 'belt'; state = createState(id); world.reset(state); world.render(state, 1 / 60, 0);
      check(state.resources.deposits.every(d => d.id.startsWith(id)), `${id}: no previous-level deposits`);
      const usage = { ...world.renderer.info.memory }, baseline = memory.get(id);
      if (baseline) check(usage.geometries === baseline.geometries && usage.textures === baseline.textures, `${id}: GPU geometry and texture counts stable after switch`);
      else memory.set(id, usage);
    }
    state = createState(); world.reset(state); world.render(state, 1 / 60, 0);
    const aimStart = performance.now();
    for (let i = 0; i < 30; i++) world.mouseAim({ x: 0.05, y: 0.25 }, state);
    output.textContent += `\nTerrain aim: ${((performance.now() - aimStart) / 30).toFixed(2)} ms/sample`;
    check(inventoryTotal(state.resources.storage) === 0 && !state.mission.completed, 'Restart clears cargo, storage and mission');
    output.textContent += '\n\nALL BROWSER CHECKS PASSED';
  } catch (error) { output.textContent += `\nFAIL ${String(error)}`; console.error(error); }
  finally { controls.clear(); button.disabled = false; }
});
