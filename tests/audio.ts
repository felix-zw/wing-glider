import { setVelocity } from '../src/flight-motion';
import { GameAudio, renderAudioPreview, type AudioPreview } from '../src/audio';
import { createState, neutralInput } from '../src/simulation';

const output = document.getElementById('results')!, status = document.getElementById('status')!;
const run = document.getElementById('run') as HTMLButtonElement;
const previewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-sound]'));
const kinds: AudioPreview[] = ['flight', 'laser', 'break', 'collect', 'unload', 'desert'];
const cache = new Map<AudioPreview, AudioBuffer>();
let speaker: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  output.textContent += `\nPASS ${message}`;
}
function stop() { if (playing) { playing.onended = null; try { playing.stop(); } catch { /* Already ended. */ } playing.disconnect(); playing = null; } }
document.getElementById('stop')!.addEventListener('click', () => { stop(); status.textContent = 'Wiedergabe gestoppt.'; });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('pagehide', () => { stop(); if (speaker) void speaker.close().catch(() => {}); });
for (const button of previewButtons) button.addEventListener('click', async () => {
  try {
    stop(); speaker ??= new AudioContext(); await speaker.resume();
    const kind = button.dataset.sound as AudioPreview;
    const buffer = cache.get(kind) ?? await renderAudioPreview(kind); cache.set(kind, buffer);
    const source = speaker.createBufferSource(); source.buffer = buffer; source.connect(speaker.destination); playing = source;
    source.onended = () => { source.disconnect(); if (playing === source) { playing = null; status.textContent = 'Vorschau beendet.'; } };
    source.start(); status.textContent = `Wiedergabe: ${button.textContent}`;
  } catch (error) { status.textContent = `Audio nicht verfügbar: ${String(error)}`; }
});

function metrics(buffer: AudioBuffer) {
  let peak = 0, square = 0, tailSquare = 0, finite = true;
  const start = Math.floor(buffer.sampleRate * .04), end = Math.floor(buffer.sampleRate * 1.1);
  const tailStart = Math.floor(buffer.sampleRate * 1.6);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      finite &&= Number.isFinite(data[i]); peak = Math.max(peak, Math.abs(data[i]));
      if (i >= start && i < end) square += data[i] * data[i];
      if (i >= tailStart) tailSquare += data[i] * data[i];
    }
  }
  return { peak, rms: Math.sqrt(square / ((end - start) * buffer.numberOfChannels)),
    tailRms: Math.sqrt(tailSquare / ((buffer.length - tailStart) * buffer.numberOfChannels)), finite };
}

run.addEventListener('click', async () => {
  run.disabled = true; previewButtons.forEach(button => { button.disabled = true; }); stop();
  output.textContent = 'Running real Web Audio and offline signal checks…';
  const audio = new GameAudio({ volume: 0, muted: false });
  let savedMute: string | null = null, storageAvailable = false;
  try { savedMute = localStorage.getItem('wing-glider-audio-muted'); storageAvailable = true; } catch { /* Storage is optional. */ }
  try {
    await audio.unlock();
    check(audio.diagnostics().contextState === 'running', 'User gesture unlocks a real AudioContext');
    await Promise.all([audio.unlock(), audio.unlock()]);
    check(audio.diagnostics().contextState === 'running', 'Repeated concurrent unlock is harmless');
    const state = createState(), input = { ...neutralInput(), thrust: 1 };
    audio.reset(state); audio.update(state, input, true);
    check(audio.diagnostics().loops.flight > 0 && audio.diagnostics().loops.desert > 0, 'Active Aster flight enables engine and desert layers');
    setVelocity(state,0); audio.update(state, neutralInput(), true);
    const idleHum = audio.diagnostics().loops.flight;
    setVelocity(state,-4); audio.update(state, neutralInput(), true);
    const reverseCoast = audio.diagnostics().loops.flight;
    state.forces.forward=-5;audio.update(state, { ...neutralInput(), brake: 1 }, true);
    check(reverseCoast > idleHum && audio.diagnostics().loops.flight > reverseCoast, 'Reverse speed and reverse thrust raise the engine hum above idle');
    setVelocity(state,4);state.forces.forward=-42;audio.update(state, { ...neutralInput(), brake: 1 }, true);
    check(audio.diagnostics().loops.flight > reverseCoast, 'Forward braking powers front thrusters and their engine hum');
    setVelocity(state,0);
    state.resources.laserActive = true; state.elapsed += .1; audio.update(state, { ...input, mine: true }, true);
    check(audio.diagnostics().loops.laser > 0, 'An active mining laser enables its loop');
    state.resources.cargo.ferrite++; state.elapsed += .1; audio.update(state, input, true);
    check(audio.diagnostics().played.collect === 1, 'One collection schedules one event sound');
    audio.update(state, input, true);
    check(audio.diagnostics().played.collect === 1, 'An unchanged snapshot does not repeat collection audio');
    const belt = createState('belt'); audio.reset(belt); audio.update(belt, input, true);
    check(audio.diagnostics().loops.desert === 0 && audio.diagnostics().loops.flight > 0, 'Space flight has no desert ambient layer');
    check(audio.diagnostics().voices === 0, 'Level reset releases sounds from the previous expedition');
    audio.pause();
    check(!audio.diagnostics().active && Object.values(audio.diagnostics().loops).every(value => value === 0), 'Pause fades every loop and closes the audio gate');
    audio.setMuted(true); audio.update(belt, input, true);
    check(!audio.diagnostics().active, 'Mute suppresses active gameplay audio');
    audio.setMuted(false); belt.dead = true; audio.update(belt, input, true);
    check(!audio.diagnostics().active, 'Death suppresses active gameplay audio');
    audio.dispose(); audio.dispose();
    check(audio.diagnostics().contextState === 'disposed' && audio.diagnostics().voices === 0, 'Dispose stops all voices and is idempotent');

    for (const kind of kinds) {
      status.textContent = `Offline-Rendering: ${kind}`;
      const buffer = await renderAudioPreview(kind); cache.set(kind, buffer);
      const m = metrics(buffer);
      check(m.finite && m.rms > .0001, `${kind}: finite audible signal (RMS ${m.rms.toFixed(5)})`);
      check(m.peak < .98, `${kind}: no clipping (peak ${m.peak.toFixed(4)})`);
      check(m.tailRms < .000001, `${kind}: clean silent tail`);
    }
    const silent = metrics(await renderAudioPreview('laser', 0));
    check(silent.peak === 0, 'Zero master volume renders exact digital silence');
    output.textContent += '\n\nALL AUDIO CHECKS PASSED'; status.textContent = 'Prüfungen bestanden. Die Einzelklänge können jetzt angehört werden.';
  } catch (error) { output.textContent += `\nFAIL ${String(error)}`; status.textContent = 'Audio-Prüfung fehlgeschlagen.'; console.error(error); }
  finally {
    audio.dispose();
    if (storageAvailable) try {
      if (savedMute === null) localStorage.removeItem('wing-glider-audio-muted'); else localStorage.setItem('wing-glider-audio-muted', savedMute);
    } catch { /* Fixture remains usable when storage is disabled. */ }
    run.disabled = false; previewButtons.forEach(button => { button.disabled = false; });
  }
});
