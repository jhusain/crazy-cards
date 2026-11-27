import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { GameServer } from "@crazy-eights/game-server";
import type { Card, Response } from "@crazy-eights/protocol";
import { eligibleDrawDrop } from "../src/card-gesture.ts";

// Run the real draw response/release handlers without the DOM or a live worker.
const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) &&
  ["releaseDeckDraw", "receive", "finishReceive"].includes(statement.name?.text ?? "")).map(statement => statement.getText(source)).join("\n");
const script = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup(legal = true) {
  const card: Card = { id: 30, rank: 5, suit: "clubs", special: "normal" };
  const original = { ...new GameServer().view(0), revision: 10, turn: 0 as const, hand: [], queuedCards: [], event: null, result: null };
  const next = { ...original, revision: 11, hand: [card], legalLeads: legal ? [card.id] : [], drewThisTurn: true,
    event: { kind: "draw" as const, seat: 0 as const, drawnCards: [card.id], drawCount: 1 } };
  const response: Response = { type: "state", requestId: 7, view: next };
  const painted: boolean[] = [], plays: Card[][] = [], revealed: Card[] = [];
  const context: any = {
    view: original, staged: [], playCapacity: 0, deckDraw: { requestId: 7, released: false }, pendingDrawDiscard: false,
    busy: 7, pendingCommand: { type: "draw" }, debug: false, replaying: false, canceledAutomaticRevision: undefined,
    animationTimer: undefined, autoplay: false, settings: { animationSpeed: 1 }, reducedMotion: { matches: false },
    message: undefined, suitDialog: { open: false }, eligibleDrawDrop,
    scene: { revealStockDraw: (card: Card) => revealed.push(card), setLocked() {} },
    automaticActions: { record() {} }, history: { record() {} }, cancelAutomaticAction() {}, debugPlayMessage() {},
    showDebugToast() {}, tableAnimationTime: () => 0, clearTimeout, render: (animate: boolean) => painted.push(animate),
    startAutomaticAction() {}, choosePlay: (cards: Card[]) => { plays.push(cards); context.busy = 8; },
  };
  runInNewContext(script, context);
  return { context, response, card, painted, plays, revealed };
}

test("a deck discard drop waits for release then plays directly without a hand render", () => {
  const { context, response, card, painted, plays, revealed } = setup();
  context.receive(response);
  assert.equal(context.view.revision, 10);
  assert.deepEqual(revealed, [card]);
  assert.deepEqual(painted, []);
  context.releaseDeckDraw("discard");
  assert.equal(context.view.revision, 11);
  assert.equal(plays.length, 1);
  assert.equal(plays[0]![0]!.id, card.id);
  assert.deepEqual(painted, []);
});

test("a release before the network draw response keeps its intended staging destination", () => {
  const { context, response, card, painted, plays } = setup();
  context.releaseDeckDraw("play");
  assert.deepEqual(painted, []);
  context.receive(response);
  assert.equal(context.staged.length, 1);
  assert.equal(context.staged[0].id, card.id);
  assert.deepEqual(painted, [true]);
  assert.deepEqual(plays, []);
});

test("invalid and outside deck drops animate into the hand", () => {
  for (const destination of ["discard", "play", undefined]) {
    const { context, response, painted, plays } = setup(false);
    context.receive(response);
    context.releaseDeckDraw(destination);
    assert.deepEqual(painted, [true]);
    assert.equal(context.staged.length, 0);
    assert.deepEqual(plays, []);
  }
});

test("a drawn wild holds at the release position until its suit is chosen", () => {
  const { context, response, card, painted } = setup();
  card.rank = 8; card.special = "wild";
  context.choosePlay = () => { context.suitDialog.open = true; };
  context.receive(response);
  context.releaseDeckDraw("discard");
  assert.equal(context.pendingDrawDiscard, true);
  assert.equal(context.busy, undefined);
  assert.deepEqual(painted, []);
});

test("a drawn card can append to an existing staged rank even when it cannot lead on the discard", () => {
  const { context, response, card, painted, plays } = setup(false);
  const staged: Card = { id: 4, rank: 5, suit: "hearts", special: "normal" };
  context.staged = [staged];
  response.view.hand.push(staged);
  context.receive(response);
  context.releaseDeckDraw("play");
  assert.equal(context.staged.length, 2);
  assert.equal(context.staged[0].id, staged.id);
  assert.equal(context.staged[1].id, card.id);
  assert.deepEqual(painted, [true]);
  assert.deepEqual(plays, []);
});
