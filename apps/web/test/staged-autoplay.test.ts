import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { canFollowInQueue, PLAY_SLOTS, type Card } from "@crazy-eights/protocol";
import { GameServer } from "@crazy-eights/game-server";
import { AutomaticActions } from "../src/automatic-actions.ts";
import { DEFAULT_SETTINGS, readSettings } from "../src/settings.ts";
import { flickPlay, retainedFlickPlay } from "../src/card-gesture.ts";

const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const names = ["validQueue", "tapCard", "flickCard", "dropCards", "clearPlay", "stagingChanged", "cancelAutomaticAction", "pauseAutomaticAction", "automaticCandidate", "startAutomaticAction"];
const script = ts.transpileModule(source.statements.filter(statement => ts.isFunctionDeclaration(statement) &&
  names.includes(statement.name?.text ?? "")).map(statement => statement.getText(source)).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup(enabled = true) {
  const cards: Card[] = [0, 1, 2].map((id) => ({ id, rank: 6, suit: ["clubs", "hearts", "spades"][id] as Card["suit"], special: "normal" }));
  const frames = new Map<number, (now: number) => void>();
  const played: number[][] = [];
  let frameId = 0;
  let blocked = false;
  const nodes = new Map<string, any>();
  const context: any = {
    view: { ...new GameServer().view(0), revision: 10, turn: 0, seat: 0, hand: cards, legalLeads: [0], queuedCards: [], result: null },
    staged: [], playCapacity: 0, message: undefined, settings: { ...DEFAULT_SETTINGS, autoStaged: enabled },
    automaticFrame: undefined, automaticSession: undefined, canceledAutomaticRevision: undefined,
    network: undefined, autoplay: false, automaticPanel: { hidden: true }, automaticActions: new AutomaticActions(),
    canUseStock: () => true, render() {}, PLAY_SLOTS, canFollowInQueue, flickPlay, retainedFlickPlay,
    menu: { matches: () => blocked }, document: { querySelector: () => null },
    element: (id: string) => { if (!nodes.has(id)) nodes.set(id, { style: {} }); return nodes.get(id); },
    countdownBeat: (elapsed: number) => Math.floor(elapsed / 1000), feedback: { tick() {} },
    requestAnimationFrame: (fn: (now: number) => void) => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    choosePlay: (cards: Card[]) => played.push(Array.from(cards, card => card.id)),
    send() { throw new Error("Unexpected draw or pass"); },
  };
  runInNewContext(script, context);
  const tick = (now: number) => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(now); };
  return { context, tick, played, frames, block: (value: boolean) => { blocked = value; } };
}

for (const noEligible of [true, false]) {
  test(`network auto pickup shows the full countdown with ${noEligible ? "no" : "unchanged"} eligible cards`, () => {
    const { context, tick } = setup(false);
    context.network = {};
    const commands: string[] = [];
    context.send = (command: { type: string }) => commands.push(command.type);
    if (noEligible) {
      context.settings.autoPickupNoEligible = true;
      context.view.legalLeads = [];
    } else {
      context.settings.autoPickupSameEligible = true;
      context.automaticActions.record(
        { ...context.view, revision: 8, drewThisTurn: true },
        { ...context.view, revision: 9, turn: 1, event: { kind: "pass", seat: 0 } },
      );
    }
    context.startAutomaticAction();
    assert.equal(context.automaticPanel.hidden, false);
    assert.equal(context.element("automatic-title").textContent, "DRAW");
    tick(100);
    tick(3099);
    assert.deepEqual(commands, []);
    tick(3100);
    assert.equal(context.automaticPanel.hidden, true);
    assert.deepEqual(commands, ["draw"]);
  });
}

test("staged autoplay is opt-in and survives settings reload", () => {
  for (const value of [undefined, {}, { autoStaged: "true" }]) assert.equal(readSettings(value).autoStaged, false);
  assert.equal(readSettings(JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, autoStaged: true }))).autoStaged, true);
  const { context, frames } = setup(false);
  context.tapCard(0);
  assert.equal(frames.size, 0);
});

test("adding and removing staged cards restarts the full countdown and plays the current queue", () => {
  const { context, tick, played } = setup();
  context.tapCard(0); tick(0); tick(2000);
  context.tapCard(1); tick(2100); tick(5000);
  assert.deepEqual(played, []);
  context.tapCard(0); // The remaining heart cannot lead, so the queue becomes empty.
  tick(6000);
  assert.deepEqual(played, []);
  context.tapCard(0); context.tapCard(1); context.tapCard(2); tick(7000); tick(9000);
  context.tapCard(2); tick(9100); tick(12000);
  assert.deepEqual(played, []);
  tick(12100);
  assert.deepEqual(played, [[0, 1]]);
});

test("drag staging and flick appends reset the timer; clearing cancels it", () => {
  const { context, tick, played, frames } = setup();
  context.dropCards([0], "play"); tick(0); tick(2000);
  context.flickCard(1); tick(2100); tick(5000);
  assert.deepEqual(played, []);
  tick(5100);
  assert.deepEqual(played, [[0, 2, 1]]);
  context.clearPlay();
  assert.equal(frames.size, 0);
});

test("cancel suppresses the countdown until the next staging change; menus pause it", () => {
  const { context, tick, played, frames, block } = setup();
  context.tapCard(0); tick(0);
  context.cancelAutomaticAction(); context.startAutomaticAction();
  assert.equal(frames.size, 0);
  context.tapCard(1); tick(1000); tick(3000);
  block(true); context.pauseAutomaticAction(); context.startAutomaticAction();
  assert.equal(frames.size, 0);
  block(false); context.startAutomaticAction(); tick(4000); tick(6999);
  assert.deepEqual(played, []);
  tick(7000);
  assert.deepEqual(played, [[0, 1]]);
});

test("a flick commits the sampled hover order without drawing new random choices", context => {
  const { context: state, played } = setup(false);
  context.mock.method(Math, "random", () => { throw new Error("Release must not reshuffle the hover group"); });
  state.flickCard(1, [0, 2, 1]);
  assert.deepEqual(played, [[0, 2, 1]]);
});

 test("wild flicks immediately play only the selected eight, even with other eights or staged cards", () => {
  for (const hasStaged of [false, true]) for (const withOrder of [false, true]) {
    const { context, played } = setup(false);
    const wild: Card = { id: 7, rank: 8, suit: "hearts", special: "wild" };
    const other: Card = { id: 20, rank: 8, suit: "diamonds", special: "wild" };
    context.view.hand.push(wild, other);
    context.view.legalLeads.push(wild.id, other.id);
    if (hasStaged) context.tapCard(0);
    const stagedBefore = Array.from(context.staged);
    context.flickCard(wild.id, withOrder ? [wild.id] : undefined);
    assert.deepEqual(played, [[wild.id]]);
    assert.deepEqual(Array.from(context.staged), stagedBefore);
  }
});

test("disabling single-wild flicks restores group plays and preserves ordinary tap staging", () => {
  const { context, played } = setup(false);
  const wild: Card = { id: 7, rank: 8, suit: "hearts", special: "wild" };
  const other: Card = { id: 20, rank: 8, suit: "diamonds", special: "wild" };
  context.view.hand.push(wild, other);
  context.view.legalLeads.push(wild.id, other.id);
  context.settings.groupExceptWild = false;
  context.flickCard(wild.id);
  assert.deepEqual(played, [[other.id, wild.id]]);
  played.length = 0;
  context.settings.groupExceptWild = true;
  context.tapCard(wild.id);
  assert.deepEqual(played, []);
  assert.deepEqual(Array.from(context.staged, (card: Card) => card.id), [wild.id]);
});
