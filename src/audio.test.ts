import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioEventTracker, GameAudio } from './audio';
import { createState } from './simulation';

test('audio events observe mining and collection once without changing simulation', () => {
  const state = createState(), tracker = new AudioEventTracker();
  assert.deepEqual(tracker.sample(state, true), []);
  const vein = state.resources.deposits.find(d => d.resource === 'copper')!;
  vein.remaining--; state.elapsed += .1;
  const before = JSON.stringify(state);
  assert.deepEqual(tracker.sample(state, true), [{ kind: 'break', resource: 'copper', amount: 1 }]);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(tracker.sample(state, true), []);
  state.resources.cargo.copper++; state.elapsed += .1;
  assert.deepEqual(tracker.sample(state, true), [{ kind: 'collect', resource: 'copper', amount: 1 }]);
});

test('audio detects collecting and unloading in one frame from total owned resources', () => {
  const state = createState(), tracker = new AudioEventTracker();
  state.resources.cargo.ferrite = 4; tracker.sample(state, true);
  state.resources.cargo.ferrite = 0; state.resources.storage.ferrite = 6; state.elapsed += .1;
  assert.deepEqual(tracker.sample(state, true), [
    { kind: 'collect', resource: 'ferrite', amount: 2 },
    { kind: 'unload', resource: 'ferrite', amount: 6 },
  ]);
  assert.deepEqual(tracker.sample(state, true), []);
});

test('audio never replays resource changes made while inactive or dead', () => {
  const state = createState(), tracker = new AudioEventTracker();
  tracker.sample(state, true); state.resources.cargo.crystal = 3;
  assert.deepEqual(tracker.sample(state, false), []);
  assert.deepEqual(tracker.sample(state, true), []);
  state.dead = true; state.resources.storage.crystal = 3;
  assert.deepEqual(tracker.sample(state, true), []);
});

test('audio pause, reset, level switch and replacement expedition suppress stale events', () => {
  let state = createState(); const tracker = new AudioEventTracker();
  tracker.sample(state, true); tracker.pause(); state.resources.cargo.ferrite = 3;
  assert.deepEqual(tracker.sample(state, true), []);
  tracker.reset(state); state.resources.cargo.ferrite = 4;
  assert.deepEqual(tracker.sample(state, true), []);
  state = createState('belt'); state.resources.storage.copper = 12;
  assert.deepEqual(tracker.sample(state, true), []);
  state = createState('belt'); state.resources.storage.copper = 18;
  assert.deepEqual(tracker.sample(state, true), []);
});

test('audio ignores rewinding simulation time and resumes at the new baseline', () => {
  const state = createState(), tracker = new AudioEventTracker();
  state.elapsed = 10; tracker.sample(state, true);
  state.elapsed = 0; state.resources.cargo.ferrite = 8;
  assert.deepEqual(tracker.sample(state, true), []);
  state.elapsed = .1; state.resources.cargo.ferrite = 9;
  assert.deepEqual(tracker.sample(state, true), [{ kind: 'collect', resource: 'ferrite', amount: 1 }]);
});

test('audio remains optional when Web Audio or browser storage is unavailable', async () => {
  const audio = new GameAudio();
  assert.equal(audio.volume, .55); assert.equal(audio.muted, false);
  await Promise.all([audio.unlock(), audio.unlock()]);
  assert.equal(audio.diagnostics().contextState, 'unavailable');
  audio.setVolume(2); assert.equal(audio.volume, 1);
  audio.setVolume(-1); assert.equal(audio.volume, 0);
  audio.setVolume(NaN); assert.equal(audio.volume, 0);
  audio.setMuted(true); assert.equal(audio.muted, true);
  audio.dispose(); audio.dispose(); await audio.unlock();
  assert.equal(audio.diagnostics().contextState, 'disposed');
});
