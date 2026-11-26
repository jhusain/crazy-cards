import assert from "node:assert/strict";
import test from "node:test";
import { CountdownFeedback, countdownBeat } from "../src/feedback.ts";
import { impactVibration } from "../src/play-impact.ts";
test("countdown feedback changes beat only once per elapsed second",()=>{
 assert.deepEqual([0,16,999,1000,1016,1999,2000].map(countdownBeat),[0,0,0,1,1,1,2]);
});

test("the removed saved vibration preference cannot disable automatic feedback", () => {
 const saved = ["document", "navigator", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
 const calls: (number | number[])[] = [];
 let written = "";
 Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
 Object.defineProperty(globalThis, "navigator", { configurable: true,
  value: { vibrate(pattern: number | number[]) { calls.push(pattern); return true; } } });
 Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: () => JSON.stringify({ sound: false, vibration: false }),
  setItem: (_key: string, value: string) => { written = value; },
 } });
 try {
  const feedback = new CountdownFeedback();
  feedback.tick();
  feedback.sound = true;
  feedback.tableSlam(4, 400);
  assert.deepEqual(calls, [25, impactVibration(4, 400)]);
  feedback.save();
  assert.deepEqual(JSON.parse(written), { sound: true });
 } finally {
  for (const [key, descriptor] of saved) {
   if (descriptor) Object.defineProperty(globalThis, key, descriptor);
   else Reflect.deleteProperty(globalThis, key);
  }
 }
});

test("impacts vibrate with sound on or off, muted countdowns vibrate, and cancellation is clean", () => {
 const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
 const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
 const document = { hidden: false };
 const calls: (number | number[])[] = [];
 const navigator = { vibrate(pattern: number | number[]) { calls.push(pattern); return true; } };
 Object.defineProperty(globalThis, "document", { value: document, configurable: true });
 Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
 try {
  const feedback = new CountdownFeedback();
  feedback.tableSlam(9, 600);
  assert.deepEqual(calls, [impactVibration(9, 600)]);
  feedback.stopImpactVibration();
  calls.length = 0;
  const testResult = feedback.testVibration();
  assert.deepEqual(calls, [600]);
  assert.match(testResult, /physical vibration is not confirmed/);
  assert.equal(feedback.sound, false); // The explicit test does not change saved preferences.
  calls.length = 0;
  feedback.tick();
  assert.deepEqual(calls, [25]);
  calls.length = 0;
  feedback.tableSlam(9, 600);
  assert.deepEqual(calls, [impactVibration(9, 600)]);
  feedback.stopImpactVibration();
  assert.equal(calls.at(-1), 0);
  feedback.stopImpactVibration();
  feedback.sound = true;
  feedback.tableSlam(9, 600);
  assert.deepEqual(calls.at(-1), impactVibration(9, 600));
  const withSound = calls.length;
  feedback.tick();
  assert.equal(calls.length, withSound);
  feedback.sound = false;
  document.hidden = true;
  feedback.tableSlam(9, 600);
  document.hidden = false;
  feedback.tableSlam(0, 600);
  assert.equal(calls.length, withSound);
  navigator.vibrate = () => false;
  assert.match(feedback.testVibration(), /rejected/);
  Reflect.deleteProperty(navigator, "vibrate");
  assert.doesNotThrow(() => feedback.tableSlam(9, 600));
  assert.match(feedback.testVibration(), /does not expose vibration support/);
 } finally {
  if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
  else Reflect.deleteProperty(globalThis, "document");
  if (savedNavigator) Object.defineProperty(globalThis, "navigator", savedNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
 }
});

test("table slaps honor mute and visibility, scale linearly, and release audio nodes", () => {
 const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
 const document = { hidden: false };
 Object.defineProperty(globalThis, "document", { value: document, configurable: true });
 try {
  const gains: number[] = [], starts: number[] = [];
  let disconnected = 0, stopped = 0;
  const nodes: { disconnect: () => void; onended?: () => void }[] = [];
  const parameter = () => ({
   setValueAtTime(value: number) { gains.push(value); },
   exponentialRampToValueAtTime(value: number) { gains.push(value); },
  });
  const node = () => {
   const result = { connect(next: unknown) { return next; }, disconnect() { disconnected++; } };
   nodes.push(result); return result;
  };
  const context = {
   state: "running", currentTime: 0, sampleRate: 1000, destination: {},
   createBuffer(_channels: number, count: number) { return { getChannelData: () => new Float32Array(count) }; },
   createBufferSource() { return Object.assign(node(), { start() { starts.push(1); }, stop(at?: number) { if (at === undefined) stopped++; } }); },
   createBiquadFilter() { return { ...node(), frequency: { value: 0, ...parameter() }, Q: { value: 0 } }; },
   createGain() { return { ...node(), gain: parameter() }; },
   createDynamicsCompressor() { return { ...node(), threshold: { value: 0 }, knee: { value: 0 },
    ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } }; },
   createOscillator() { return Object.assign(node(), { frequency: parameter(), start() { starts.push(1); }, stop(at?: number) { if (at === undefined) stopped++; } }); },
  };
  const feedback = new CountdownFeedback();
  Object.assign(feedback, { context });
  feedback.tableSlam(4);
  assert.equal(starts.length, 0);
  feedback.sound = true;
  document.hidden = true; feedback.tableSlam(4);
  document.hidden = false; feedback.tableSlam(0);
  assert.equal(starts.length, 0);
  feedback.tableSlam(1);
  assert.equal(starts.length, 2);
  assert(gains.includes(4));
  assert(gains.includes(3 * .11)); assert(gains.includes(3 * .065));
  gains.length = 0;
  feedback.tableSlam(5);
  assert.equal(starts.length, 4);
  assert(gains.includes(15 * .25)); assert(gains.includes(15 * .13));
  feedback.powerPulse(3, 1);
  assert.equal(starts.length, 4);
  feedback.powerPulse(5, .25);
  feedback.powerPulse(5, .85);
  assert.equal(starts.length, 8);
  assert(gains.includes((.05 + .25 * .16) * 1.1));
  assert(gains.includes((.05 + .85 * .16) * 1.1));
  feedback.stopPowerSounds();
  assert.equal(stopped, 6); // Explosion's two sources plus two charge pulses with two sources each.
  nodes.forEach(node => node.onended?.());
  assert.equal(disconnected, nodes.length);
 } finally {
  if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
  else Reflect.deleteProperty(globalThis, "document");
 }
});
