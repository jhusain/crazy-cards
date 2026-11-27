import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "../src/index.ts";
import { standardDeck } from "../src/rules.ts";

test("full exports require debug mode and an AI opponent", () => {
  const ai = new GameServer(1, () => 0);
  assert.throws(() => ai.exportDebugState(), /AI game in debug mode/);
  ai.setDebug(true);
  assert.equal(ai.exportDebugState().cpuSeat, 1);
  ai.setDebug(false);
  assert.throws(() => ai.exportDebugState(), /AI game in debug mode/);
  const human = new GameServer(null, () => 0);
  human.setDebug(true);
  assert.throws(() => human.exportDebugState(), /AI game in debug mode/);
});

test("export preserves hidden cards, pile order, called suits, queued plays and round state without modifying the game", () => {
  const server = new GameServer(1, () => 0);
  const cards = standardDeck();
  const wild = cards.find(card => card.special === "wild")!;
  const remaining = cards.filter(card => card !== wild);
  Object.assign(server, {
    hands: [remaining.splice(0, 4), remaining.splice(0, 5)],
    discard: remaining.splice(0, 7), stock: remaining,
    lastPlay: [{ ...wild, calledSuit: "spades" }],
    queued: { seat: 0, moves: [{ type: "play", cards: [0] }] },
    points: [12, -12], round: 2, pointsPerCard: 4,
  });
  server.setDebug(true);
  const before = server.saveMatch();
  const exported = JSON.parse(JSON.stringify(server.exportDebugState()));
  for (const [key, value] of Object.entries(before)) assert.deepEqual(exported[key], value, key);
  const allCards = [...exported.hands.flat(), ...exported.stock, ...exported.discard, ...exported.lastPlay];
  assert.equal(allCards.length, 52);
  assert.equal(new Set(allCards.map(card => card.id)).size, 52);
  assert.equal(exported.lastPlay.at(-1).calledSuit, "spades");
  exported.hands[0].pop();
  assert.deepEqual(server.saveMatch(), before);
});

test("the player protocol never returns a full state export in a human match", () => {
  const server = new GameServer(null, () => 0);
  server.setDebug(true);
  const response = JSON.parse(server.handleJSON(0, JSON.stringify({
    requestId: 1, revision: server.view(0).revision, command: { type: "export-game-state" },
  })));
  assert.equal(response.type, "error");
  assert.equal(response.view.hands, undefined);
  assert.equal(response.view.stock, undefined);
  assert.equal(response.state, undefined);
});
