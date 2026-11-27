import assert from "node:assert/strict";
import test from "node:test";
import { MAX_HAND_CARDS, type Command, type Response, type Seat } from "@crazy-eights/protocol";
import { GameServer } from "../src/index.ts";
import { standardDeck } from "../src/rules.ts";

function position(count: number, seat: Seat = 0): GameServer {
  const server = new GameServer(null, () => 0);
  const deck = standardDeck();
  const hand = deck.splice(0, count);
  const opponent = deck.splice(0, 3);
  const top = deck.pop()!;
  Object.assign(server, { hands: seat === 0 ? [hand, opponent] : [opponent, hand], turn: seat,
    stock: deck, discard: [], lastPlay: [top], lastPlaySize: 1 });
  return server;
}
function send(server: GameServer, seat: Seat, command: Command) {
  const response: Response = JSON.parse(server.handleJSON(seat, JSON.stringify({
    requestId: 1, revision: server.view(seat).revision, command,
  })));
  assert.equal(response.type, "state", JSON.stringify(response));
  return response.view;
}

test("a full hand warns without drawing, then passes on another draw for either seat", () => {
  for (const seat of [0, 1] as const) {
    const server = position(MAX_HAND_CARDS, seat);
    const before = server.view(seat);
    const warning = send(server, seat, { type: "draw" });
    assert.equal(warning.turn, seat);
    assert.equal(warning.hand.length, MAX_HAND_CARDS);
    assert.equal(warning.stockCount, before.stockCount);
    assert.equal(warning.pointsPerCard, before.pointsPerCard);
    assert.equal(warning.event?.handLimitReached, true);
    assert.equal(warning.drewThisTurn, true);
    const passed = send(server, seat, { type: "draw" });
    assert.equal(passed.event?.kind, "pass");
    assert.equal(passed.turn, 1 - seat);
    assert.equal(passed.hand.length, MAX_HAND_CARDS);
    assert.equal(passed.stockCount, before.stockCount);
  }
});

test("drawing the twenty-sixth card succeeds and the following draw warns before passing", () => {
  const server = position(MAX_HAND_CARDS - 1);
  assert.equal(send(server, 0, { type: "draw" }).hand.length, MAX_HAND_CARDS);
  assert.equal(send(server, 0, { type: "draw" }).event?.handLimitReached, true);
  assert.equal(send(server, 0, { type: "draw" }).event?.kind, "pass");
});

test("after the warning a player can play or explicitly pass, and later turns warn again", () => {
  const server = position(MAX_HAND_CARDS);
  const warned = send(server, 0, { type: "draw" });
  const id = warned.hand.find(card => card.rank === 8)!.id;
  const played = send(server, 0, { type: "play", cards: [id], suit: "hearts" });
  assert.equal(played.hand.length, MAX_HAND_CARDS - 1);
  assert.equal(played.turn, 1);
  const full = position(MAX_HAND_CARDS);
  send(full, 0, { type: "draw" });
  send(full, 0, { type: "pass" });
  send(full, 1, { type: "draw" });
  send(full, 1, { type: "pass" });
  assert.equal(send(full, 0, { type: "draw" }).event?.handLimitReached, true);
});

test("penalty pickups stop at the limit and report the actual number drawn", () => {
  for (const count of [MAX_HAND_CARDS - 1, MAX_HAND_CARDS]) {
    const server = position(count, 1);
    const deck = standardDeck();
    const two = deck.find(card => card.rank === 2 && card.suit === "spades")!;
    const top = deck.find(card => card.rank === 3 && card.suit === "spades")!;
    // Reserve the special cards for the playing seat and discard pile.
    const hand = deck.filter(card => card.id !== two.id && card.id !== top.id).slice(0, count);
    const used = new Set([...hand, two, top].map(card => card.id));
    Object.assign(server, { hands: [[two], hand], turn: 0, lastPlay: [top],
      stock: deck.filter(card => !used.has(card.id)) });
    const result = send(server, 0, { type: "play", cards: [two.id] });
    assert.equal(result.opponentCount, MAX_HAND_CARDS);
    assert.equal(result.event?.penalty?.count, MAX_HAND_CARDS - count);
  }
});
