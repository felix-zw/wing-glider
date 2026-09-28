import { setVelocity } from '../src/flight-motion';
import * as THREE from 'three';
import { World } from '../src/world';
import { CONFIG } from '../src/config';
import { advance, createState, neutralInput, type State } from '../src/simulation';
import { type Deposit } from '../src/resources';

type Preset = 'aster-calm' | 'aster-storm' | 'aster-ridge' | 'aster-cliff' | 'aster-depleted' | 'aster-uphill' | 'aster-sidehill' | 'belt-mining' | 'belt-outcrop' | 'vehicle' | 'aster-drift' | 'aster-reverse' | 'belt-correction' | 'belt-glide';
type Workload = 'calm-flight' | 'aster-mining' | 'sheltered-storm' | 'belt-mining' | 'aster-drift' | 'space-correction';
type Quality = 'high' | 'standard';
interface Sample {
  workload: Workload; frames: number; measuredSeconds: number; averageFps: number; p95FrameMs: number; longestFrameMs: number;
  drawCallsMean: number; trianglesMean: number; geometries: number; textures: number; meetsFrameTarget: boolean;
}
interface Report {
  createdAt: string; quality: Quality; warmupSeconds: number; measurementSeconds: number; requestedResolution: string;
  drawingBuffer: { width: number; height: number }; devicePixelRatio: number; browser: string; vendor: string; renderer: string;
  gpuIdentification: string; samples: Sample[]; status: 'running' | 'completed' | 'cancelled';
}
interface BaselineSample {
  mode: 'raf-with-dom' | 'raf-only'; frames: number; measuredSeconds: number;
  averageFps: number; p95FrameMs: number; longestFrameMs: number;
}
interface BaselineReport {
  createdAt: string; quality: Quality; drawingBuffer: { width: number; height: number };
  browser: string; vendor: string; renderer: string; gpuIdentification: string;
  warmupSeconds: number; measurementSeconds: number; simulationAndRenderingDisabled: true;
  samples: BaselineSample[]; status: 'running' | 'completed' | 'cancelled';
}
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const world = new World(el('viewport'));
const status = el('status'), results = el('results'), panel = el('panel'), reopen = el<HTMLButtonElement>('reopen');
const benchmark = el<HTMLButtonElement>('benchmark'), stop = el<HTMLButtonElement>('stop'), download = el<HTMLButtonElement>('download');
const maneuverBenchmark=el<HTMLButtonElement>('maneuver-benchmark');
const baselineButton = el<HTMLButtonElement>('baseline'), baselineStatus = el('baseline-status'), baselineResults = el('baseline-results');
const jsonToggle = el<HTMLButtonElement>('json-toggle'), jsonText = el<HTMLTextAreaElement>('report-json');
const quality = el<HTMLSelectElement>('quality'), resolution = el<HTMLSelectElement>('resolution'), warmup = el<HTMLInputElement>('warmup');
const progress = el<HTMLProgressElement>('progress');
let state = createState(), currentPreset: Preset = 'aster-calm', busy = true, loaded = false, stopRequested = false;
let report: Report | null = null;
let baselineReport: BaselineReport | null = null;
const presets = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-preset]'));
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
function setBusy(value: boolean) {
  busy = value; benchmark.disabled = value; maneuverBenchmark.disabled=value; quality.disabled = value; resolution.disabled = value; warmup.disabled = value;
  baselineButton.disabled = value; jsonToggle.disabled = value || (!report && !baselineReport);
  presets.forEach(button => button.disabled = value);
}
setBusy(true);
function applyResolution() {
  const canvas = world.renderer.domElement;
  if (resolution.value === '1080') {
    world.renderer.setPixelRatio(1); world.resize(1920, 1080);
    const width = Math.min(window.innerWidth, window.innerHeight * 16 / 9);
    canvas.style.width = `${width}px`; canvas.style.height = `${width * 9 / 16}px`;
    canvas.style.margin = 'auto';
  } else {
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); world.resize();
    canvas.style.width = '100vw'; canvas.style.height = '100vh'; canvas.style.margin = '0';
  }
}
function placeForMining(s: State, d: Deposit) {
  s.x = d.x + d.surface!.nx * 7; s.z = d.z + d.surface!.nz * 7; setVelocity(s,0);
  s.heading = Math.PI * 0.15; s.turret = Math.atan2(d.x - s.x, -(d.z - s.z));
}
function buildPreset(preset: Preset) {
  const s = createState(preset.startsWith('belt-') ? 'belt' : 'aster');
  s.elapsed = 12.375;
  if(preset==='aster-drift') {
    s.x=80;s.z=140;s.heading=-.6;setVelocity(s,26);advance(s,{...neutralInput(),thrust:1,steer:.65,handbrake:1},.9);
  } else if(preset==='aster-reverse') {
    s.heading=-.6;
    advance(s,{...neutralInput(),brake:1},.01);advance(s,neutralInput(),.01);
    advance(s,{...neutralInput(),brake:1},.8);
  } else if(preset==='belt-correction'||preset==='belt-glide') {
    s.heading=.8;setVelocity(s,18,-12);
    advance(s,{...neutralInput(),handbrake:preset==='belt-glide'?1:0},.2);
  } else if (preset === 'aster-storm') {
    s.x = 0; s.z = 4; s.heading = Math.PI * 0.2; s.phase = 'storm'; s.phaseTime = 6;
  } else if (preset === 'aster-uphill') {
    s.x=44;s.z=33;s.heading=0;s.turret=0;
  } else if (preset === 'aster-sidehill') {
    s.x=65;s.z=13;s.heading=0;s.turret=0;
  } else if (preset === 'aster-ridge') {
    s.x=-40; s.z=46; s.heading=-.6;
  } else if (preset === 'aster-cliff') {
    const deposit = s.resources.deposits.find(d => d.surface?.kind === 'wall' && d.surface.nz > .5)!;
    placeForMining(s, deposit);
    advance(s, { ...neutralInput(), aim: s.turret, mine: true }, 1.95);
  } else if (preset === 'aster-depleted') {
    const deposit = s.resources.deposits[1]; placeForMining(s, deposit);
    s.resources.deposits.filter(d => d.structureId === deposit.structureId).forEach(d => { d.remaining = 0; });
  } else if (preset === 'belt-outcrop') {
    const deposit = s.resources.deposits.find(d => d.resource === 'crystal' && d.surface!.nz > .3)!;
    placeForMining(s, deposit);
  } else if (preset === 'belt-mining') {
    const deposit = s.resources.deposits[1]; placeForMining(s, deposit);
    advance(s, { ...neutralInput(), aim: s.turret, mine: true }, 1.95);
  } else if (preset === 'aster-calm') {
    const deposit = s.resources.deposits[1]; placeForMining(s, deposit);
    advance(s, { ...neutralInput(), aim: s.turret, mine: true }, 1.95);
  } else { s.x = 10; s.z = 8; s.heading = -0.6; s.turret = -0.6; }
  return s;
}
async function showPreset(preset: Preset) {
  if (!loaded || busy) return;
  setBusy(true); currentPreset = preset; state = buildPreset(preset);
  world.camera.zoom = ['vehicle','aster-uphill','aster-sidehill','aster-drift','aster-reverse','belt-correction','belt-glide'].includes(preset) ? 2.6 : preset === 'aster-ridge' ? 1.1 : ['aster-cliff', 'aster-depleted', 'belt-outcrop'].includes(preset) ? 1.8 : 1; world.camera.updateProjectionMatrix();
  world.reset(state); applyResolution();
  status.textContent = 'Standbild wird vorbereitet…';
  // Settle camera and atmospheric transitions deterministically, then stop all
  // render ticks. The simulation is fixed throughout these preparatory frames.
  for (let i = 0; i < 30; i++) { world.render(state, 1 / 15, preset === 'vehicle' ? 0.5 : 0); await frame(); }
  world.render(state, 0, preset === 'vehicle' ? 0.5 : 0);
  const buffer = world.renderer.getDrawingBufferSize(new THREE.Vector2());
  status.textContent = `${presets.find(b => b.dataset.preset === preset)?.textContent}\nFester Zustand · ${buffer.x} × ${buffer.y} Pixel · ${quality.value === 'high' ? 'Hoch' : 'Standard'}`;
  setBusy(false);
}
function togglePanel() { panel.hidden = !panel.hidden; reopen.hidden = !panel.hidden; }
el('hide').addEventListener('click', togglePanel); reopen.addEventListener('click', togglePanel);
window.addEventListener('keydown', event => { if (event.code === 'KeyH' && !(event.target instanceof HTMLSelectElement)) togglePanel(); });
presets.forEach(button => button.addEventListener('click', () => { void showPreset(button.dataset.preset as Preset); }));
quality.addEventListener('change', () => { world.setQuality(quality.value as Quality); void showPreset(currentPreset); });
resolution.addEventListener('change', () => { void showPreset(currentPreset); });
window.addEventListener('resize', () => { if (loaded && !busy) { applyResolution(); world.render(state, 0, 0); } });
stop.addEventListener('click', () => { stopRequested = true; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (report?.status === 'running' || baselineReport?.status === 'running')) stopRequested = true;
});

function buildWorkload(workload: Workload) {
  const s = createState(workload === 'belt-mining'||workload==='space-correction' ? 'belt' : 'aster');
  if (workload === 'calm-flight') { s.x = 24; s.z = 36; setVelocity(s,8); }
  else if (workload === 'sheltered-storm') { s.x = 0; s.z = 4; s.phase = 'storm'; s.phaseTime = 6; }
  else if(workload==='aster-drift'){s.x=80;s.z=140;setVelocity(s,25);}
  else if(workload==='space-correction'){s.x=20;s.z=35;setVelocity(s,18,-10);}
  else placeForMining(s, s.resources.deposits[1]);
  return s;
}
function advanceWorkload(workload: Workload, seconds: number) {
  const input = neutralInput();
  // Keep the named weather workload throughout its 60-second sample. Flight,
  // extraction, collection, collisions and moving hazards use real advance().
  if (state.environment.kind === 'planet') { state.phase = workload === 'sheltered-storm' ? 'storm' : 'calm'; state.phaseTime = 0; }
  if (workload === 'calm-flight') { input.thrust = CONFIG.drag / CONFIG.acceleration; input.steer = (8 / 10) / CONFIG.turnRate; }
  else if(workload==='aster-drift'){input.thrust=1;input.steer=.65;input.handbrake=state.elapsed%6>3?1:0;}
  else if(workload==='space-correction'){input.thrust=.6;input.steer=Math.sin(state.elapsed*.7)*.65;input.handbrake=state.elapsed%8>5?1:0;}
  else if (workload.endsWith('mining')) {
    const deposit = state.resources.deposits.find(d => d.id === state.resources.targetId && d.remaining > 0)
      ?? state.resources.deposits.find(d => d.resource === 'copper' && d.remaining > 0)
      ?? state.resources.deposits.find(d => d.remaining > 0);
    if (deposit) { placeForMining(state, deposit); input.aim = state.turret; input.mine = true; }
    // A performance fixture keeps its actor alive to maintain a comparable
    // rendering workload; impact simulation and all twelve hazards still run.
    state.health = CONFIG.maxHealth; state.dead = false;
  }
  advance(state, input, Math.min(seconds, 0.1)); world.render(state, Math.min(seconds, 0.1), input.thrust);
}
function gpuInfo() {
  const gl = world.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
  const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  const masked = !debug || /SwiftShader|llvmpipe|Software|WebKit WebGL|ANGLE \(Unknown/i.test(renderer);
  return { vendor, renderer, gpuIdentification: masked ? 'GPU hardware is not verified by this browser report.' : 'Browser-reported adapter name; hardware model was not independently verified.' };
}
function printReport() {
  if (!report) return;
  results.textContent = `${report.vendor}\n${report.renderer}\n${report.drawingBuffer.width}×${report.drawingBuffer.height} · ${report.quality} · warmup ${report.warmupSeconds}s\n\n`
    + report.samples.map(s => `${s.workload}\n${s.averageFps.toFixed(1)} FPS · p95 ${s.p95FrameMs.toFixed(2)} ms · longest ${s.longestFrameMs.toFixed(1)} ms\n${s.drawCallsMean.toFixed(0)} draws · ${Math.round(s.trianglesMean).toLocaleString()} triangles · GPU objects ${s.geometries} geom / ${s.textures} tex\n${s.meetsFrameTarget ? 'PASS' : 'BELOW TARGET'}: ≥60 average FPS / p95 <20ms`).join('\n\n');
}
function printBaseline() {
  if (!baselineReport) return;
  baselineResults.textContent = `RAF-BASELINE · ohne Simulation und WebGL-Renderaufrufe\n${baselineReport.drawingBuffer.width}×${baselineReport.drawingBuffer.height} · ${baselineReport.quality}\n`
    + baselineReport.samples.map(s => `\n${s.mode === 'raf-with-dom' ? 'RAF + Statusupdates' : 'RAF ohne DOM-Updates'}\n${s.averageFps.toFixed(2)} FPS · p95 ${s.p95FrameMs.toFixed(2)} ms · max ${s.longestFrameMs.toFixed(2)} ms\n${s.frames} Frames / ${s.measuredSeconds.toFixed(3)} s`).join('\n')
    + '\n\nDiagnose des Browser-/Compositor-Takts. Das 60-FPS-Ziel und die Spielmessungen bleiben unverändert.';
}
function updateJSON(persist = false) {
  const data = { version: 1, performance: report, schedulerBaseline: baselineReport };
  jsonText.value = JSON.stringify(data, null, 2);
  jsonToggle.disabled = busy || (!report && !baselineReport);
  if (persist) try { sessionStorage.setItem('wing-glider-qa-report', jsonText.value); } catch { /* Copyable JSON remains available if storage is disabled. */ }
}
jsonToggle.addEventListener('click', () => {
  jsonText.hidden = !jsonText.hidden;
  jsonToggle.setAttribute('aria-expanded', String(!jsonText.hidden));
  jsonToggle.textContent = jsonText.hidden ? 'JSON anzeigen' : 'JSON ausblenden';
  if (!jsonText.hidden) { updateJSON(); jsonText.focus(); jsonText.select(); }
});
async function measure(workloads:Workload[],measurementSeconds:number) {
  if (busy || !loaded) return;
  setBusy(true); stop.disabled = false; stopRequested = false; download.disabled = true; progress.value = 0;
  world.camera.zoom = 1; world.camera.updateProjectionMatrix(); applyResolution();
  const buffer = world.renderer.getDrawingBufferSize(new THREE.Vector2()), warmupSeconds = warmup.checked ? 3 : 0;
  report = { createdAt: new Date().toISOString(), quality: quality.value as Quality, warmupSeconds, measurementSeconds,
    requestedResolution: resolution.value, drawingBuffer: { width: buffer.x, height: buffer.y }, devicePixelRatio: window.devicePixelRatio,
    browser: navigator.userAgent, ...gpuInfo(), samples: [], status: 'running' };
  printReport();
  try {
    for (let index = 0; index < workloads.length && !stopRequested; index++) {
      const workload = workloads[index]; state = buildWorkload(workload); world.reset(state); applyResolution();
      let previous = await frame(), warmStart = previous;
      while (previous - warmStart < warmupSeconds * 1000 && !stopRequested) {
        const now = await frame(); advanceWorkload(workload, (now - previous) / 1000); previous = now;
        status.textContent = `${index + 1}/${workloads.length} ${workload} · Aufwärmen ${Math.max(0, warmupSeconds - (now - warmStart) / 1000).toFixed(1)} s`;
      }
      if (stopRequested) break;
      const times: number[] = []; let drawCalls = 0, triangles = 0, measuredStart = previous;
      while (previous - measuredStart < measurementSeconds*1000 && !stopRequested) {
        const now = await frame(), delta = now - previous; previous = now;
        advanceWorkload(workload, delta / 1000); times.push(delta);
        drawCalls += world.renderer.info.render.calls; triangles += world.renderer.info.render.triangles;
        const elapsed = (now - measuredStart) / 1000;
        progress.value = (index + Math.min(1, elapsed / measurementSeconds)) / workloads.length;
        status.textContent = `${index + 1}/${workloads.length} ${workload} · ${elapsed.toFixed(1)} / ${measurementSeconds} s\n${(times.length / elapsed).toFixed(1)} FPS bisher · Tab sichtbar halten`;
      }
      if (stopRequested) break;
      const ordered = [...times].sort((a, b) => a - b), measuredSeconds = (previous - measuredStart) / 1000;
      const averageFps = times.length / measuredSeconds, p95FrameMs = ordered[Math.ceil(ordered.length * 0.95) - 1];
      report.samples.push({ workload, frames: times.length, measuredSeconds, averageFps, p95FrameMs, longestFrameMs: ordered.at(-1)!,
        drawCallsMean: drawCalls / times.length, trianglesMean: triangles / times.length,
        geometries: world.renderer.info.memory.geometries, textures: world.renderer.info.memory.textures,
        meetsFrameTarget: averageFps >= 60 && p95FrameMs < 20 });
      printReport();
    }
    report.status = stopRequested ? 'cancelled' : 'completed';
    status.textContent = stopRequested ? 'Messung abgebrochen. Nur vollständig gemessene Szenen werden gespeichert.'
      : `Messung abgeschlossen. ${report.samples.filter(s => s.meetsFrameTarget).length}/${workloads.length} Szenen erreichen das Frame-Ziel.\n${buffer.x === 1920 && buffer.y === 1080 ? '1080p-Zielauflösung bestätigt.' : 'Andere Bildgröße: Ergebnis bestätigt kein 1080p-Leistungsziel.'}`;
  } catch (error) { report.status = 'cancelled'; status.textContent = `Messfehler: ${String(error)}`; }
  finally { setBusy(false); stop.disabled = true; download.disabled = false; updateJSON(true); world.render(state, 0, 0); }
}
benchmark.addEventListener('click',()=>void measure(['calm-flight','aster-mining','sheltered-storm','belt-mining'],60));
maneuverBenchmark.addEventListener('click',()=>void measure(['aster-drift','space-correction'],15));

baselineButton.addEventListener('click', async () => {
  if (busy || !loaded) return;
  setBusy(true); stop.disabled = false; stopRequested = false;
  const buffer = world.renderer.getDrawingBufferSize(new THREE.Vector2());
  baselineReport = { createdAt: new Date().toISOString(), quality: quality.value as Quality,
    drawingBuffer: { width: buffer.x, height: buffer.y }, browser: navigator.userAgent, ...gpuInfo(),
    warmupSeconds: 1, measurementSeconds: 10, simulationAndRenderingDisabled: true, samples: [], status: 'running' };
  // Keep the current scene, canvas, panel and browser settings. Only the RAF
  // scheduling/DOM workload changes; the original performance report is untouched.
  printBaseline();
  try {
    for (const mode of ['raf-with-dom', 'raf-only'] as const) {
      baselineStatus.textContent = `${mode === 'raf-with-dom' ? '1/2 RAF + Statusupdates' : '2/2 RAF ohne DOM-Updates'}\n1 s Aufwärmen + 10 s Messung. ${mode === 'raf-only' ? 'Die Anzeige bleibt während dieser Probe stehen.' : 'Simulation und Rendering bleiben angehalten.'}`;
      let previous = await frame(); const warmStart = previous;
      while (previous - warmStart < 1000 && !stopRequested) previous = await frame();
      if (stopRequested) break;
      const measuredStart = previous, times: number[] = [];
      while (previous - measuredStart < 10000 && !stopRequested) {
        const now = await frame(); times.push(now - previous); previous = now;
        if (mode === 'raf-with-dom') {
          const elapsed = (now - measuredStart) / 1000;
          progress.value = Math.min(1, elapsed / 10) / 2;
          baselineStatus.textContent = `1/2 RAF + Statusupdates · ${elapsed.toFixed(1)} / 10 s\n${(times.length / elapsed).toFixed(1)} FPS bisher · Tab sichtbar halten`;
        }
      }
      if (stopRequested) break;
      const sorted = [...times].sort((a, b) => a - b), measuredSeconds = (previous - measuredStart) / 1000;
      baselineReport.samples.push({ mode, frames: times.length, measuredSeconds, averageFps: times.length / measuredSeconds,
        p95FrameMs: sorted[Math.ceil(sorted.length * 0.95) - 1], longestFrameMs: sorted.at(-1)! });
      printBaseline();
    }
    baselineReport.status = stopRequested ? 'cancelled' : 'completed';
    if (!stopRequested) progress.value = 1;
    baselineStatus.textContent = stopRequested ? 'Baseline abgebrochen. Nur vollständige Proben gespeichert.' : 'RAF-Baseline abgeschlossen. Spielbenchmark und Zielbewertung unverändert.';
  } catch (error) { baselineReport.status = 'cancelled'; baselineStatus.textContent = `Baseline-Fehler: ${String(error)}`; }
  finally { setBusy(false); stop.disabled = true; updateJSON(true); }
});
download.addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `wing-glider-${report.quality}-${report.createdAt.replace(/[:.]/g, '-')}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
world.ready.then(async () => {
  loaded = true; setBusy(false); world.setQuality('high'); await showPreset('aster-calm');
}).catch(error => { status.textContent = `Laden fehlgeschlagen: ${String(error)}`; });

try {
  const saved = JSON.parse(sessionStorage.getItem('wing-glider-qa-report') ?? 'null');
  if (saved?.version === 1) {
    if (saved.performance?.status !== 'running' && Array.isArray(saved.performance?.samples)) report = saved.performance;
    if (saved.schedulerBaseline?.status !== 'running' && Array.isArray(saved.schedulerBaseline?.samples)) baselineReport = saved.schedulerBaseline;
    printReport(); printBaseline(); updateJSON(); download.disabled = !report;
  }
} catch { /* A missing or obsolete saved report must not prevent visual review. */ }
