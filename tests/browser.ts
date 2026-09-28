import { World } from '../src/world';
import { Controls } from '../src/input';
import { advance, createState, neutralInput, phaseDuration } from '../src/simulation';
import { inventoryTotal, RESOURCES, RESOURCE_TYPES, type ResourceId, type Deposit } from '../src/resources';
import { getLevelWorld, groundHeight, type LevelId } from '../src/levels';
import * as THREE from 'three';
import { cliffFacing, cliffUplift, cliffUpliftGLSL } from '../src/geology';
import { checkTouchControls } from './touch-input';

const world = new World(document.getElementById('viewport')!);
const controls = new Controls(world.renderer.domElement, () => {});
const output = document.getElementById('results')!;
let state = createState();
const runButton = document.getElementById('run') as HTMLButtonElement;
runButton.disabled = true;
output.textContent = 'Loading shared GLB models and compressed textures…';
world.ready.then(() => {
  world.setQuality('high'); world.reset(state); world.render(state, 1 / 60, 0);
  output.textContent = 'Ready. Tests use controlled positions and the real simulation, keyboard controls and renderer.';
  runButton.disabled = false;
}).catch(error => { output.textContent = `ASSET LOAD FAILED: ${String(error)}`; });
const key = (code: string, down: boolean, repeat = false) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, repeat }));
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); output.textContent += `\nPASS ${message}`; }
function checkTerrainGPUParity() {
  const cliffs=getLevelWorld('aster').solids.filter(s=>s.kind==='cliff');
  const samples: number[]=[], expected: number[]=[];
  cliffs.forEach((c,index)=> {
    for(const along of [-56,-23,0,23,56]) for(const across of [-58,-30,-5,-.001,0,.001,5,15]) {
      const vertical=c.halfX<c.halfZ, sign=cliffFacing(c);
      const x=c.x+(vertical?across*sign:along), z=c.z+(vertical?along:across*sign);
      samples.push(x,z,index); expected.push(cliffUplift(c,x,z));
    }
  });
  const geometry=new THREE.BufferGeometry(), positions=expected.flatMap((_,i)=>[-1+(i+.5)*2/expected.length,0,0]);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('samplePoint',new THREE.Float32BufferAttribute(samples,3));
  const material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,blending:THREE.NoBlending,uniforms:{
    cliffs:{value:cliffs.map(c=>new THREE.Vector4(c.x,c.z,c.halfX,c.halfZ))},
    shapes:{value:cliffs.map(c=>new THREE.Vector2(c.height,cliffFacing(c)))},
  },vertexShader:`attribute vec3 samplePoint; uniform vec4 cliffs[6]; uniform vec2 shapes[6]; varying float height;
    ${cliffUpliftGLSL}
    void main(){int i=int(samplePoint.z);height=cliffUplift(cliffs[i],shapes[i],samplePoint.xy);gl_Position=vec4(position,1.0);gl_PointSize=1.0;}`,
  fragmentShader:'varying float height; void main(){gl_FragColor=vec4(height,0.0,0.0,1.0);}'});
  const scene=new THREE.Scene(), points=new THREE.Points(geometry,material); points.frustumCulled=false; scene.add(points);
  const target=new THREE.WebGLRenderTarget(expected.length,1,{type:THREE.FloatType,depthBuffer:false});
  const previous=world.renderer.getRenderTarget(), pixels=new Float32Array(expected.length*4);
  try {
    world.renderer.setRenderTarget(target); world.renderer.render(scene,new THREE.Camera());
    world.renderer.readRenderTargetPixels(target,0,0,expected.length,1,pixels);
    const error=Math.max(...expected.map((h,i)=>Math.abs(pixels[i*4]-h)));
    check(Number.isFinite(error)&&error<.001,`Storm GPU relief matches CPU terrain across ${expected.length} samples (error ${error.toFixed(6)} m)`);
  } finally { world.renderer.setRenderTarget(previous); geometry.dispose(); material.dispose(); target.dispose(); }
}
function step(seconds: number, aim: number | null = state.turret) {
  controls.pointer.active = aim !== null;
  advance(state, controls.read(aim), seconds); world.render(state, 1 / 60, 0);
}
function checkVehicleGroundClearance() {
  const s=createState(), terrain=getLevelWorld('aster'), ship=world.scene.getObjectByName('player-speeder')!;
  world.reset(s); let smallest=Infinity;
  // Real imported hull vertices, including the nose and both outer engine pods.
  for(const [x,z,heading] of [[25,36,0],[41,32,0],[55,14,1.5],[52,-7,0],[21,0,1.5],[-40,72,.4],[94,92,3],[110,55,1]]) {
    s.x=x;s.z=z;s.heading=heading;s.elapsed+=.05;world.render(s,1/20,0);
    ship.traverse(object=>{
      if(!(object instanceof THREE.Mesh)||!object.geometry.userData.shared)return;
      const positions=object.geometry.getAttribute('position'),p=new THREE.Vector3();
      for(let i=0;i<positions.count;i++) {
        p.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
        smallest=Math.min(smallest,p.y-groundHeight(terrain,p.x,p.z));
      }
    });
  }
  check(smallest>.15,`Real GLB hull clears slopes and crests during attitude changes (minimum ${smallest.toFixed(2)} m)`);
  const belt=createState('belt');world.reset(belt);world.render(belt,0,0);
  check(Math.abs(ship.rotation.x)<1e-8&&Math.abs(ship.rotation.z)<1e-8,'Space flight resets terrain pitch and roll');
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
async function checkDisposeDuringAssetLoad() {
  const host = document.createElement('div'); host.hidden = true; document.body.append(host);
  let probe: World | undefined;
  let timer: number | undefined;
  let onProgress: EventListener | undefined;
  try {
    probe = new World(host);
    const canvas = probe.renderer.domElement;
    let settled = false, disposedWhilePending = false, secondDisposeSucceeded = false;
    let disposalError: unknown;
    // Install both handlers immediately: cancellation deliberately rejects ready.
    const completion = probe.ready.then(() => { settled = true; }, () => { settled = true; });
    onProgress = event => {
      const { loaded, total } = (event as CustomEvent<{ loaded: number; total: number }>).detail;
      // There are only two GLBs. At completion #3 at least one texture has been
      // decoded, while more remain pending: exercise the active KTX2 worker path,
      // not just disposal before network requests or worker setup have started.
      if (loaded < 3 || loaded >= total || disposedWhilePending) return;
      disposedWhilePending = !settled;
      try { probe!.dispose(); probe!.dispose(); secondDisposeSucceeded = true; }
      catch (error) { disposalError = error; }
    };
    canvas.addEventListener('asset-progress', onProgress);
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('Disposed World.ready did not settle within 15 seconds')), 15_000);
    });
    await Promise.race([completion, timeout]);
    if (disposalError) throw disposalError;
    check(disposedWhilePending, 'World disposed after texture decoding began, before asset loading settled');
    check(settled, 'Disposed World.ready settles within 15 seconds');
    check(!canvas.isConnected && host.childElementCount === 0, 'Disposal removes the loading world canvas');
    check(secondDisposeSucceeded, 'Second dispose during asset loading is harmless');
    check(probe.assets.surfaces.size === 0, 'Late decoded surface textures are released after cancellation');
    check(!probe.scene.getObjectByName('mining_turret'), 'Cancelled loading does not instantiate a late speeder');
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    if (probe && onProgress) probe.renderer.domElement.removeEventListener('asset-progress', onProgress);
    probe?.dispose(); host.remove();
  }
}
document.getElementById('run')!.addEventListener('click', async () => {
  const button = document.getElementById('run') as HTMLButtonElement; button.disabled = true;
  output.textContent = 'Running controlled browser integration scenario…';
  try {
    await world.ready;
    await checkDisposeDuringAssetLoad();
    checkTerrainGPUParity();
    checkVehicleGroundClearance();
    checkTouchControls(controls,world.renderer.domElement,check);
    state = createState(); controls.clear();
    // Validate edge-triggered keyboard input, including repeat and release behavior.
    key('KeyE', true); check(controls.read(null).unloadPressed, 'E produces one unload press');
    check(!controls.read(null).unloadPressed, 'Held E does not repeat');
    key('KeyE', true, true); check(!controls.read(null).unloadPressed, 'Keyboard repeat does not unload'); key('KeyE', false);
    for (const code of ['KeyX', 'ShiftLeft', 'ShiftRight']) {
      key(code, true); check(controls.read(null).mine, `${code} activates laser`);
      key(code, false); check(!controls.read(null).mine, `${code} releases laser`);
    }
    for(const code of ['KeyS','ArrowDown','Space']) {
      key(code,true);check(controls.read(null).brake===1,`${code} activates brake/reverse`);
      const backward=createState();advance(backward,controls.read(null),.5);
      check(backward.speed<0&&backward.z>36,`${code} reverses slowly from standstill`);
      key(code,false);check(controls.read(null).brake===0,`${code} releases brake/reverse`);
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
      buttons[6].value=.45;check(controls.read(null).brake===.45,'Gamepad LT preserves analog brake/reverse input');
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
    const memory = new Map<string, { geometries: number; textures: number }>();
    for (let i = 0; i < 16; i++) {
      const id: LevelId = i % 2 === 0 ? 'aster' : 'belt', quality = i % 4 < 2 ? 'high' : 'standard';
      state = createState(id); world.setQuality(quality); world.reset(state); world.render(state, 1 / 60, 0);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      world.render(state, 1 / 60, 0);
      check(state.resources.deposits.every(d => d.id.startsWith(id)), `${id}: no previous-level deposits`);
      const usage = { ...world.renderer.info.memory }, key = `${id}/${quality}`, baseline = memory.get(key);
      if (baseline) check(usage.geometries === baseline.geometries && usage.textures === baseline.textures, `${key}: GPU geometry and texture counts stable after switch`);
      else memory.set(key, usage);
    }
    state = createState(); world.setQuality('high'); world.reset(state); world.render(state, 1 / 60, 0);
    const aimStart = performance.now();
    for (let i = 0; i < 30; i++) world.mouseAim({ x: 0.05, y: 0.25 }, state);
    output.textContent += `\nTerrain aim: ${((performance.now() - aimStart) / 30).toFixed(2)} ms/sample`;
    check(inventoryTotal(state.resources.storage) === 0 && !state.mission.completed, 'Restart clears cargo, storage and mission');
    output.textContent += '\n\nALL BROWSER CHECKS PASSED';
  } catch (error) { output.textContent += `\nFAIL ${String(error)}`; console.error(error); }
  finally { controls.clear(); button.disabled = false; }
});
