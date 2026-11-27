import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as gestures from "../src/card-gesture.ts";
import * as protocol from "@crazy-eights/protocol";
import * as layout from "../src/table-layout.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

// Exercise the table's real pointer handlers and position cache without a WebGL renderer.
const compiled = ts.transpileModule(readFileSync(new URL("../src/table.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const output: any = {};
runInNewContext(compiled, { exports: output, require: (name: string) => {
  if (name === "phaser") return {
    Scene: class {}, GameObjects: { Container: class {} },
    Math: { Linear: (a: number, b: number, t: number) => a + (b - a) * t,
      Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)), Easing: { Sine: { InOut: (t: number) => t } } },
  };
  if (name === "./card-gesture.ts") return gestures;
  if (name === "./table-layout.ts") return layout;
  if (name === "@crazy-eights/protocol") return protocol;
  return {};
} });

function setup(staged = false) {
  const cards: protocol.Card[] = [
    { id: 30, rank: 5, suit: "clubs", special: "normal" },
    { id: 17, rank: 5, suit: "diamonds", special: "normal" },
    { id: 44, rank: 6, suit: "spades", special: "normal" },
  ];
  const scene = Object.create(output.CardTable.prototype);
  const events: string[] = [];
  const tweens: any[] = [];
  scene.state = { view: { hand: cards, legalLeads: [30], turn: 0, seat: 0, queuedCards: [] },
    staged: staged ? cards.slice(0, 2) : [], flickSettings: DEFAULT_SETTINGS };
  scene.board = { clientWidth: 400, clientHeight: 800, getBoundingClientRect: () => ({ width: 400, height: 800 }) };
  scene.cardImages = new Map(cards.map((card, i) => [card.id, { x: i * 30, y: 400, depth: i,
    setDepth(depth: number) { this.depth = depth; } }]));
  scene.priorCardPositions = new Map(cards.map((card, i) => [card.id, { x: i * 30, y: 400, width: 100 }]));
  scene.dragged = new Map();
  scene.placeImage = (image: any, position: any) => Object.assign(image, { x: position.x, y: position.y });
  scene.tween = (_duration: number, frame: any, done: any) => {
    const tween = { frame, done, stop() {} }; tweens.push(tween); return tween;
  };
  scene.controls = { flickCard: (id: number) => events.push(`flick:${id}`), tapCard: (id: number) => events.push(`tap:${id}`),
    playQueue: () => events.push("play"), clearPlay: () => events.push("clear") };
  const button: any = {};
  scene.bindCardGesture(button, 17, staged);
  const pointer = (x: number, y: number, time = 0, id = 1) => ({
    clientX: x, clientY: y, timeStamp: time, pointerId: id, isPrimary: true, button: 0, isTrusted: false,
  });
  const finishReturn = () => { const tween = tweens.at(-1)!; tween.frame(1); tween.done(); };
  return { scene, events, button, pointer, finishReturn };
}

test("hand drag follows the whole eligible group and preserves its release positions for the flight", () => {
  const { scene, button, pointer, events } = setup();
  button.onpointerdown(pointer(100, 500));
  button.onpointermove(pointer(103, 480, 30));
  assert.deepEqual([...scene.dragged.keys()], [30, 17]);
  for (const id of [30, 17]) {
    assert.equal(scene.cardImages.get(id).y, 380);
    assert.equal(scene.priorCardPositions.get(id).y, 380);
  }
  assert.equal(scene.cardImages.get(44).y, 400);
  // An unfinished staging animation cannot steal a card from the finger.
  assert.equal(scene.moveCard(scene.cardImages.get(17), { x: 0, y: 0, width: 100 }, { x: 0, y: 0, width: 100 }, .5, 17).y, 380);
  button.onpointerup(pointer(105, 450, 90));
  assert.deepEqual(events, ["flick:17"]);
  assert.equal(scene.priorCardPositions.get(17).y, 350);
  assert.equal(scene.cardImages.get(17).y, 350);
  button.onclick({ detail: 1 });
  assert.deepEqual(events, ["flick:17"]);
});

test("small jitter stays a tap; a deliberate short drag returns without a click", () => {
  const { scene, button, pointer, events, finishReturn } = setup();
  button.onpointerdown(pointer(100, 500));
  button.onpointermove(pointer(102, 495, 20));
  assert.equal(scene.dragged.size, 0);
  button.onpointerup(pointer(102, 495, 50)); button.onclick({ detail: 1 });
  assert.deepEqual(events, ["tap:17"]);
  button.onpointerdown(pointer(100, 500));
  button.onpointermove(pointer(100, 492, 20));
  button.onpointerup(pointer(100, 492, 50)); button.onclick({ detail: 1 });
  assert.deepEqual(events, ["tap:17"]);
  finishReturn();
  assert.equal(scene.cardImages.get(17).y, 400);
  assert.equal(scene.dragged.size, 0);
});

test("staged groups track upward, leftward and downward flicks together", () => {
  for (const [dx, dy, action] of [[0, -50, "play"], [-50, 0, "play"], [0, 50, "clear"]] as const) {
    const { scene, button, pointer, events } = setup(true);
    button.onpointerdown(pointer(100, 500));
    button.onpointermove(pointer(100 + dx, 500 + dy, 30));
    for (const id of [30, 17]) assert.equal(scene.cardImages.get(id).y, 400 + dy);
    button.onpointerup(pointer(100 + dx, 500 + dy, 100));
    assert.deepEqual(events, [action]);
    assert.equal(scene.priorCardPositions.get(17).x, 30 + dx);
  }
});

test("cancellation, capture loss and slow releases return the group and suppress taps", () => {
  for (const ending of ["onpointercancel", "onlostpointercapture", "onpointerup"]) {
    const { scene, button, pointer, events, finishReturn } = setup();
    button.onpointerdown(pointer(100, 500));
    button.onpointermove(pointer(100, 450, 30));
    button[ending](pointer(100, 450, 700));
    button.onclick({ detail: 1 });
    finishReturn();
    assert.deepEqual(events, []);
    assert.equal(scene.cardImages.get(17).y, 400);
    assert.equal(scene.cardImages.get(17).depth, 1);
  }
});
