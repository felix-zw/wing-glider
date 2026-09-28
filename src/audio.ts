import type { FlightInput, State } from './simulation';
import { CONFIG } from './config';
import { RESOURCE_TYPES, type Inventory, type ResourceId, type ResourceState } from './resources';

export type SoundKind = 'break' | 'collect' | 'unload';
export type AudioPreview = SoundKind | 'flight' | 'laser' | 'desert';
export interface SoundEvent { kind: SoundKind; resource: ResourceId; amount: number }

interface AudioSnapshot {
  source: ResourceState;
  level: State['levelId'];
  elapsed: number;
  remaining: Inventory;
  owned: Inventory;
  delivered: Inventory;
}
const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
function snapshot(state: State): AudioSnapshot {
  const remaining: Inventory = { ferrite: 0, copper: 0, crystal: 0 };
  for (const deposit of state.resources.deposits) remaining[deposit.resource] += deposit.remaining;
  const owned = { ...state.resources.cargo };
  for (const resource of RESOURCE_TYPES) owned[resource] += state.resources.storage[resource];
  return { source: state.resources, level: state.levelId, elapsed: state.elapsed, remaining, owned, delivered: { ...state.resources.storage } };
}

/** Read-only sound events. Cargo + storage also detects collection and unloading
 * in the same simulation tick, without replaying old events after a pause/reset. */
export class AudioEventTracker {
  private previous: AudioSnapshot | null = null;
  private wasActive = false;
  reset(state?: State) { this.previous = state ? snapshot(state) : null; this.wasActive = false; }
  pause() { this.wasActive = false; }
  sample(state: State, active: boolean): SoundEvent[] {
    const current = snapshot(state), previous = this.previous, events: SoundEvent[] = [];
    const continuous = previous && this.wasActive && active && !state.dead
      && previous.source === current.source && previous.level === current.level && current.elapsed >= previous.elapsed;
    if (continuous) for (const resource of RESOURCE_TYPES) {
      const mined = previous.remaining[resource] - current.remaining[resource];
      const collected = current.owned[resource] - previous.owned[resource];
      const delivered = current.delivered[resource] - previous.delivered[resource];
      if (mined > 0) events.push({ kind: 'break', resource, amount: mined });
      if (collected > 0) events.push({ kind: 'collect', resource, amount: collected });
      if (delivered > 0) events.push({ kind: 'unload', resource, amount: delivered });
    }
    this.previous = current; this.wasActive = active && !state.dead;
    return events;
  }
}

interface Voice { sources: AudioScheduledSourceNode[]; nodes: AudioNode[]; gain: GainNode; ended: number }
interface LoopTargets { flight: number; laser: number; desert: number }

/** One graph for the application lifetime. Every source and connection is owned
 * explicitly; short events are capped and disconnect themselves when complete. */
class SoundGraph {
  readonly master: GainNode;
  readonly gate: GainNode;
  readonly flight: GainNode;
  readonly laser: GainNode;
  readonly desert: GainNode;
  readonly engineFundamental: OscillatorNode;
  readonly engineHarmonic: OscillatorNode;
  readonly engineFilter: BiquadFilterNode;
  readonly laserCarrier: OscillatorNode;
  readonly laserFilter: BiquadFilterNode;
  readonly windFilter: BiquadFilterNode;
  readonly targets: LoopTargets = { flight: 0, laser: 0, desert: 0 };
  readonly played: Record<SoundKind, number> = { break: 0, collect: 0, unload: 0 };
  readonly voices = new Set<Voice>();
  private nodes = new Set<AudioNode>();
  private sources = new Set<AudioScheduledSourceNode>();
  private noise: AudioBuffer;
  private bus: GainNode;
  private disposed = false;

  constructor(readonly context: BaseAudioContext) {
    this.bus = this.gain(1);
    const limiter = this.keep(context.createDynamicsCompressor());
    limiter.threshold.value = -16; limiter.knee.value = 12; limiter.ratio.value = 5;
    limiter.attack.value = .004; limiter.release.value = .14;
    this.gate = this.gain(0); this.master = this.gain(.55);
    this.bus.connect(limiter); limiter.connect(this.gate); this.gate.connect(this.master); this.master.connect(context.destination);
    this.noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = this.noise.getChannelData(0); let seed = 48271, brown = 0;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const white = seed / 0xffffffff * 2 - 1;
      brown = (brown + white * .018) / 1.018;
      samples[i] = white * .42 + brown * 2.8;
    }

    this.flight = this.gain(0); this.flight.connect(this.bus);
    this.engineFilter = this.filter('lowpass', 430, .5); this.engineFilter.connect(this.flight);
    this.engineFundamental = this.oscillator('sine', 57, .60, this.engineFilter);
    this.engineHarmonic = this.oscillator('triangle', 114, .19, this.engineFilter);
    this.engineHarmonic.detune.value = 4;
    this.loopNoise(this.engineFilter, .24);
    this.oscillator('sine', .18, 1.2, this.engineFundamental.frequency);

    this.laser = this.gain(0); this.laser.connect(this.bus);
    this.laserFilter = this.filter('bandpass', 1240, 1.1); this.laserFilter.connect(this.laser);
    this.laserCarrier = this.oscillator('sawtooth', 188, .28, this.laserFilter);
    this.oscillator('sine', 760, .12, this.laser);
    this.oscillator('sine', 1145, .035, this.laser);
    this.loopNoise(this.laserFilter, .19);
    this.oscillator('sine', 8.3, 4.5, this.laserCarrier.frequency);

    this.desert = this.gain(0); this.desert.connect(this.bus);
    this.windFilter = this.filter('lowpass', 650, .45);
    const windHighpass = this.filter('highpass', 95, .5);
    const windBreath = this.gain(.76);
    this.windFilter.connect(windHighpass); windHighpass.connect(windBreath); windBreath.connect(this.desert);
    this.loopNoise(this.windFilter, .9);
    this.oscillator('sine', .115, .17, windBreath.gain);
    this.oscillator('sine', .071, 145, this.windFilter.frequency);
  }
  private keep<T extends AudioNode>(node: T): T { this.nodes.add(node); return node; }
  private gain(value: number) { const node = this.keep(this.context.createGain()); node.gain.value = value; return node; }
  private filter(type: BiquadFilterType, frequency: number, q: number) {
    const node = this.keep(this.context.createBiquadFilter()); node.type = type; node.frequency.value = frequency; node.Q.value = q; return node;
  }
  private oscillator(type: OscillatorType, frequency: number, amplitude: number, destination: AudioNode | AudioParam) {
    const source = this.keep(this.context.createOscillator()); source.type = type; source.frequency.value = frequency;
    const level = this.gain(amplitude); source.connect(level);
    if (destination instanceof AudioParam) level.connect(destination); else level.connect(destination);
    source.start(); this.sources.add(source); return source;
  }
  private loopNoise(destination: AudioNode, amplitude: number) {
    const source = this.keep(this.context.createBufferSource()); source.buffer = this.noise; source.loop = true;
    const level = this.gain(amplitude); source.connect(level); level.connect(destination); source.start(); this.sources.add(source);
  }
  smooth(parameter: AudioParam, value: number, seconds = .045, at = this.context.currentTime) {
    parameter.cancelScheduledValues(at); parameter.setTargetAtTime(value, at, seconds);
  }
  setActive(active: boolean) {
    this.smooth(this.gate.gain, active ? 1 : 0, .018);
    if (!active) { this.setLoops(0, 0, 0); this.stopVoices(); }
  }
  setLoops(flight: number, laser: number, desert: number) {
    this.targets.flight = flight; this.targets.laser = laser; this.targets.desert = desert;
    this.smooth(this.flight.gain, flight, .075); this.smooth(this.laser.gain, laser, laser ? .025 : .035); this.smooth(this.desert.gain, desert, .7);
  }
  reset() {
    this.stopVoices(true);
    for (const gain of [this.gate, this.flight, this.laser, this.desert]) {
      gain.gain.cancelScheduledValues(this.context.currentTime); gain.gain.setValueAtTime(0, this.context.currentTime);
    }
    this.targets.flight = this.targets.laser = this.targets.desert = 0;
  }
  play(event: SoundEvent, at = this.context.currentTime) {
    if (this.disposed || this.voices.size >= 24) return;
    const voice: Voice = { gain: this.context.createGain(), sources: [], nodes: [], ended: 0 };
    voice.nodes.push(voice.gain); voice.gain.connect(this.bus); this.voices.add(voice); this.played[event.kind]++;
    const peak = .16 * Math.min(1.35, 1 + Math.log2(Math.max(1, event.amount)) * .09);
    const duration = event.kind === 'unload' ? .64 : event.kind === 'break' ? .24 : .28;
    voice.gain.gain.setValueAtTime(0, at); voice.gain.gain.linearRampToValueAtTime(peak, at + .006);
    voice.gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    const register = <T extends AudioScheduledSourceNode>(source: T) => {
      voice.sources.push(source); voice.nodes.push(source);
      source.onended = () => { voice.ended++; if (voice.ended === voice.sources.length) this.releaseVoice(voice); };
      return source;
    };
    const tone = (frequency: number, end: number, start: number, length: number, gain: number, type: OscillatorType = 'sine') => {
      const source = register(this.context.createOscillator()), level = this.context.createGain(); voice.nodes.push(level);
      source.type = type; source.frequency.setValueAtTime(frequency, at + start);
      source.frequency.exponentialRampToValueAtTime(end, at + start + length);
      level.gain.setValueAtTime(0, at + start); level.gain.linearRampToValueAtTime(gain, at + start + .005);
      level.gain.exponentialRampToValueAtTime(.0001, at + start + length);
      source.connect(level); level.connect(voice.gain); source.start(at + start); source.stop(at + start + length + .012);
    };
    const noise = (frequency: number, length: number, gain: number) => {
      const source = register(this.context.createBufferSource()), filter = this.context.createBiquadFilter(), level = this.context.createGain();
      source.buffer = this.noise; filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = .8; level.gain.value = gain;
      voice.nodes.push(filter, level); source.connect(filter); filter.connect(level); level.connect(voice.gain); source.start(at); source.stop(at + length);
    };
    const color = event.resource === 'crystal' ? 1.5 : event.resource === 'copper' ? 1.18 : 1;
    if (event.kind === 'break') {
      noise(1700 * color, .12, 1.2); tone(118, 44, 0, .18, .7);
      tone(470 * color, 315 * color, .01, .22, .21, 'triangle');
    } else if (event.kind === 'collect') {
      tone(610 * color, 690 * color, 0, .16, .6);
      tone(915 * color, 970 * color, .045, .20, .38);
    } else {
      noise(390, .27, .8); tone(150, 58, 0, .22, .6);
      for (const [i, frequency] of [392, 523.25, 659.25].entries()) tone(frequency, frequency, .17 + i * .085, .21, .36);
    }
  }
  private releaseVoice(voice: Voice) { voice.nodes.forEach(node => node.disconnect()); this.voices.delete(voice); }
  stopVoices(immediate = false) {
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setTargetAtTime(0, now, .006);
      for (const source of voice.sources) { try { source.stop(now + (immediate ? 0 : .025)); } catch { /* Already stopped. */ } }
      if (immediate) this.releaseVoice(voice);
    }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.stopVoices(true);
    this.sources.forEach(source => { try { source.stop(); } catch { /* Already stopped. */ } });
    this.nodes.forEach(node => node.disconnect()); this.sources.clear(); this.nodes.clear();
  }
}

export interface AudioDiagnostics {
  contextState: AudioContextState | 'locked' | 'unavailable' | 'disposed';
  active: boolean; muted: boolean; volume: number; voices: number;
  loops: LoopTargets; played: Record<SoundKind, number>;
}

/** Construct safely before a user gesture. Call unlock() from pointerdown/keydown,
 * update() after advance(), pause() on immediate UI transitions, and reset(state)
 * for every expedition start. Preferences use localStorage when available;
 * synthesis never fetches files or installs global gesture listeners. */
export class GameAudio {
  private context: AudioContext | null = null;
  private graph: SoundGraph | null = null;
  private events = new AudioEventTracker();
  private selectedVolume = .55;
  private selectedMute = false;
  private active = false;
  private disposed = false;
  private unavailable = false;
  private unlockPending: Promise<void> | null = null;
  private run: ResourceState | null = null;
  private elapsed = 0;
  private onVisibility = () => { if (document.hidden) this.pause(); };
  constructor(options: { volume?: number; muted?: boolean } = {}) {
    try {
      const savedVolume = localStorage.getItem('wing-glider-audio-volume');
      if (savedVolume !== null && Number.isFinite(Number(savedVolume))) this.selectedVolume = clamp(Number(savedVolume));
      this.selectedMute = localStorage.getItem('wing-glider-audio-muted') === 'true';
    } catch { /* Private browsing, SSR and disabled storage retain safe defaults. */ }
    if (Number.isFinite(options.volume)) this.selectedVolume = clamp(options.volume!);
    if (options.muted !== undefined) this.selectedMute = options.muted;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }
  get volume() { return this.selectedVolume; }
  get muted() { return this.selectedMute; }
  async unlock(): Promise<void> {
    if (this.disposed || this.unavailable) return;
    if (this.unlockPending) return this.unlockPending;
    try {
      if (!this.context) {
        if (typeof AudioContext === 'undefined') { this.unavailable = true; return; }
        this.context = new AudioContext({ latencyHint: 'interactive' }); this.graph = new SoundGraph(this.context);
        this.graph.master.gain.value = this.volume;
      }
      const context = this.context;
      const pending = (context.state === 'suspended' ? context.resume() : Promise.resolve())
        .catch(() => {})
        .finally(() => { if (this.unlockPending === pending) this.unlockPending = null; });
      this.unlockPending = pending; return pending;
    } catch {
      this.unavailable = true; this.graph?.dispose();
      if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    }
  }
  resume() { return this.unlock(); }
  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    this.selectedVolume = clamp(value); if (this.graph) this.graph.smooth(this.graph.master.gain, this.volume, .025);
    try { localStorage.setItem('wing-glider-audio-volume', String(this.volume)); } catch { /* Session preference still works. */ }
  }
  setMuted(muted: boolean) {
    this.selectedMute = muted; if (muted) this.pause();
    try { localStorage.setItem('wing-glider-audio-muted', String(muted)); } catch { /* Session preference still works. */ }
  }
  pause() { this.active = false; this.events.pause(); this.graph?.setActive(false); }
  reset(state?: State) {
    this.active = false; this.graph?.reset(); this.events.reset(state);
    this.run = state?.resources ?? null; this.elapsed = state?.elapsed ?? 0;
  }
  update(state: State, input: FlightInput, active: boolean) {
    if (this.disposed) return;
    if (this.run !== state.resources || state.elapsed < this.elapsed) this.reset(state);
    this.elapsed = state.elapsed;
    const canPlay = active && !state.dead && !this.muted && !(typeof document !== 'undefined' && document.hidden);
    const events = this.events.sample(state, canPlay);
    const running = canPlay && this.context?.state === 'running';
    if (this.active !== running) { this.active = running; this.graph?.setActive(running); }
    if (!running || !this.graph) return;
    const speed = clamp(Math.abs(state.speed) / CONFIG.maxSpeed);
    const thrust = clamp((Math.abs(state.forces.forward)+Math.abs(state.forces.side)*.65+Math.abs(state.forces.yaw)*.5)/CONFIG.acceleration);
    this.graph.setLoops(.028 + speed * .067 + thrust * .072, state.resources.laserActive && input.mine ? .23 : 0,
      state.environment.kind === 'planet' ? state.phase === 'storm' ? .27 : state.phase === 'warning' ? .16 : .095 : 0);
    this.graph.smooth(this.graph.engineFundamental.frequency, 55 + speed * 34 + thrust * 18, .12);
    this.graph.smooth(this.graph.engineHarmonic.frequency, 110 + speed * 68 + thrust * 36, .12);
    this.graph.smooth(this.graph.engineFilter.frequency, 330 + speed * 520 + thrust * 420, .15);
    this.graph.smooth(this.graph.laserCarrier.frequency, 185 + Math.sin(state.elapsed * 3.1) * 7, .1);
    this.graph.smooth(this.graph.laserFilter.frequency, 1180 + Math.sin(state.elapsed * 2.4) * 130, .1);
    // A mixed delivery gets one coherent latch/chime instead of three overlays.
    const delivery = events.filter(event => event.kind === 'unload');
    for (const event of events) if (event.kind !== 'unload') this.graph.play(event);
    if (delivery.length) this.graph.play({ kind: 'unload', resource: delivery[0].resource, amount: delivery.reduce((sum, event) => sum + event.amount, 0) });
  }
  diagnostics(): AudioDiagnostics {
    return { contextState: this.disposed ? 'disposed' : this.unavailable ? 'unavailable' : this.context?.state ?? 'locked',
      active: this.active, muted: this.muted, volume: this.volume, voices: this.graph?.voices.size ?? 0,
      loops: { ...(this.graph?.targets ?? { flight: 0, laser: 0, desert: 0 }) },
      played: { ...(this.graph?.played ?? { break: 0, collect: 0, unload: 0 }) } };
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.active = false;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.graph?.dispose(); this.events.reset();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
  }
}

/** Real offline rendering used by the audio review fixture; no speakers needed.
 * The exact same graph and one-shot synthesis are used in the game. */
export async function renderAudioPreview(kind: AudioPreview, volume = .55): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, 48_000 * 2, 48_000), graph = new SoundGraph(context);
  graph.master.gain.value = clamp(volume); graph.gate.gain.value = 1;
  if (kind === 'flight') { graph.flight.gain.value = .15; graph.engineFundamental.frequency.value = 85; graph.engineHarmonic.frequency.value = 170; }
  else if (kind === 'laser') graph.laser.gain.value = .23;
  else if (kind === 'desert') graph.desert.gain.value = .22;
  else graph.play({ kind, resource: kind === 'collect' ? 'crystal' : 'copper', amount: 3 }, .06);
  graph.gate.gain.setValueAtTime(1, 1.2); graph.gate.gain.linearRampToValueAtTime(0, 1.3);
  try { return await context.startRendering(); } finally { graph.dispose(); }
}
