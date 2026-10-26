import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function audioHarness({suspended = false} = {}) {
  const documentEvents = new Map();
  const windowEvents = new Map();
  const oscillators = [];
  const timeouts = new Map();
  const intervals = new Map();
  const warnings = [];
  let nextTimer = 0;
  let overlay = null;
  let resumeAudio;
  const resumeGate = new Promise(resolve => { resumeAudio = resolve; });
  class AudioContext {
    constructor() { this.state = suspended ? 'suspended' : 'running'; this.currentTime = 0; this.destination = {}; }
    async resume() { await resumeGate; this.state = 'running'; }
    createOscillator() {
      const oscillator = {
        frequency: {setValueAtTime() {}}, stops: [],
        connect(node) { return node; }, start() {}, disconnect() {},
        stop(at) { this.stops.push(at); if (at === undefined) this.onended?.(); }
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      return {gain: {value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}, disconnect() {}};
    }
  }
  const document = {
    documentElement: {},
    addEventListener(type, listener) { documentEvents.set(type, listener); },
    querySelector(selector) {
      if (selector === '#realCallOverlay') return overlay;
      if (selector === '#realCallStatus') return {textContent: overlay?.status || ''};
      return null;
    }
  };
  const window = {
    AudioContext,
    addEventListener(type, listener) { windowEvents.set(type, listener); },
    MutationObserver: class { observe() {} disconnect() {} }
  };
  vm.runInNewContext(fs.readFileSync('src/call-experience.js', 'utf8'), {
    window, document, console: {debug() {}, warn: (...args) => warnings.push(args)},
    setTimeout(callback) { const id = ++nextTimer; timeouts.set(id, callback); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback) { const id = ++nextTimer; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); }
  });
  return {
    api: window.FraktumCallAudio, oscillators, warnings, intervals, timeouts, resumeAudio,
    setOverlay(value) { overlay = value; },
    dispatch(type, detail) { windowEvents.get(type)?.({detail}); },
    click(action, id = '') {
      const target = {id: '', dataset: {action, id}};
      return documentEvents.get('click')({target: {closest: () => target}});
    }
  };
}

test('connected state stops every scheduled ringtone oscillator immediately', async () => {
  const harness = audioHarness();
  await harness.api.testIncoming();
  assert.equal(harness.api.state().soundMode, 'incoming');
  const tones = harness.oscillators.filter(oscillator => oscillator.stops.some(at => at > 0.025));
  assert.equal(tones.length, 10);
  harness.dispatch('fraktum:callstate', {state: 'connected'});
  assert.equal(harness.api.state().soundMode, null);
  assert.ok(tones.every(oscillator => oscillator.stops.includes(undefined)), 'future melody notes must be cancelled');
  assert.equal(harness.warnings.length, 0);
});

test('a connected call cannot restart ringback after an asynchronous audio unlock', async () => {
  const harness = audioHarness({suspended: true});
  const pendingClick = harness.click('start-call');
  harness.setOverlay({dataset: {callState: 'connected'}, status: 'Подключено'});
  harness.dispatch('fraktum:callstate', {state: 'connected'});
  harness.resumeAudio();
  await pendingClick;
  assert.equal(harness.api.state().soundMode, null);
  assert.equal(harness.timeouts.size, 0);
});

test('failure stops ringback and pagehide releases observer polling and pending timers', async () => {
  const harness = audioHarness();
  await harness.click('start-call');
  harness.setOverlay({dataset: {callState: 'calling'}, status: 'Звоним'});
  for (const callback of harness.intervals.values()) callback();
  await Promise.resolve();
  assert.equal(harness.api.state().soundMode, 'outgoing');
  harness.dispatch('fraktum:callstate', {state: 'failed'});
  assert.equal(harness.api.state().soundMode, null);
  harness.dispatch('pagehide');
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.timeouts.size, 0);
  harness.dispatch('pageshow');
  assert.equal(harness.intervals.size, 1);
});
