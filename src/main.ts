import './style.css';
import { World } from './world';
import { Controls } from './input';
import { advance, CONFIG, createState, isProtected, nearestShelter, phaseDuration, shelters, terrainHeight } from './simulation';
import { RESOURCE_CONFIG as R, TRANSPORTER } from './config';
import { RESOURCE_TYPES, RESOURCES, baseDistance, inventoryTotal } from './resources';
import { FIRST_MISSION, objectiveCounts } from './missions';
import { LEVELS, getLevelWorld, groundHeight, type LevelId } from './levels';
import { shelterRoute } from './navigation';

let objectives = objectiveCounts(FIRST_MISSION.objective);
const objectiveMarkup = () => objectives.map(o => `<div class="objective" style="--ore:${o.resource ? RESOURCES[o.resource].color : '#c5d7b3'}"><div><span><i class="ore-dot"></i>${o.label}</span><strong id="goal-${o.id}">0 / ${o.amount}</strong></div><div class="track"><i id="goal-fill-${o.id}"></i></div></div>`).join('');

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="viewport"></div><div class="vignette"></div><div id="weather-wash"></div>
  <header class="topbar">
    <div class="brand"><span class="brand-mark">≋</span><div>WING GLIDER<small>PLANETARY EXPEDITION / 01</small></div></div>
    <div class="location" id="location"><span class="live-dot"></span> ASTER / BERGE & SCHLUCHTEN</div>
    <button id="pause" aria-label="Spiel pausieren">Ⅱ <span>PAUSE</span></button>
  </header>
  <aside class="mission" aria-label="Lieferauftrag und Fracht">
    <p class="eyebrow" id="mission-status">AUFTRAG 01 / ATLAS</p><h1 id="mission-title">${FIRST_MISSION.title}</h1>
    <p class="mission-description">Abbauen. Einsammeln. An ATLAS liefern.</p>
    <div class="objectives" id="objectives">${objectiveMarkup()}</div>
    <div class="cargo-heading"><span>FRACHTRAUM</span><strong id="cargo-total">0 / ${R.capacity}</strong></div>
    <div class="track cargo-track"><i id="cargo-fill"></i></div>
    <div class="cargo-types">${RESOURCE_TYPES.map(id => `<span style="--ore:${RESOURCES[id].color}" title="${RESOURCES[id].name}"><i class="ore-dot"></i>${RESOURCES[id].name} <strong id="cargo-${id}">0</strong></span>`).join('')}</div>
    <div id="storage-total">ATLAS-LAGER · 0 EINHEITEN</div>
  </aside>
  <section class="weather" aria-label="Wetterstatus"><div class="weather-top"><span id="weather-dot" class="live-dot"></span><span id="phase-name">RUHIGES WETTER</span><span class="tiny">ATMOSPHÄRE</span></div><div class="weather-main"><span id="weather-message">Zeit zum Erkunden</span><strong id="countdown">00:45</strong></div><div class="track"><i id="phase-progress"></i></div><p id="weather-hint">Nächste Sturmwarnung in <span>45 s</span></p></section>
  <div class="compass"><span>W</span><i></i><span>N</span><i></i><span>E</span></div>
  <div id="shelter-guide"><span id="guide-arrow">↑</span><div><strong id="guide-name">SCHUTZMULDE S5</strong><small id="guide-distance">44 m</small></div></div>
  <section class="telemetry"><p class="eyebrow">SPEEDER <span class="muted">/ MK. I</span></p><div class="speed-line"><strong id="speed">000</strong><span>KM/H<br><small id="drive-state">BEREIT</small></span></div><div class="speed-ticks"><i id="speed-fill"></i></div><div class="hull"><span>HÜLLE</span><strong id="health-value">100%</strong></div><div class="track health-track"><i id="health-fill"></i></div><div id="safety"><span>◇</span> UNGESCHÜTZT</div></section>
  <section class="navigation"><div class="map-heading"><span class="eyebrow">GELÄNDERADAR</span><span id="coordinates">025 / 036</span></div><canvas id="minimap" width="240" height="200" aria-label="Karte mit Schutzmulden, Rohstoffen, ATLAS und Fahrzeugposition"></canvas><div class="map-footer"><span>○ SCHUTZ · ◇ ERZ · ▣ ATLAS</span><span>420 × 420 M</span></div></section>
  <section class="interaction" aria-label="Abbau und Entladen"><div class="interaction-top"><strong id="interaction-title">ERZ-LASER BEREIT</strong><span id="base-distance"></span></div><p id="interaction-hint">Auf ein Vorkommen zielen · X oder Shift halten.</p><div class="track"><i id="mining-fill"></i></div></section>
  <div id="mission-success" role="status" hidden>AUFTRAG ERFÜLLT <span>ATLAS ist versorgt. Deine Expedition geht weiter.</span></div>
  <footer><div class="controls keyboard"><span><kbd>W</kbd> Schub</span><span><kbd>A</kbd><kbd>D</kbd> Lenken</span><span><kbd>SPACE</kbd> Bremse</span><span><kbd>MAUS</kbd> Zielen</span><span><kbd>X / SHIFT</kbd> Abbau</span><span><kbd>E</kbd> Entladen</span></div><div class="controls gamepad" hidden><span><kbd>RT</kbd> Schub</span><span><kbd>LS</kbd> Lenken</span><span><kbd>LT</kbd> Bremse</span><span><kbd>RS</kbd> Zielen</span><span><kbd>RB</kbd> Abbau</span><span><kbd>Y</kbd> Entladen</span></div><span id="input-device">TASTATUR + MAUS <i class="live-dot"></i></span></footer>
  <div id="overlay" hidden><section class="dialog"><p class="eyebrow" id="dialog-kicker">FLUG UNTERBROCHEN</p><h2 id="dialog-title">Kurze Verschnaufpause.</h2><p id="dialog-body">Dein Speeder wartet auf dich.</p><button id="resume" class="primary">Weiterfliegen <span>↗</span></button><button id="restart">Level neu starten</button><button id="choose-level">Level wählen</button></section></div>
  <div id="level-select" role="dialog" aria-modal="true" aria-label="Level auswählen"><section class="level-dialog"><p class="eyebrow">WING GLIDER / EXPEDITIONEN</p><h2>Wohin führt dein Flug?</h2><p class="level-intro">Zwei Welten. Ein Auftrag: wertvolle Rohstoffe zu ATLAS bringen.</p><div class="level-cards">${Object.values(LEVELS).map(level => `<button class="level-card ${level.id}" data-level="${level.id}" aria-label="${level.name} starten"><div class="level-art" aria-hidden="true"><i></i><i></i><i></i></div><small>${level.subtitle}</small><strong>${level.name}</strong><p>${level.description}</p><span>EXPEDITION STARTEN ↗</span></button>`).join('')}</div><p class="level-note">Jeder Start beginnt mit leerer Fracht und einem neuen Auftrag. Die laufende Expedition wird zurückgesetzt.</p><button id="cancel-level" hidden>Zurück zur Expedition</button></section></div>
`;

const el = (id: string) => document.getElementById(id)!;
let state = createState();
let paused = true, choosing = true, hasExpedition = false;
let escapeRoute: ReturnType<typeof shelterRoute> | null = null, routeTime = -1;
let world: World;
try { world = new World(el('viewport')); }
catch (error) {
  el('level-select').hidden = true;
  el('overlay').hidden = false; el('dialog-title').textContent = '3D-Darstellung nicht verfügbar.';
  el('dialog-body').textContent = 'Bitte öffne das Spiel in einem Browser mit WebGL 2 und aktiviere die Hardwarebeschleunigung.';
  el('resume').hidden = true; el('restart').hidden = true;
  throw error;
}
function showDialog() {
  el('level-select').hidden = !choosing;
  el('pause').hidden = choosing;
  el('cancel-level').hidden = !hasExpedition || state.dead;
  el('overlay').hidden = choosing || (!paused && !state.dead);
  el('dialog-kicker').textContent = state.dead ? 'SIGNAL VERLOREN' : 'FLUG UNTERBROCHEN';
  el('dialog-title').textContent = state.dead ? state.lastDamage === 'storm' ? 'Der Sturm war stärker.' : state.lastDamage === 'wall' ? 'Aufprall an der Felswand.' : 'Kollision im Asteroidengürtel.' : 'Kurze Verschnaufpause.';
  el('dialog-body').textContent = state.dead ? `${Math.floor(state.distance)} Meter erkundet · ${inventoryTotal(state.resources.storage)} Einheiten geliefert. ${state.environment.kind === 'space' ? 'Achte auf bewegte Asteroiden. Bei ATLAS bist du geschützt.' : 'Nutze die Durchgänge zwischen den Felswänden und suche rechtzeitig Schutz.'}` : 'Dein Speeder wartet auf dich. Mit Escape geht es weiter.';
  el('resume').hidden = state.dead;
  el('pause').textContent = paused ? '▷ WEITER' : 'Ⅱ PAUSE';
  el('pause').setAttribute('aria-label', paused ? 'Spiel fortsetzen' : 'Spiel pausieren');
}
function togglePause() { if (!state.dead && !choosing) { paused = !paused; controls.clear(); showDialog(); } }
const controls = new Controls(world.renderer.domElement, togglePause);
el('pause').addEventListener('click', togglePause);
el('resume').addEventListener('click', togglePause);
function startLevel(id: LevelId) {
  state = createState(id); paused = false; choosing = false; hasExpedition = true; controls.clear(); world.reset(state);
  escapeRoute = null; routeTime = -1;
  objectives = objectiveCounts(LEVELS[id].mission.objective); el('objectives').innerHTML = objectiveMarkup();
  el('mission-title').textContent = LEVELS[id].mission.title;
  el('location').textContent = `${LEVELS[id].name.toUpperCase()} / ${LEVELS[id].subtitle}`;
  document.title = `Wing Glider — ${LEVELS[id].name}`;
  document.querySelector('.brand small')!.textContent = id === 'belt' ? 'SPACE EXPEDITION / 02' : 'PLANETARY EXPEDITION / 01';
  document.querySelector('.map-heading .eyebrow')!.textContent = id === 'belt' ? 'SEKTORRADAR' : 'GELÄNDERADAR';
  document.querySelector('.map-footer span')!.textContent = id === 'belt' ? '○ SCHILD · ◇ ERZ · • GEFAHR' : '○ SCHUTZ · ◇ ERZ · ▣ ATLAS';
  el('minimap').setAttribute('aria-label', id === 'belt' ? 'Karte mit Asteroiden, Erzadern, ATLAS und Fahrzeugposition' : 'Karte mit Schutzmulden, Rohstoffen, ATLAS und Fahrzeugposition');
  document.body.dataset.level = id; rebuildMap(); showDialog(); world.render(state, 0, 0); updateHud(0, 0);
}
el('restart').addEventListener('click', () => startLevel(state.levelId));
el('choose-level').addEventListener('click', () => { choosing = true; paused = true; controls.clear(); showDialog(); });
el('cancel-level').addEventListener('click', () => { choosing = false; showDialog(); });
document.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(button => button.addEventListener('click', () => startLevel(button.dataset.level as LevelId)));
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
function rebuildMap() {
const level = getLevelWorld(state.levelId);
baseCtx.fillStyle = '#101526'; baseCtx.fillRect(0, 0, 240, 200);
if (state.environment.kind === 'planet') for (let y = 0; y < 200; y += 2) for (let x = 0; x < 240; x += 2) {
  const h = groundHeight(level, (x / 240 - 0.5) * 420, (y / 200 - 0.5) * 420);
  const v = 25 + h * 1.5; baseCtx.fillStyle = `rgb(${v},${v + 10},${v + 5})`; baseCtx.fillRect(x, y, 2, 2);
}
for (const s of level.solids) {
  const x = (s.x / 420 + 0.5) * 240, y = (s.z / 420 + 0.5) * 200;
  baseCtx.fillStyle = '#80838c'; baseCtx.strokeStyle = '#b8b9ba';
  if (s.kind === 'cliff') { baseCtx.fillRect(x - s.halfX / 420 * 240, y - s.halfZ / 420 * 200, s.halfX / 420 * 480, s.halfZ / 420 * 400); }
  else { baseCtx.beginPath(); baseCtx.ellipse(x, y, s.radius / 420 * 240, s.radius / 420 * 200, 0, 0, Math.PI * 2); baseCtx.fill(); baseCtx.stroke(); }
}
}
rebuildMap();
function drawMap() {
  ctx.drawImage(mapBase, 0, 0);
  ctx.strokeStyle = '#bce1c014'; ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath(); ctx.moveTo(i * 40, 0); ctx.lineTo(i * 40, 200); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 33.33); ctx.lineTo(240, i * 33.33); ctx.stroke();
  }
  for (const s of getLevelWorld(state.levelId).shelters) {
    ctx.beginPath(); ctx.arc((s.x / 420 + 0.5) * 240, (s.z / 420 + 0.5) * 200, 5.7, 0, Math.PI * 2);
    ctx.strokeStyle = '#a6d9b8'; ctx.stroke(); ctx.fillStyle = '#93caab22'; ctx.fill();
  }
  if (state.environment.kind === 'space') for (const a of state.environment.asteroids) {
    const x = (a.x / 420 + 0.5) * 240, y = (a.z / 420 + 0.5) * 200;
    ctx.strokeStyle = '#ffa887'; ctx.fillStyle = '#ffa887'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + a.vx * 0.8, y + a.vz * 0.65); ctx.stroke();
  }
  for (const d of state.resources.deposits) {
    if (!d.remaining) continue;
    const px = (d.x / 420 + 0.5) * 240, py = (d.z / 420 + 0.5) * 200;
    ctx.fillStyle = RESOURCES[d.resource].color;
    ctx.beginPath(); ctx.moveTo(px, py - 2.8); ctx.lineTo(px + 2.8, py); ctx.lineTo(px, py + 2.8); ctx.lineTo(px - 2.8, py); ctx.closePath(); ctx.fill();
  }
  for (const f of state.resources.fragments) {
    ctx.fillStyle = RESOURCES[f.resource].color; ctx.fillRect((f.x / 420 + 0.5) * 240, (f.z / 420 + 0.5) * 200, 1.3, 1.3);
  }
  ctx.strokeStyle = '#ffdc9d'; ctx.lineWidth = 1.5; ctx.strokeRect(115.5, 95.5, 9, 9);
  const x = (state.x / 420 + 0.5) * 240, y = (state.z / 420 + 0.5) * 200;
  const nearest = nearestShelter(state);
  if (state.environment.kind === 'planet' && state.phase !== 'calm') {
    ctx.beginPath(); ctx.moveTo(x, y);
    for (const p of escapeRoute?.points ?? [nearest]) ctx.lineTo((p.x / 420 + 0.5) * 240, (p.z / 420 + 0.5) * 200);
    ctx.strokeStyle = '#ebbb76'; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  else if (inventoryTotal(state.resources.cargo) > 0) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(120, 100); ctx.setLineDash([3, 4]); ctx.strokeStyle = '#ffdc9d'; ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(state.heading);
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 3); ctx.lineTo(-4, 5); ctx.closePath();
  ctx.fillStyle = '#fff1cd'; ctx.fill(); ctx.restore();
}
function updateHud(thrust: number, brake: number) {
  updateResourceHud();
  const protectedNow = isProtected(state), timeLeft = Math.ceil(phaseDuration(state.phase) - state.phaseTime);
  el('speed').textContent = String(Math.round(state.speed * 3.6)).padStart(3, '0');
  el('drive-state').textContent = brake ? 'BREMSE' : thrust ? 'SCHUB' : state.speed > 0.1 ? 'GLEITFLUG' : 'BEREIT';
  el('speed-fill').style.width = `${state.speed / CONFIG.maxSpeed * 100}%`;
  el('health-value').textContent = `${Math.ceil(state.health)}%`;
  el('health-fill').style.width = `${state.health}%`;
  el('health-fill').style.background = state.health < 35 ? '#ed956f' : '#c5d7b3';
  const space = state.environment.kind === 'space';
  el('safety').innerHTML = protectedNow ? space ? '<span>◈</span> ATLAS-SCHUTZFELD' : '<span>◈</span> IN DER SCHUTZMULDE' : '<span>◇</span> UNGESCHÜTZT';
  el('safety').classList.toggle('safe', protectedNow);
  el('countdown').textContent = `00:${String(timeLeft).padStart(2, '0')}`;
  el('phase-progress').style.width = `${(1 - state.phaseTime / phaseDuration(state.phase)) * 100}%`;
  document.body.dataset.weather = state.phase;
  el('phase-name').textContent = { calm: 'RUHIGES WETTER', warning: 'STURMWARNUNG', storm: 'STURM AKTIV' }[state.phase];
  el('weather-message').textContent = { calm: 'Zeit zum Erkunden', warning: 'Suche eine Schutzmulde', storm: protectedNow ? 'Hier bist du geschützt' : 'Gefahr · Hülle nimmt Schaden' }[state.phase];
  el('weather-hint').textContent = state.phase === 'calm' ? `Nächste Sturmwarnung in ${timeLeft} s` : state.phase === 'warning' ? `Sturmfront erreicht den Sektor in ${timeLeft} s` : `Sturm zieht in ${timeLeft} s ab`;
  if (state.environment.kind === 'space') {
    const distance = Math.min(...state.environment.asteroids.map(a => Math.hypot(a.x - state.x, a.z - state.z) - a.radius));
    const danger = distance < 45 && !protectedNow;
    document.body.dataset.weather = danger ? 'warning' : 'calm';
    el('phase-name').textContent = danger ? 'ASTEROID NAHE' : 'ASTEROIDEN-ORTUNG';
    el('weather-message').textContent = protectedNow ? 'ATLAS schützt dich' : danger ? 'Flugbahn beachten' : 'Flugraum beobachten';
    el('countdown').textContent = `${Math.max(0, Math.round(distance))} m`;
    el('phase-progress').style.width = `${Math.max(0, 1 - distance / 80) * 100}%`;
    el('weather-hint').textContent = 'Bewegte Asteroiden verursachen Kollisionsschaden.';
  }
  document.querySelector('.weather')!.setAttribute('aria-label', space ? 'Asteroidengefahr' : 'Wetterstatus');
  document.querySelector('.weather-top .tiny')!.textContent = space ? 'ORTUNG' : 'ATMOSPHÄRE';
  const returning = space || (state.phase === 'calm' && inventoryTotal(state.resources.cargo) > 0);
  if (!space && state.phase !== 'calm' && !protectedNow && state.elapsed - routeTime > 0.5) { escapeRoute = shelterRoute(state); routeTime = state.elapsed; }
  let destination = returning ? TRANSPORTER : nearestShelter(state);
  if (!returning && state.phase !== 'calm' && escapeRoute?.points.length && !protectedNow) destination = { ...escapeRoute.points[0], name: escapeRoute.shelter.name, radius: 12 };
  const d = Math.hypot(destination.x - state.x, destination.z - state.z);
  el('guide-name').textContent = returning ? 'ATLAS / FRACHT ABGEBEN' : protectedNow ? 'GESCHÜTZTER BEREICH' : `SCHUTZMULDE ${destination.name}`;
  el('guide-distance').textContent = returning ? `${Math.round(d)} m · ${controls.gamepadConnected ? 'Y' : 'E'} zum Entladen` : protectedNow ? 'Bremsen & Sturm abwarten' : `${Math.round(d)} m · Schutz suchen`;
  if (!returning && !protectedNow && state.phase !== 'calm' && (escapeRoute?.points.length ?? 0) > 1) el('guide-distance').textContent = `${Math.round(d)} m · Durchgang folgen`;
  el('guide-arrow').style.transform = `rotate(${Math.atan2(destination.x - state.x, -(destination.z - state.z))}rad)`;
  el('coordinates').textContent = `${Math.round(state.x).toString().padStart(3, '0')} / ${Math.round(state.z).toString().padStart(3, '0')}`;
  el('input-device').innerHTML = `${controls.gamepadConnected ? 'GAMEPAD VERBUNDEN' : 'TASTATUR + MAUS'} <i class="live-dot"></i>`;
  document.querySelector<HTMLElement>('.keyboard')!.hidden = controls.gamepadConnected;
  document.querySelector<HTMLElement>('.gamepad')!.hidden = !controls.gamepadConnected;
  drawMap();
}
function updateResourceHud() {
  const r = state.resources, cargo = inventoryTotal(r.cargo), distance = baseDistance(state);
  const target = r.deposits.find(d => d.id === r.targetId);
  for (const objective of objectives) {
    const count = Math.min(objective.amount, state.mission.counts[objective.id] ?? 0);
    el(`goal-${objective.id}`).textContent = `${count} / ${objective.amount}`;
    el(`goal-fill-${objective.id}`).style.width = `${count / objective.amount * 100}%`;
  }
  el('mission-status').textContent = state.mission.completed ? '✓ AUFTRAG ABGESCHLOSSEN' : `${LEVELS[state.levelId].name.toUpperCase()} / AN ATLAS LIEFERN`;
  el('cargo-total').textContent = `${cargo} / ${R.capacity}${cargo === R.capacity ? ' · VOLL' : ''}`;
  el('cargo-fill').style.width = `${cargo / R.capacity * 100}%`;
  for (const id of RESOURCE_TYPES) el(`cargo-${id}`).textContent = String(r.cargo[id]);
  el('storage-total').textContent = `ATLAS-LAGER · ${inventoryTotal(r.storage)} EINHEITEN`;
  el('base-distance').textContent = `ATLAS ${Math.round(distance)} m`;
  const laserKey = controls.gamepadConnected ? 'RB' : 'X / Shift', unloadKey = controls.gamepadConnected ? 'Y' : 'E';
  let title = 'ERZ-LASER BEREIT', hint = `Auf ein Vorkommen zielen · ${laserKey} halten · Reichweite ${R.laserRange} m.`;
  if (target) { title = `${RESOURCES[target.resource].name.toUpperCase()} · ${target.remaining} EINHEITEN`; hint = `${r.laserActive ? 'Abbau läuft' : `${laserKey} halten` } · ${Math.round(Math.hypot(target.x - state.x, target.z - state.z))} m · Fragmente einsammeln`; }
  else {
    const nearest = r.deposits.filter(d => d.remaining > 0).sort((a, b) => Math.hypot(a.x - state.x, a.z - state.z) - Math.hypot(b.x - state.x, b.z - state.z))[0];
    if (nearest) {
      const d = Math.hypot(nearest.x - state.x, nearest.z - state.z);
      hint = d > R.laserRange ? `Nächstes Vorkommen ${Math.round(d)} m · auf ${R.laserRange} m nähern.` : `Mit ${controls.gamepadConnected ? 'RS' : 'der Maus'} auf ein Vorkommen zielen · ${laserKey} halten.`;
    } else hint = 'Alle Vorkommen erschöpft · übrige Fragmente einsammeln und liefern.';
  }
  if (cargo === R.capacity) { title = 'FRACHTRAUM VOLL'; hint = `Zurück zu ATLAS · abbremsen und ${unloadKey} drücken. Fragmente bleiben liegen.`; }
  if (distance <= TRANSPORTER.radius) { title = 'ATLAS / LADEZONE'; hint = state.speed > TRANSPORTER.maxUnloadSpeed ? 'Zum Entladen abbremsen · maximal 7 km/h.' : cargo ? `${unloadKey} drücken · ${cargo} Einheiten entladen und dem Auftrag gutschreiben.` : 'Frachtraum leer · suche die farbigen Vorkommen im Radar.'; }
  if (r.noticeTime > 0) hint = r.notice;
  el('interaction-title').textContent = title; el('interaction-hint').textContent = hint;
  el('mining-fill').style.width = target ? `${target.progress / RESOURCES[target.resource].seconds * 100}%` : '0%';
  el('mining-fill').style.background = target ? RESOURCES[target.resource].color : '';
  el('mission-success').hidden = state.mission.completedAt === null || state.elapsed - state.mission.completedAt > 8;
}
let previous = performance.now(), hudClock = 0;
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000, 0.05); previous = now;
  const input = controls.read(controls.pointer.active ? world.mouseAim(controls.pointer, state) : null);
  if (!paused && !state.dead && !document.hidden) {
    advance(state, input, dt);
    if (state.dead) { controls.clear(); showDialog(); }
  }
  world.render(state, paused || state.dead || document.hidden ? 0 : dt, paused || state.dead || input.brake ? 0 : input.thrust);
  hudClock += dt;
  if (hudClock > 0.06) { updateHud(input.thrust, input.brake); hudClock = 0; }
  requestAnimationFrame(frame);
}
world.reset(state); world.render(state, 0, 0); updateHud(0, 0); showDialog(); requestAnimationFrame(frame);
