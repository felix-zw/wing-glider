import './style.css';
import './touch-controls.css';
import { World } from './world';
import { Controls } from './input';
import { advance, CONFIG, createState, isProtected, nearestShelter, phaseDuration, neutralInput } from './simulation';
import { deploymentActive } from './deployment';
import { atlasPlacement } from './atlas-rig';
import { RESOURCE_CONFIG as R } from './config';
import { RESOURCE_TYPES, RESOURCES, baseDistance, inventoryTotal } from './resources';
import { FIRST_MISSION, objectiveCounts } from './missions';
import { LEVELS, getLevelWorld, groundHeight, type LevelId } from './levels';
import { shelterRoute } from './navigation';
import { GameAudio } from './audio';
import { LevelEditor, escapeHtml } from './editor';
import { DOCUMENTS, packageLevel, parsePackage, validateDocument } from './level-document';
import { THEMES } from './themes';
import { savedLevels, saveLevel } from './level-storage';
import { registerLevel, getSolidFootprints } from './levels';
import { inspectLevel } from './editor-model';
import { forwardSpeed, resetDrive } from './flight-motion';

let objectives = objectiveCounts(FIRST_MISSION.objective);
const objectiveMarkup = () => objectives.map(o => `<div class="objective" style="--ore:${o.resource ? RESOURCES[o.resource].color : '#c5d7b3'}"><div><span><i class="ore-dot"></i>${o.label}</span><strong id="goal-${o.id}">0 / ${o.amount}</strong></div><div class="track"><i id="goal-fill-${o.id}"></i></div></div>`).join('');

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="viewport"></div><div class="vignette"></div><div id="weather-wash"></div>
  <section id="deployment-status" aria-label="Expeditionsstart"><p class="eyebrow">ATLAS / EXPEDITION</p><strong id="deployment-label" role="status">Anflug</strong><div class="track"><i id="deployment-progress"></i></div></section>
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
  <section class="telemetry" aria-label="Geschwindigkeit und Fahrzeugzustand"><p class="eyebrow">SPEEDER <span class="muted">/ MK. II</span></p><div class="speed-line"><strong id="speed">000</strong><span>KM/H<br><small id="drive-state">BEREIT</small></span></div><div class="speed-ticks"><i id="speed-fill"></i></div><div class="hull"><span>HÜLLE</span><strong id="health-value">100%</strong></div><div class="track health-track"><i id="health-fill"></i></div><div id="safety"><span>◇</span> UNGESCHÜTZT</div></section>
  <section class="navigation"><div class="map-heading"><span class="eyebrow">GELÄNDERADAR</span><span id="coordinates">025 / 036</span></div><canvas id="minimap" width="240" height="200" aria-label="Karte mit Schutzmulden, Rohstoffen, ATLAS und Fahrzeugposition"></canvas><div class="map-footer"><span>○ SCHUTZ · ◇ ERZ · ▣ ATLAS</span><span>420 × 420 M</span></div></section>
  <section class="interaction" aria-label="Abbau und Entladen"><div class="interaction-top"><strong id="interaction-title">ERZ-LASER BEREIT</strong><span id="base-distance"></span></div><p id="interaction-hint">Auf ein Vorkommen zielen · X oder Shift halten.</p><div class="track"><i id="mining-fill"></i></div></section>
  <div id="mission-success" role="status" hidden>AUFTRAG ERFÜLLT <span>ATLAS ist versorgt. Deine Expedition geht weiter.</span></div>
  <footer><div class="controls keyboard"><span><kbd>W</kbd> Schub</span><span><kbd>A</kbd><kbd>D</kbd> Lenken</span><span><kbd>S / ↓</kbd> Bremse / R</span><span><kbd>SPACE</kbd> Drift / Gleiten</span><span><kbd>MAUS</kbd> Zielen</span><span><kbd>X / SHIFT</kbd> Abbau</span><span><kbd>E</kbd> Entladen</span></div><div class="controls gamepad" hidden><span><kbd>RT</kbd> Schub</span><span><kbd>LS</kbd> Lenken</span><span><kbd>LT</kbd> Bremse / R</span><span><kbd>A</kbd> Drift / Gleiten</span><span><kbd>RS</kbd> Zielen</span><span><kbd>RB</kbd> Abbau</span><span><kbd>Y</kbd> Entladen</span></div><span id="input-device">TASTATUR + MAUS <i class="live-dot"></i></span></footer>
  <div id="overlay" role="dialog" aria-modal="true" aria-labelledby="dialog-title" hidden><section class="dialog"><p class="eyebrow" id="dialog-kicker">FLUG UNTERBROCHEN</p><h2 id="dialog-title">Kurze Verschnaufpause.</h2><p id="dialog-body">Dein Speeder wartet auf dich.</p><details class="driving-help"><summary>Steuerung</summary><p><b>Gas:</b> W / ↑ oder RT. <b>Lenken:</b> A/D, Pfeile oder linker Stick.</p><p><b>Bremse:</b> S / ↓ oder LT. Für rückwärts erst anhalten, loslassen und erneut halten.</p><p><b>Handbremse:</b> Space oder A. Auf Aster driften; im Weltraum ohne seitliche Stabilisierung gleiten.</p><p><b>Touch:</b> Gas halten oder doppelt tippen für Dauergas. Ein weiterer Tipp oder die Bremse beendet Dauergas. Rechts zielen und abbauen.</p></details><div class="quality-setting"><label for="quality">DARSTELLUNG</label><select id="quality" aria-describedby="quality-hint"><option value="high">Hoch</option><option value="standard">Standard</option></select><p id="quality-hint">Volle Landschaftsdetails, Licht und Effekte.</p></div><div class="audio-setting"><label for="volume">LAUTSTÄRKE <output id="volume-value" for="volume">55%</output></label><input id="volume" type="range" min="0" max="100" step="5" value="55" aria-label="Lautstärke"><button id="mute" type="button" aria-pressed="false">Ton ausschalten</button></div><button id="resume" class="primary">Weiterfliegen <span>↗</span></button><button id="restart">Level neu starten</button><button id="choose-level">Level wählen</button></section></div>
  <div id="level-select" role="dialog" aria-modal="true" aria-label="Level auswählen" hidden><section class="level-dialog"><p class="eyebrow">WING GLIDER / EXPEDITIONEN</p><h2>Wohin führt dein Flug?</h2><p class="level-intro">Deine Welten. Ein Auftrag: wertvolle Rohstoffe zu ATLAS bringen.</p><div class="level-cards">${Object.values(LEVELS).map((level, index) => `<article class="level-entry"><button class="level-card ${level.id}" data-level="${level.id}" aria-label="${level.name} starten"><div class="level-art" aria-hidden="true"><span class="sector-number">0${index + 1}</span><i></i><i></i><i></i><b class="orbit-line"></b></div><small>${level.subtitle}</small><strong>${level.name}</strong><p>${level.description}</p><span>EXPEDITION STARTEN <b>↗</b></span></button><button class="level-edit" data-edit-level="${level.id}" aria-label="${level.name} bearbeiten">✎ Bearbeiten</button></article>`).join('')}</div><div class="workshop-menu"><button id="open-editor">✧ Level-Editor</button><button id="import-level">Level importieren</button><input id="level-import-file" type="file" accept=".json,application/json" hidden></div><p class="level-storage-note" id="level-storage-note"></p><p class="level-note">Jeder Start beginnt mit leerer Fracht und einem neuen Auftrag. Die laufende Expedition wird zurückgesetzt.</p><button id="cancel-level" hidden>Zurück zur Expedition</button></section></div>
  <div id="loading" role="dialog" aria-modal="true" aria-labelledby="loading-title"><section class="loading-dialog"><span class="loading-mark" aria-hidden="true">≋</span><p class="eyebrow">WING GLIDER / FLUGVORBEREITUNG</p><h2 id="loading-title">Deine Expedition wird vorbereitet.</h2><p id="loading-label" role="status" aria-live="polite">Fahrzeug und Welten werden geladen.</p><div id="loading-progress" role="progressbar" aria-label="Assets laden" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="loading-fill"></i></div><span id="loading-count">VERBINDUNG ZU ATLAS</span><button id="retry-loading" class="primary" hidden>Erneut versuchen <span>↗</span></button></section></div>
`;

const el = (id: string) => document.getElementById(id)!;
const audio = new GameAudio();
let state = createState();
let paused = true, choosing = true, hasExpedition = false, ready = false, graphicsLost = false;
let escapeRoute: ReturnType<typeof shelterRoute> | null = null, routeTime = -1;
document.body.dataset.ui = 'loading';
function loadingError(title: string, message: string) {
  audio.pause();
  ready = false; paused = true;
  document.body.dataset.ui = 'loading';
  el('loading').hidden = false; el('level-select').hidden = true; el('overlay').hidden = true;
  el('loading').classList.add('has-error');
  el('loading-title').textContent = title; el('loading-label').textContent = message;
  el('loading-progress').hidden = true; el('loading-count').hidden = true;
  el('retry-loading').hidden = false; el('retry-loading').focus();
}
el('retry-loading').addEventListener('click', () => window.location.reload());
let world: World;
try { world = new World(el('viewport')); }
catch (error) {
  loadingError('3D-Darstellung nicht verfügbar.', 'Bitte öffne das Spiel in einem Browser mit WebGL 2 und aktiviere die Hardwarebeschleunigung.');
  throw error;
}
world.renderer.domElement.addEventListener('asset-progress', event => {
  const { loaded, total, label } = (event as CustomEvent<{ loaded: number; total: number; label: string }>).detail;
  const percentage = total > 0 ? Math.min(100, Math.round(loaded / total * 100)) : 0;
  el('loading-fill').style.width = `${percentage}%`;
  el('loading-progress').setAttribute('aria-valuenow', String(percentage));
  el('loading-label').textContent = label;
  el('loading-count').textContent = total > 0 ? `${loaded} / ${total} ASSETS · ${percentage}%` : 'WELTEN WERDEN VORBEREITET';
});
const quality = el('quality') as HTMLSelectElement;
try { quality.value = localStorage.getItem('wing-glider-quality') === 'standard' ? 'standard' : 'high'; } catch { quality.value = 'high'; }
function applyQuality() {
  const value = quality.value === 'standard' ? 'standard' : 'high';
  world.setQuality(value);
  el('quality-hint').textContent = value === 'high' ? 'Volle Landschaftsdetails, Licht und Effekte.' : 'Weniger Dekor und Effekte für flüssiges Fliegen.';
  try { localStorage.setItem('wing-glider-quality', value); } catch { /* Session preference still works when storage is unavailable. */ }
}
quality.addEventListener('change', applyQuality);
quality.addEventListener('keydown', event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation(); });
applyQuality();
const volume=el('volume') as HTMLInputElement;
function updateAudioSetting() {
  volume.value=String(Math.round(audio.volume*100));
  el('volume-value').textContent=`${volume.value}%`;
  el('mute').textContent=audio.muted?'Ton einschalten':'Ton ausschalten';
  el('mute').setAttribute('aria-pressed',String(audio.muted));
}
volume.addEventListener('input',()=>{audio.setVolume(Number(volume.value)/100);updateAudioSetting();});
volume.addEventListener('keydown',event=>{if(event.key!=='Escape'&&event.key!=='Tab')event.stopPropagation();});
el('mute').addEventListener('click',()=>{audio.setMuted(!audio.muted);updateAudioSetting();});
updateAudioSetting();
const unlockAudio=()=>{void audio.unlock();};
window.addEventListener('pointerdown',unlockAudio);
window.addEventListener('keydown',unlockAudio);
window.addEventListener('pagehide',event=>{controls.clear();if(event.persisted)audio.pause();else {audio.dispose();controls.dispose();}});
function showDialog() {
  if(paused||choosing||state.dead)audio.pause();
  controls.setActive(ready&&!graphicsLost&&!paused&&!choosing&&!state.dead&&!document.hidden&&!deploymentActive(state.deployment));
  if (!ready || graphicsLost) return;
  if(editor.active){document.body.dataset.ui='editing';el('level-select').hidden=true;el('overlay').hidden=true;el('pause').hidden=true;return;}
  document.body.dataset.ui = choosing ? 'choosing' : paused || state.dead ? 'paused' : deploymentActive(state.deployment)?'deploying':'flying';
  el('level-select').hidden = !choosing;
  el('pause').hidden = choosing;
  el('cancel-level').hidden = !hasExpedition || state.dead;
  el('overlay').hidden = choosing || (!paused && !state.dead);
  el('dialog-kicker').textContent = state.dead ? 'SIGNAL VERLOREN' : 'FLUG UNTERBROCHEN';
  el('dialog-title').textContent = state.dead ? state.lastDamage === 'storm' ? 'Der Sturm war stärker.' : state.lastDamage === 'wall' ? 'Aufprall an der Felswand.' : 'Kollision im Asteroidengürtel.' : 'Kurze Verschnaufpause.';
  el('dialog-body').textContent = state.dead ? `${Math.floor(state.distance)} Meter erkundet · ${inventoryTotal(state.resources.storage)} Einheiten geliefert. ${state.environment.kind === 'space' ? 'Achte auf bewegte Asteroiden. Bei ATLAS bist du geschützt.' : 'Nutze die Durchgänge zwischen den Felswänden und suche rechtzeitig Schutz.'}` : 'Dein Speeder wartet auf dich.';
  el('resume').hidden = state.dead;
  el('pause').textContent = paused ? '▷ WEITER' : 'Ⅱ PAUSE';
  el('pause').setAttribute('aria-label', paused ? 'Spiel fortsetzen' : 'Spiel pausieren');
}
function togglePause() { if (ready && !graphicsLost && !state.dead && !choosing && !editor.active) { paused = !paused; controls.clear(); showDialog(); if (paused) el('resume').focus(); else (document.activeElement as HTMLElement)?.blur(); } }
const controls = new Controls(world.renderer.domElement, togglePause,{reset:()=>resetDrive(state)});
el('pause').addEventListener('click', togglePause);
el('resume').addEventListener('click', togglePause);
function startLevel(id: LevelId) {
  if (!ready || graphicsLost) return;
  const placement=atlasPlacement(getLevelWorld(id));
  if(!placement.valid){el('level-storage-note').textContent=placement.reason;return;}
  state = createState(id,{arrival:true}); paused = false; choosing = false; hasExpedition = true; controls.clear(); world.reset(state); audio.reset(state);
  el('deployment-progress').style.width='0%';
  el('deployment-label').textContent=state.environment.kind==='planet'?'Landeanflug · Fahrwerk ausfahren':'Anflug · Position halten';
  (document.activeElement as HTMLElement)?.blur();
  escapeRoute = null; routeTime = -1;
  objectives = objectiveCounts(LEVELS[id].mission.objective); el('objectives').innerHTML = objectiveMarkup();
  el('mission-title').textContent = LEVELS[id].mission.title;
  el('location').textContent = `${LEVELS[id].name.toUpperCase()} / ${LEVELS[id].subtitle}`;
  document.title = `Wing Glider — ${LEVELS[id].name}`;
  const isSpace=getLevelWorld(id).definition.environment==='space';
  document.querySelector('.map-footer span:last-child')!.textContent=`${getLevelWorld(id).bounds*2} × ${getLevelWorld(id).bounds*2} M`;
  document.querySelector('.brand small')!.textContent = isSpace ? 'SPACE EXPEDITION / 02' : 'PLANETARY EXPEDITION / 01';
  document.querySelector('.map-heading .eyebrow')!.textContent = isSpace ? 'SEKTORRADAR' : 'GELÄNDERADAR';
  document.querySelector('.map-footer span')!.textContent = isSpace ? '○ SCHILD · ◇ ERZ · • GEFAHR' : '○ SCHUTZ · ◇ ERZ · ▣ ATLAS';
  el('minimap').setAttribute('aria-label', isSpace ? 'Karte mit Asteroiden, Erzadern, ATLAS und Fahrzeugposition' : 'Karte mit Schutzmulden, Rohstoffen, ATLAS und Fahrzeugposition');
  document.body.dataset.level = isSpace?'belt':'aster'; rebuildMap(); showDialog(); world.render(state, 0, 0); updateHud(0, 0);
}
el('restart').addEventListener('click', () => startLevel(state.levelId));
el('choose-level').addEventListener('click', () => { if (!ready || graphicsLost) return; choosing = true; paused = true; controls.clear(); showDialog(); document.querySelector<HTMLButtonElement>('[data-level]')!.focus(); });
el('cancel-level').addEventListener('click', () => { if (!ready || graphicsLost) return; choosing = false; showDialog(); el('resume').focus(); });
document.querySelectorAll<HTMLButtonElement>('[data-level]').forEach(button => button.addEventListener('click', () => startLevel(button.dataset.level as LevelId)));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !state.dead) { paused = true; showDialog(); }
});
world.renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault(); graphicsLost = true; controls.clear(); controls.setActive(false);
  loadingError('Grafikverbindung unterbrochen.', 'Lade die Expedition neu, um die 3D-Darstellung wiederherzustellen.');
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || editor.active) return;
  const dialog = ['loading', 'level-select', 'overlay'].map(el).find(element => !element.hidden);
  if (!dialog) return;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, select, input')).filter(element => !element.hidden && !(element as HTMLButtonElement).disabled);
  if (!focusable.length) { event.preventDefault(); return; }
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
});

const map = el('minimap') as HTMLCanvasElement;
const ctx = map.getContext('2d')!;
const mapBase = document.createElement('canvas'); mapBase.width = 240; mapBase.height = 200;
const baseCtx = mapBase.getContext('2d')!;
const mapSize=()=>getLevelWorld(state.levelId).bounds*2;
function rebuildMap() {
const level = getLevelWorld(state.levelId);
baseCtx.fillStyle = '#101526'; baseCtx.fillRect(0, 0, 240, 200);
if (state.environment.kind === 'planet') for (let y = 0; y < 200; y += 2) for (let x = 0; x < 240; x += 2) {
  const h = groundHeight(level, (x / 240 - 0.5) * mapSize(), (y / 200 - 0.5) * mapSize());
  const contour = h > 3 && Math.abs(h / 5 - Math.round(h / 5)) < 0.055;
  const v = 25 + h * 1.1 + (contour ? 17 : 0);
  baseCtx.fillStyle = `rgb(${v},${v + 12},${v + 7})`; baseCtx.fillRect(x, y, 2, 2);
}
for (const s of level.solids) {
  const x = (s.x / mapSize() + 0.5) * 240, y = (s.z / mapSize() + 0.5) * 200;
  baseCtx.fillStyle = state.environment.kind === 'space' ? '#67737e' : '#657367'; baseCtx.strokeStyle = '#a4b3aa';
  const footprints = getSolidFootprints(s);
  if (footprints.length) {
    baseCtx.beginPath();
    for (const footprint of footprints) {
      footprint.forEach((p, i) => {
        const px = (p.x / mapSize() + .5) * 240, py = (p.z / mapSize() + .5) * 200;
        if (i === 0) baseCtx.moveTo(px, py); else baseCtx.lineTo(px, py);
      });
      baseCtx.closePath();
    }
    baseCtx.fill('evenodd'); baseCtx.stroke();
  }
  else if (s.kind === 'cliff') { baseCtx.fillRect(x - s.halfX / mapSize() * 240, y - s.halfZ / mapSize() * 200, s.halfX / mapSize() * 480, s.halfZ / mapSize() * 400); }
  else { baseCtx.beginPath(); baseCtx.ellipse(x, y, s.radius / mapSize() * 240, s.radius / mapSize() * 200, 0, 0, Math.PI * 2); baseCtx.fill(); baseCtx.stroke(); }
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
    ctx.beginPath(); ctx.arc((s.x / mapSize() + 0.5) * 240, (s.z / mapSize() + 0.5) * 200, 5.7, 0, Math.PI * 2);
    ctx.strokeStyle = '#a6d9b8'; ctx.stroke(); ctx.fillStyle = '#93caab22'; ctx.fill();
  }
  if (state.environment.kind === 'space') for (const a of state.environment.asteroids) {
    const x = (a.x / mapSize() + 0.5) * 240, y = (a.z / mapSize() + 0.5) * 200;
    ctx.strokeStyle = '#ffa887'; ctx.fillStyle = '#ffa887'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + a.vx * 0.8, y + a.vz * 0.65); ctx.stroke();
  }
  for (const d of state.resources.deposits) {
    if (!d.remaining) continue;
    const px = (d.x / mapSize() + 0.5) * 240, py = (d.z / mapSize() + 0.5) * 200;
    ctx.fillStyle = RESOURCES[d.resource].color;
    ctx.beginPath(); ctx.moveTo(px, py - 2.8); ctx.lineTo(px + 2.8, py); ctx.lineTo(px, py + 2.8); ctx.lineTo(px - 2.8, py); ctx.closePath(); ctx.fill();
  }
  for (const f of state.resources.fragments) {
    ctx.fillStyle = RESOURCES[f.resource].color; ctx.fillRect((f.x / mapSize() + 0.5) * 240, (f.z / mapSize() + 0.5) * 200, 1.3, 1.3);
  }
  ctx.strokeStyle = '#ffdc9d'; ctx.lineWidth = 1.5; const base=getLevelWorld(state.levelId).base,bx=(base.x/mapSize()+.5)*240,by=(base.z/mapSize()+.5)*200;ctx.strokeRect(bx-4.5,by-4.5,9,9);
  const x = (state.x / mapSize() + 0.5) * 240, y = (state.z / mapSize() + 0.5) * 200;
  const nearest = nearestShelter(state);
  if (state.environment.kind === 'planet' && state.phase !== 'calm') {
    ctx.beginPath(); ctx.moveTo(x, y);
    for (const p of escapeRoute?.points ?? [nearest]) ctx.lineTo((p.x / mapSize() + 0.5) * 240, (p.z / mapSize() + 0.5) * 200);
    ctx.strokeStyle = '#ebbb76'; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  else if (inventoryTotal(state.resources.cargo) > 0) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx,by); ctx.setLineDash([3, 4]); ctx.strokeStyle = '#ffdc9d'; ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(state.heading);
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 3); ctx.lineTo(-4, 5); ctx.closePath();
  ctx.fillStyle = '#fff1cd'; ctx.fill(); ctx.restore();
}
function updateHud(thrust: number, brake: number) {
  updateResourceHud();
  const protectedNow = isProtected(state), timeLeft = Math.ceil(phaseDuration(state.phase) - state.phaseTime);
  el('speed').textContent = String(Math.round(Math.abs(state.speed) * 3.6)).padStart(3, '0');
  controls.touch.setEnvironment(state.environment.kind==='space');
  el('drive-state').textContent = state.gliding?'FREIES GLEITEN':state.drifting?'DRIFT':forwardSpeed(state)<-.3?'RÜCKWÄRTS':brake?'BREMSE':controls.touch.throttle.latched?'GAS FIX':thrust?'SCHUB':state.reverseArmed?'R BEREIT':state.speed>.1?'GLEITFLUG':'BEREIT';
  el('speed-fill').style.width = `${Math.abs(state.speed) / CONFIG.maxSpeed * 100}%`;
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
  let destination = returning ? getLevelWorld(state.levelId).base : nearestShelter(state);
  if (!returning && state.phase !== 'calm' && escapeRoute?.points.length && !protectedNow) destination = { ...escapeRoute.points[0], name: escapeRoute.shelter.name, radius: 12 };
  const d = Math.hypot(destination.x - state.x, destination.z - state.z);
  el('guide-name').textContent = returning ? 'ATLAS / FRACHT ABGEBEN' : protectedNow ? 'GESCHÜTZTER BEREICH' : `SCHUTZMULDE ${destination.name}`;
  el('guide-distance').textContent = returning ? `${Math.round(d)} m · ${controls.touch.enabled ? 'Entladen antippen' : `${controls.gamepadConnected ? 'Y' : 'E'} zum Entladen`}` : protectedNow ? 'Bremsen & Sturm abwarten' : `${Math.round(d)} m · Schutz suchen`;
  if (!returning && !protectedNow && state.phase !== 'calm' && (escapeRoute?.points.length ?? 0) > 1) el('guide-distance').textContent = `${Math.round(d)} m · Durchgang folgen`;
  el('guide-arrow').style.transform = `rotate(${Math.atan2(destination.x - state.x, -(destination.z - state.z))}rad)`;
  el('shelter-guide').hidden = space ? inventoryTotal(state.resources.cargo) === 0 : state.phase === 'calm' && inventoryTotal(state.resources.cargo) === 0;
  el('coordinates').textContent = `${Math.round(state.x).toString().padStart(3, '0')} / ${Math.round(state.z).toString().padStart(3, '0')}`;
  el('input-device').innerHTML = `${controls.touch.enabled ? 'TOUCH-STICKS' : controls.gamepadConnected ? 'GAMEPAD VERBUNDEN' : 'TASTATUR + MAUS'} <i class="live-dot"></i>`;
  document.querySelector<HTMLElement>('.keyboard')!.hidden = controls.gamepadConnected || controls.touch.enabled;
  document.querySelector<HTMLElement>('.gamepad')!.hidden = !controls.gamepadConnected;
  drawMap();
}
function updateResourceHud() {
  const r = state.resources, cargo = inventoryTotal(r.cargo), distance = baseDistance(state);
  const target = r.deposits.find(d => d.id === r.targetId);
  for (const objective of objectives) {
    const count = Math.min(objective.amount, state.mission.counts[objective.id] ?? 0);
    el(`goal-${objective.id}`).textContent = `${Number(count.toFixed(1))} / ${objective.amount}`;
    el(`goal-fill-${objective.id}`).style.width = `${count / objective.amount * 100}%`;
  }
  el('mission-status').textContent = state.mission.completed ? '✓ AUFTRAG ABGESCHLOSSEN' : `${LEVELS[state.levelId].name.toUpperCase()} / AN ATLAS LIEFERN`;
  el('cargo-total').textContent = `${Number(cargo.toFixed(1))} / ${R.capacity}${cargo === R.capacity ? ' · VOLL' : ''}`;
  el('cargo-fill').style.width = `${cargo / R.capacity * 100}%`;
  for (const id of RESOURCE_TYPES) el(`cargo-${id}`).textContent = String(Number(r.cargo[id].toFixed(1)));
  el('storage-total').textContent = `ATLAS-LAGER · ${Number(inventoryTotal(r.storage).toFixed(1))} EINHEITEN`;
  el('base-distance').textContent = `ATLAS ${Math.round(distance)} m`;
  const laserAction = controls.touch.enabled ? 'Rechten Stick ziehen' : `${controls.gamepadConnected ? 'RB' : 'X / Shift'} halten`;
  const unloadAction = controls.touch.enabled ? 'Entladen antippen' : `${controls.gamepadConnected ? 'Y' : 'E'} drücken`;
  controls.touch.setUnloadAvailable(distance<=getLevelWorld(state.levelId).base.radius&&Math.abs(state.speed)<=getLevelWorld(state.levelId).base.maxUnloadSpeed&&cargo>0);
  let title = 'ERZ-LASER BEREIT', hint = `${laserAction} · auf ein Vorkommen zielen · Reichweite ${R.laserRange} m.`;
  if (target) { title = `${RESOURCES[target.resource].name.toUpperCase()} · ${Number(target.remaining.toFixed(1))} EINHEITEN`; hint = `${r.laserActive ? 'Abbau läuft' : laserAction} · ${Math.round(Math.hypot(target.x - state.x, target.z - state.z))} m · Fragmente einsammeln`; }
  else {
    const nearest = r.deposits.filter(d => d.remaining > 0).sort((a, b) => Math.hypot(a.x - state.x, a.z - state.z) - Math.hypot(b.x - state.x, b.z - state.z))[0];
    if (nearest) {
      const d = Math.hypot(nearest.x - state.x, nearest.z - state.z);
      hint = d > R.laserRange ? `Nächstes Vorkommen ${Math.round(d)} m · auf ${R.laserRange} m nähern.` : controls.touch.enabled ? 'Rechten Stick zum Erz ziehen · zielen und abbauen.' : `Mit ${controls.gamepadConnected ? 'RS' : 'der Maus'} auf ein Vorkommen zielen · ${laserAction}.`;
    } else hint = 'Alle Vorkommen erschöpft · übrige Fragmente einsammeln und liefern.';
  }
  if (cargo === R.capacity) { title = 'FRACHTRAUM VOLL'; hint = `Zurück zu ATLAS · abbremsen und ${unloadAction}. Fragmente bleiben liegen.`; }
  if (distance <= getLevelWorld(state.levelId).base.radius) { title = 'ATLAS / LADEZONE'; hint = Math.abs(state.speed) > getLevelWorld(state.levelId).base.maxUnloadSpeed ? 'Zum Entladen abbremsen · maximal 7 km/h.' : cargo ? `${unloadAction} · ${cargo} Einheiten entladen und dem Auftrag gutschreiben.` : 'Frachtraum leer · suche die farbigen Vorkommen im Radar.'; }
  if (r.noticeTime > 0) hint = r.notice;
  el('interaction-title').textContent = title; el('interaction-hint').textContent = hint;
  document.querySelector('.interaction')!.classList.toggle('is-active', !!target || cargo === R.capacity || distance <= getLevelWorld(state.levelId).base.radius || r.noticeTime > 0);
  el('mining-fill').style.width = target ? `${target.progress / RESOURCES[target.resource].seconds * 100}%` : '0%';
  el('mining-fill').style.background = target ? RESOURCES[target.resource].color : '';
  el('mission-success').hidden = state.mission.completedAt === null || state.elapsed - state.mission.completedAt > 8;
}
let previous = performance.now(), hudClock = 0;
function frame(now: number) {
  if (!ready || graphicsLost) return;
  const dt = Math.min((now - previous) / 1000, 0.05); previous = now;
  if(editor.active){controls.setActive(false);audio.pause();try{editor.render();}catch(error){editorError(error);}requestAnimationFrame(frame);return;}
  const deploying=deploymentActive(state.deployment);
  controls.setActive(!paused&&!choosing&&!state.dead&&!document.hidden&&!deploying);
  const sampled=controls.read(!deploying&&controls.pointer.active ? world.mouseAim(controls.pointer, state) : null);
  const input=deploying?neutralInput():sampled;
  const device=controls.touch.enabled?'touch':controls.gamepadConnected?'gamepad':'keyboard';
  if(document.body.dataset.controls!==device){document.body.dataset.controls=device;resetDrive(state);}
  if (!paused && !state.dead && !document.hidden) {
    advance(state, input, dt);
    if(deploying&&!deploymentActive(state.deployment)){controls.clear();showDialog();}
    if (state.dead) { controls.clear(); showDialog(); }
  }
  if (!document.hidden) world.render(state, paused || state.dead ? 0 : dt, paused || state.dead || input.brake ? 0 : input.thrust);
  audio.update(state,input,!paused&&!choosing&&!state.dead&&!document.hidden);
  if(deploying) {
    const d=state.deployment!,label=d.phase==='arrival'?(state.environment.kind==='planet'?'Landeanflug · Fahrwerk ausfahren':'Anflug · Position halten'):d.phase==='opening'?'Hangar öffnen · Rampe ausfahren':'Speeder wird ausgesetzt';
    if(el('deployment-label').textContent!==label)el('deployment-label').textContent=label;
    el('deployment-progress').style.width=`${d.time/8*100}%`;
  }
  hudClock += dt;
  if (hudClock > 0.06) { updateHud(input.thrust, input.brake); hudClock = 0; }
  requestAnimationFrame(frame);
}
const editor=new LevelEditor(world,{play:startLevel,close:()=>{paused=true;choosing=true;controls.clear();world.setEditorView(null);state=createState('aster');world.reset(state);showDialog();void refreshSavedLevels();},changed:()=>{if(!editor.active&&!editor.testing)void refreshSavedLevels();},failed:editorError});
function editorError(error:unknown){editor.abort();paused=true;choosing=true;world.reset(state);showDialog();el('level-storage-note').textContent='Editor konnte nicht geöffnet werden: '+(error instanceof Error?error.message:String(error));console.error('Level editor failed',error);}
let openingEditor=false;
async function openLevelEditor(source:import('./level-document').LevelDocument){if(!ready||graphicsLost||openingEditor)return;openingEditor=true;paused=true;controls.clear();controls.setActive(false);audio.pause();el('level-storage-note').textContent='Editor wird geöffnet …';try{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));await editor.open(source);showDialog();el('level-storage-note').textContent='';editor.element.querySelector<HTMLButtonElement>('#editor-close')?.focus();}catch(error){editorError(error);}finally{openingEditor=false;}}
el('open-editor').addEventListener('click',()=>openLevelEditor(DOCUMENTS.get('belt')!));
document.querySelectorAll<HTMLButtonElement>('[data-edit-level]').forEach(button=>button.onclick=()=>openLevelEditor(DOCUMENTS.get(button.dataset.editLevel!)!));
async function refreshSavedLevels(){
  try{
    const packs=await savedLevels(),cards=document.querySelector('.level-cards')!;
    cards.querySelectorAll('.custom-level-entry').forEach(e=>e.remove());
    for(const pack of packs){
      const draft=pack.level;
      // An older async storage read must not replace the live editing revision.
      const inWorkshop=(editor.active||editor.testing)&&editor.document.id===draft.id;
      if(!inWorkshop)pack.themes.forEach(t=>THEMES[t.id]=t);
      // Cards need metadata only. Compiling every saved sculpt here can stall
      // the menu and exhaust memory before the chosen editor even opens.
      const valid=!validateDocument(draft).some(issue=>issue.severity==='error');
      const entry=document.createElement('article');entry.className='level-entry custom-level-entry';const button=document.createElement('button');button.className='level-card custom-level '+(draft.environment==='space'?'belt':'aster');
      button.innerHTML='<div class="level-art" aria-hidden="true"><span class="sector-number">✧</span><i></i><i></i><i></i></div><small>EIGENE EXPEDITION</small><strong></strong><p></p><span>EXPEDITION STARTEN ↗</span>';
      button.querySelector('strong')!.textContent=draft.name;button.querySelector('p')!.textContent=draft.description;
      button.setAttribute('aria-label',draft.name+' starten');button.disabled=!valid;button.onclick=()=>{try{const source=inWorkshop?editor.document:draft;if(JSON.stringify(DOCUMENTS.get(source.id))!==JSON.stringify(source))registerLevel(source);const issues=inspectLevel(source);if(issues.some(i=>i.severity==='error')){el('level-storage-note').textContent=issues.find(i=>i.severity==='error')!.message;return;}startLevel(source.id);}catch(error){el('level-storage-note').textContent='Level konnte nicht gestartet werden: '+(error instanceof Error?error.message:String(error));}};const edit=document.createElement('button');edit.className='level-edit';edit.textContent='✎ Bearbeiten';edit.setAttribute('aria-label',draft.name+' bearbeiten');edit.dataset.editLevel=draft.id;edit.onclick=()=>openLevelEditor(draft);entry.append(button,edit);cards.append(entry);
    }
  }catch{el('level-storage-note').textContent='Lokaler Speicher nicht verfügbar. Level können weiterhin als JSON ausgetauscht werden.';}
}
el('import-level').onclick=()=>el('level-import-file').click();
(el('level-import-file') as HTMLInputElement).onchange=async event=>{
  const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;
  try{const pack=parsePackage(await file.text());pack.level.id='level-'+crypto.randomUUID();for(const t of pack.themes){const id='theme-'+crypto.randomUUID();if(pack.level.themeId===t.id)pack.level.themeId=id;t.id=id;THEMES[id]=t;}await saveLevel(pack);await refreshSavedLevels();el('level-storage-note').textContent='Level importiert: '+pack.level.name;}
  catch(error){el('level-storage-note').textContent=(error as Error).message;}
};
void refreshSavedLevels();
world.ready.then(() => {
  if (graphicsLost) return;
  ready = true;
  controls.clear(); world.reset(state); world.render(state, 0, 0); updateHud(0, 0);
  el('loading').hidden = true; showDialog();
  document.querySelector<HTMLButtonElement>('[data-level]')!.focus();
  previous = performance.now(); requestAnimationFrame(frame);
}).catch((error: unknown) => {
  console.error('Expedition could not be loaded:', error);
  loadingError('Die Expedition konnte nicht geladen werden.', 'Ein Teil der Fahrzeug- oder Landschaftsdaten fehlt. Versuche es erneut.');
});
