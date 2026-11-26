import assert from "node:assert/strict";
import test from "node:test";
import { CountdownFeedback, countdownBeat } from "../src/feedback.ts";
import { impactVibration } from "../src/play-impact.ts";
test("countdown feedback changes beat only once per elapsed second",()=>{
 assert.deepEqual([0,16,999,1000,1016,1999,2000].map(countdownBeat),[0,0,0,1,1,1,2]);
});

test("muted impacts vibrate in sync, honor the vibration setting, and cancel cleanly", () => {
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
  assert.equal(calls.length, 0);
  feedback.vibration = true;
  feedback.tableSlam(9, 600);
  assert.deepEqual(calls, [impactVibration(9, 600)]);
  feedback.stopImpactVibration();
  assert.equal(calls.at(-1), 0);
  const count = calls.length;
  feedback.stopImpactVibration();
  feedback.sound = true;
  feedback.tableSlam(9, 600);
  feedback.sound = false;
  document.hidden = true;
  feedback.tableSlam(9, 600);
  document.hidden = false;
  feedback.tableSlam(0, 600);
  assert.equal(calls.length, count);
  Reflect.deleteProperty(navigator, "vibrate");
  assert.doesNotThrow(() => feedback.tableSlam(9, 600));
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
  let disconnected = 0;
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
   createBufferSource() { return Object.assign(node(), { start() { starts.push(1); } }); },
   createBiquadFilter() { return { ...node(), frequency: { value: 0 } }; },
   createGain() { return { ...node(), gain: parameter() }; },
   createDynamicsCompressor() { return { ...node(), threshold: { value: 0 }, knee: { value: 0 },
    ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } }; },
   createOscillator() { return Object.assign(node(), { frequency: parameter(), start() { starts.push(1); }, stop() {} }); },
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
  assert(gains.includes(15 * .11)); assert(gains.includes(15 * .065));
  nodes.forEach(node => node.onended?.());
  assert.equal(disconnected, nodes.length);
 } finally {
  if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
  else Reflect.deleteProperty(globalThis, "document");
 }
});
