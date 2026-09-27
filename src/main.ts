import './style.css';
import { World } from './world';
import { Controls } from './input';
import { advance, CONFIG, createState, isProtected, nearestShelter, phaseDuration, shelters, terrainHeight } from './simulation';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="viewport"></div><div class="vignette"></div><div id="weather-wash"></div>
  <header class="topbar">
    <div class="brand"><span class="brand-mark">≋</span><div>WING GLIDER<small>PLANETARY EXPEDITION / 01</small></div></div>
    <div class="location"><span class="live-dot"></span> ASTER <span class="muted">/</span> NORTHERN LOWLANDS</div>
    <button id="pause" aria-label="Spiel pausieren">Ⅱ <span>PAUSE</span></button>
  </header>
  <aside class="mission"><p class="eyebrow">FREIER ERKUNDUNGSFLUG</p><h1>Unter freiem Himmel.</h1><p>Gleite über Aster. Finde Schutz,<br>bevor der nächste Sturm eintrifft.</p><div class="mission-rule"></div><span class="tiny">SEKTOR 07 <span class="muted">/</span> SPEeder MK. I</span></aside>
  <section class="weather" aria-label="Wetterstatus"><div class="weather-top"><span id="weather-dot" class="live-dot"></span><span id="phase-name">RUHIGES WETTER</span><span class="tiny">ATMOSPHÄRE</span></div><div class="weather-main"><span id="weather-message">Zeit zum Erkunden</span><strong id="countdown">00:45</strong></div><div class="track"><i id="phase-progress"></i></div><p id="weather-hint">Nächste Sturmwarnung in <span>45 s</span></p></section>
  <div class="compass"><span>W</span><i></i><span>N</span><i></i><span>E</span></div>
  <div id="shelter-guide"><span id="guide-arrow">↑</span><div><strong id="guide-name">SCHUTZMULDE S5</strong><small id="guide-distance">44 m</small></div></div>
  <section class="telemetry"><p class="eyebrow">SPEEDER <span class="muted">/ MK. I</span></p><div class="speed-line"><strong id="speed">000</strong><span>KM/H<br><small id="drive-state">BEREIT</small></span></div><div class="speed-ticks"><i id="speed-fill"></i></div><div class="hull"><span>HÜLLE</span><strong id="health-value">100%</strong></div><div class="track health-track"><i id="health-fill"></i></div><div id="safety"><span>◇</span> UNGESCHÜTZT</div></section>
  <section class="navigation"><div class="map-heading"><span class="eyebrow">GELÄNDERADAR</span><span id="coordinates">025 / 036</span></div><canvas id="minimap" width="240" height="200" aria-label="Karte mit Schutzmulden und Fahrzeugposition"></canvas><div class="map-footer"><span><i></i> SCHUTZMULDE</span><span>420 × 420 M</span></div></section>
  <footer><div class="controls keyboard"><span><kbd>W</kbd> Schub</span><span><kbd>A</kbd><kbd>D</kbd> Lenken</span><span><kbd>SPACE</kbd> Bremse</span><span><kbd>MAUS</kbd> Turm</span></div><div class="controls gamepad" hidden><span><kbd>RT</kbd> Schub</span><span><kbd>LS</kbd> Lenken</span><span><kbd>LT</kbd> Bremse</span><span><kbd>RS</kbd> Turm</span></div><span id="input-device">TASTATUR + MAUS <i class="live-dot"></i></span></footer>
  <div id="overlay" hidden><section class="dialog"><p class="eyebrow" id="dialog-kicker">FLUG UNTERBROCHEN</p><h2 id="dialog-title">Kurze Verschnaufpause.</h2><p id="dialog-body">Dein Speeder wartet auf dich.</p><button id="resume" class="primary">Weiterfliegen <span>↗</span></button><button id="restart">Neue Expedition</button></section></div>
`;

const el = (id: string) => document.getElementById(id)!;
let state = createState();
let paused = false;
let world: World;
try { world = new World(el('viewport')); }
catch (error) {
  el('overlay').hidden = false; el('dialog-title').textContent = '3D-Darstellung nicht verfügbar.';
  el('dialog-body').textContent = 'Bitte öffne das Spiel in einem Browser mit WebGL 2 und aktiviere die Hardwarebeschleunigung.';
  el('resume').hidden = true; el('restart').hidden = true;
  throw error;
}
function showDialog() {
  el('overlay').hidden = !paused && !state.dead;
  el('dialog-kicker').textContent = state.dead ? 'SIGNAL VERLOREN' : 'FLUG UNTERBROCHEN';
  el('dialog-title').textContent = state.dead ? 'Der Sturm war stärker.' : 'Kurze Verschnaufpause.';
  el('dialog-body').textContent = state.dead ? `${Math.floor(state.distance)} Meter erkundet · ${state.storms} Stürme überstanden. Suche beim nächsten Mal rechtzeitig eine Schutzmulde.` : 'Dein Speeder wartet auf dich. Mit Escape geht es weiter.';
  el('resume').hidden = state.dead;
  el('pause').textContent = paused ? '▷ WEITER' : 'Ⅱ PAUSE';
  el('pause').setAttribute('aria-label', paused ? 'Spiel fortsetzen' : 'Spiel pausieren');
}
function togglePause() { if (!state.dead) { paused = !paused; controls.clear(); showDialog(); } }
const controls = new Controls(world.renderer.domElement, togglePause);
el('pause').addEventListener('click', togglePause);
el('resume').addEventListener('click', togglePause);
el('restart').addEventListener('click', () => {
  state = createState(); paused = false; controls.clear(); world.reset(state); showDialog();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !state.dead) { paused = true; showDialog(); }
});
world.renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault(); paused = true; showDialog();
  el('dialog-title').textContent = 'Grafikverbindung unterbrochen.';
  el('dialog-body').textContent = 'Bitte lade die Seite neu, um die 3D-Darstellung wiederherzustellen.';
  el('resume').hidden = true; el('restart').hidden = true;
});

const map = el('minimap') as HTMLCanvasElement;
const ctx = map.getContext('2d')!;
const mapBase = document.createElement('canvas'); mapBase.width = 240; mapBase.height = 200;
const baseCtx = mapBase.getContext('2d')!;
for (let y = 0; y < 200; y += 2) for (let x = 0; x < 240; x += 2) {
  const h = terrainHeight((x / 240 - 0.5) * 420, (y / 200 - 0.5) * 420);
  const v = 25 + h * 1.5; baseCtx.fillStyle = `rgb(${v},${v + 10},${v + 5})`; baseCtx.fillRect(x, y, 2, 2);
}
function drawMap() {
  ctx.drawImage(mapBase, 0, 0);
  ctx.strokeStyle = '#bce1c014'; ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath(); ctx.moveTo(i * 40, 0); ctx.lineTo(i * 40, 200); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 33.33); ctx.lineTo(240, i * 33.33); ctx.stroke();
  }
  for (const s of shelters) {
    ctx.beginPath(); ctx.arc((s.x / 420 + 0.5) * 240, (s.z / 420 + 0.5) * 200, 5.7, 0, Math.PI * 2);
    ctx.strokeStyle = '#a6d9b8'; ctx.stroke(); ctx.fillStyle = '#93caab22'; ctx.fill();
  }
  const x = (state.x / 420 + 0.5) * 240, y = (state.z / 420 + 0.5) * 200;
  const nearest = nearestShelter(state);
  if (state.phase !== 'calm') {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo((nearest.x / 420 + 0.5) * 240, (nearest.z / 420 + 0.5) * 200);
    ctx.strokeStyle = '#ebbb76'; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(state.heading);
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 3); ctx.lineTo(-4, 5); ctx.closePath();
  ctx.fillStyle = '#fff1cd'; ctx.fill(); ctx.restore();
}
function updateHud(thrust: number, brake: number) {
  const protectedNow = isProtected(state), timeLeft = Math.ceil(phaseDuration(state.phase) - state.phaseTime);
  el('speed').textContent = String(Math.round(state.speed * 3.6)).padStart(3, '0');
  el('drive-state').textContent = brake ? 'BREMSE' : thrust ? 'SCHUB' : state.speed > 0.1 ? 'GLEITFLUG' : 'BEREIT';
  el('speed-fill').style.width = `${state.speed / CONFIG.maxSpeed * 100}%`;
  el('health-value').textContent = `${Math.ceil(state.health)}%`;
  el('health-fill').style.width = `${state.health}%`;
  el('health-fill').style.background = state.health < 35 ? '#ed956f' : '#c5d7b3';
  el('safety').innerHTML = protectedNow ? '<span>◈</span> IN DER SCHUTZMULDE' : '<span>◇</span> UNGESCHÜTZT';
  el('safety').classList.toggle('safe', protectedNow);
  el('countdown').textContent = `00:${String(timeLeft).padStart(2, '0')}`;
  el('phase-progress').style.width = `${(1 - state.phaseTime / phaseDuration(state.phase)) * 100}%`;
  document.body.dataset.weather = state.phase;
  el('phase-name').textContent = { calm: 'RUHIGES WETTER', warning: 'STURMWARNUNG', storm: 'STURM AKTIV' }[state.phase];
  el('weather-message').textContent = { calm: 'Zeit zum Erkunden', warning: 'Suche eine Schutzmulde', storm: protectedNow ? 'Hier bist du geschützt' : 'Gefahr · Hülle nimmt Schaden' }[state.phase];
  el('weather-hint').textContent = state.phase === 'calm' ? `Nächste Sturmwarnung in ${timeLeft} s` : state.phase === 'warning' ? `Sturmfront erreicht den Sektor in ${timeLeft} s` : `Sturm zieht in ${timeLeft} s ab`;
  const nearest = nearestShelter(state), d = Math.hypot(nearest.x - state.x, nearest.z - state.z);
  el('guide-name').textContent = protectedNow ? 'GESCHÜTZTER BEREICH' : `SCHUTZMULDE ${nearest.name}`;
  el('guide-distance').textContent = protectedNow ? 'Bremsen & Sturm abwarten' : `${Math.round(d)} m · ${state.phase === 'calm' ? 'Zuflucht' : 'Schutz suchen'}`;
  el('guide-arrow').style.transform = `rotate(${Math.atan2(nearest.x - state.x, -(nearest.z - state.z))}rad)`;
  el('coordinates').textContent = `${Math.round(state.x).toString().padStart(3, '0')} / ${Math.round(state.z).toString().padStart(3, '0')}`;
  el('input-device').innerHTML = `${controls.gamepadConnected ? 'GAMEPAD VERBUNDEN' : 'TASTATUR + MAUS'} <i class="live-dot"></i>`;
  document.querySelector<HTMLElement>('.keyboard')!.hidden = controls.gamepadConnected;
  document.querySelector<HTMLElement>('.gamepad')!.hidden = !controls.gamepadConnected;
  drawMap();
}
let previous = performance.now(), hudClock = 0;
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000, 0.05); previous = now;
  const input = controls.read(world.mouseAim(controls.pointer, state));
  if (!paused && !state.dead && !document.hidden) {
    advance(state, input, dt);
    if (state.dead) { controls.clear(); showDialog(); }
  }
  world.render(state, paused || state.dead ? 0 : dt, input.brake ? 0 : input.thrust);
  hudClock += dt;
  if (hudClock > 0.06) { updateHud(input.thrust, input.brake); hudClock = 0; }
  requestAnimationFrame(frame);
}
world.render(state, 0.016, 0); updateHud(0, 0); requestAnimationFrame(frame);
