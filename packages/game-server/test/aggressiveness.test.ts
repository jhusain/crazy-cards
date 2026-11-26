import assert from "node:assert/strict";
import test from "node:test";
import { SUITS, type Card, type Command, type Response, type Seat, type Suit } from "@crazy-eights/protocol";
import { GameServer } from "../src/index.ts";
import { standardDeck } from "../src/rules.ts";

const card = (rank: number, suit: Suit) => standardDeck()[13 * SUITS.indexOf(suit) + rank - 1]!;
const quad = (rank: number) => SUITS.map(suit => card(rank, suit));
function position(hand: Card[], opponent: Card[], top = card(3, "clubs"), seat: Seat = 0): GameServer {
  const server = new GameServer(null, () => 0);
  Object.assign(server, { hands: seat === 0 ? [hand, opponent] : [opponent, hand], turn: seat,
    lastPlay: [top], lastPlaySize: 1, discard: [], stock: [card(6, "diamonds"), card(7, "diamonds"), card(9, "diamonds")] });
  return server;
}
function send(server: GameServer, seat: Seat, command: Command): Response["view"] {
  const response = JSON.parse(server.handleJSON(seat, JSON.stringify({
    requestId: 1, revision: server.view(seat).revision, command,
  }))) as Response;
  assert.equal(response.type, "state", JSON.stringify(response));
  return response.view;
}
function play(server: GameServer, cards: Card[], seat: Seat = 0, suit?: Suit): number {
  const view = send(server, seat, { type: "play", cards: cards.map(card => card.id), suit });
  assert.equal(view.event?.kind, "play");
  return view.event!.aggressiveness!;
}

test("ordinary plays score zero; going out adds one for either seat", () => {
  for (const seat of [0, 1] as const) {
    const three = card(3, "hearts");
    const server = position([three, card(5, "hearts")], [card(7, "spades")], undefined, seat);
    assert.equal(play(server, [three], seat), 0);
    assert.equal(play(position([three], [card(7, "spades")], undefined, seat), [three], seat), 1);
  }
});

test("only a queen of spades on top contributes its four intrinsic points", () => {
  const queen = card(12, "spades"), other = card(12, "clubs"), extra = card(5, "hearts");
  assert.equal(play(position([queen, other, extra], [extra], other), [other, queen]), 4);
  assert.equal(play(position([queen, other, extra], [extra], other), [queen, other]), 0);
  assert.equal(play(position([queen, extra], [], card(3, "spades")), [queen]), 5);
});

test("twos count actual trailing discards, even beyond the visible last play", () => {
  const two = card(2, "clubs");
  const server = position([two, card(5, "clubs")], [card(7, "hearts")], card(2, "spades"));
  Object.assign(server, { discard: [card(2, "hearts"), card(9, "hearts"), card(2, "diamonds")] });
  assert.equal(play(server, [two]), 3);
  const interrupted = position([two, card(5, "clubs")], [card(7, "hearts")]);
  Object.assign(interrupted, { discard: [card(2, "hearts")] });
  assert.equal(play(interrupted, [two]), 1);
});

test("repeated skip ranks score 1,2,2,2 then 2,3,3,3; final twos score nine", () => {
  const jacks = ["clubs", "hearts", "spades", "diamonds"].map(suit => card(11, suit as Suit));
  const aces = ["diamonds", "clubs", "spades", "hearts"].map(suit => card(1, suit as Suit));
  const twos = ["hearts", "clubs", "spades", "diamonds"].map(suit => card(2, suit as Suit));
  const server = position([...jacks, ...aces, ...twos], []);
  assert.deepEqual([...jacks, ...aces].map(card => play(server, [card])), [1, 2, 2, 2, 2, 3, 3, 3]);
  assert.equal(play(server, twos), 9);
});

test("staging a jack quadruple, ace quadruple and two quadruple emits scores 2,3,9", () => {
  const jacks = quad(11), aces = quad(1).reverse(), twos = quad(2);
  const server = position([...jacks, ...aces, ...twos], [], card(3, "hearts"));
  const first = send(server, 0, { type: "play-queue", cards: [...jacks, ...aces, ...twos].map(card => card.id) });
  assert.equal(first.event?.aggressiveness, 2);
  assert(server.stepAutomatic());
  assert.equal(server.view(0).event?.aggressiveness, 3);
  assert(server.stepAutomatic());
  assert.equal(server.view(0).event?.aggressiveness, 9);
});

test("drawing resets skip carryover, and intrinsic quadruple points do not carry", () => {
  const jacks = quad(11), two = card(2, "spades");
  const server = position([...jacks, two, card(5, "clubs")], [card(7, "hearts")], card(3, "hearts"));
  assert.equal(play(server, jacks), 2);
  send(server, 0, { type: "draw" });
  assert.equal(play(server, [two]), 1);
  const uninterrupted = position([...jacks, two, card(5, "clubs")], [card(7, "spades")], card(3, "hearts"));
  assert.equal(play(uninterrupted, jacks), 2);
  assert.equal(play(uninterrupted, [two]), 2);
  assert.equal(play(uninterrupted, [card(7, "spades")], 1), 0);
});

test("suit restoration survives skips but is awarded only on the final non-skip play", () => {
  const server = position([card(3, "hearts"), card(5, "spades")],
    [card(11, "hearts"), card(11, "diamonds"), card(7, "diamonds"), card(7, "clubs"), card(5, "hearts")]);
  assert.equal(play(server, [card(3, "hearts")]), 0);
  assert.equal(play(server, [card(11, "hearts"), card(11, "diamonds")], 1), 1);
  assert.equal(play(server, [card(7, "diamonds"), card(7, "clubs")], 1), 2);
});

test("empty opponent hands and drawing exclude the suit-restoration bonus", () => {
  const three = card(3, "hearts"), restore = card(7, "clubs");
  const empty = position([three], [card(11, "hearts"), card(7, "hearts"), restore, card(5, "hearts")]);
  play(empty, [three]);
  play(empty, [card(11, "hearts")], 1);
  assert.equal(play(empty, [card(7, "hearts"), restore], 1), 1);
  const drawn = position([three, card(5, "spades")], [card(11, "hearts"), card(7, "hearts"), restore, card(5, "hearts")]);
  play(drawn, [three]);
  play(drawn, [card(11, "hearts")], 1);
  send(drawn, 1, { type: "draw" });
  assert.equal(play(drawn, [card(7, "hearts"), restore], 1), 0);
});

test("wild suit restoration uses the declared suit and resets for a new round", () => {
  const wild = card(8, "spades");
  const server = position([card(3, "hearts"), card(5, "spades")], [wild, card(5, "hearts")]);
  play(server, [card(3, "hearts")]);
  assert.equal(play(server, [wild], 1, "clubs"), 1);
  const ending = position([card(11, "clubs")], []);
  assert.equal(play(ending, [card(11, "clubs")]), 2);
  send(ending, 0, { type: "next-round" });
  Object.assign(ending, { hands: [[card(7, "clubs"), card(5, "clubs")], [card(3, "hearts")]], turn: 0,
    lastPlay: [card(9, "clubs")] });
  assert.equal(play(ending, [card(7, "clubs")]), 0);
});

test("the aggressiveness test is debug-only and denial leaves the table untouched", () => {
  const server = new GameServer(1, () => 0);
  const before = server.view(0);
  const response = JSON.parse(server.handleJSON(0, JSON.stringify({ requestId: 1,
    revision: before.revision, command: { type: "debug-aggressiveness" } }))) as Response;
  assert.equal(response.type, "error");
  assert.deepEqual(server.view(0), before);
});

test("the debug example starts with the opponent's final card and reaches scores 2,3,9", () => {
  const server = new GameServer(1, () => 0, true);
  server.setDebug(true);
  const initial = send(server, 0, { type: "debug-aggressiveness" });
  assert.equal(initial.turn, 1);
  assert.equal(initial.opponentCount, 1);
  assert.equal(initial.stockCount, 38);
  assert.deepEqual(initial.hand.map(card => card.rank).sort((a, b) => a - b),
    [1, 1, 1, 1, 2, 2, 2, 2, 11, 11, 11, 11]);
  assert.deepEqual(initial.visibleDiscard, [card(3, "hearts")]);
  assert.deepEqual(server.view(1).hand, [card(3, "clubs")]);
  assert.equal(server.automaticMove, "computer");
  assert(server.stepAutomatic());
  assert.equal(server.view(0).opponentCount, 0);
  assert.equal(server.view(0).turn, 0);
  assert.equal(server.cpuIsUp, false); // Exhibition autoplay has been turned off.
  assert.deepEqual(server.view(0).event?.cards, [card(3, "clubs")]);
  assert.equal(server.view(0).event?.aggressiveness, 1);

  const jacks = ["clubs", "hearts", "spades", "diamonds"].map(suit => card(11, suit as Suit));
  const aces = ["diamonds", "hearts", "spades", "clubs"].map(suit => card(1, suit as Suit));
  const twos = ["clubs", "diamonds", "spades", "hearts"].map(suit => card(2, suit as Suit));
  assert.equal(send(server, 0, { type: "play-queue", cards: [...jacks, ...aces, ...twos].map(card => card.id) }).event?.aggressiveness, 2);
  assert(server.stepAutomatic());
  assert.equal(server.view(0).event?.aggressiveness, 3);
  assert(server.stepAutomatic());
  const final = server.view(0);
  assert.equal(final.event?.aggressiveness, 9);
  assert.equal(final.visibleDiscard.at(-1)?.id, card(2, "hearts").id);
  assert.equal(final.hand.length, 0);
  assert.equal(final.event?.penalty?.count, 8);
  assert.equal(final.opponentCount, 8);
  const repeated = send(server, 0, { type: "debug-aggressiveness" });
  assert.deepEqual({ ...repeated, revision: initial.revision }, initial);
});

test("reloading the debug example clears queued plays and previous match state", () => {
  const server = new GameServer(1, () => 0);
  server.setDebug(true);
  send(server, 0, { type: "debug-aggressiveness" });
  server.stepAutomatic();
  const jacks = ["clubs", "hearts", "spades", "diamonds"].map(suit => card(11, suit as Suit));
  const ace = card(1, "diamonds");
  send(server, 0, { type: "play-queue", cards: [...jacks, ace].map(card => card.id) });
  assert.equal(server.automaticMove, "queued");
  Object.assign(server, { points: [50, -50], roundsWon: [2, 1], pointsPerCard: 8,
    result: { winner: 0, points: 50 }, matchResult: { winner: 0, points: 50, roundsWon: [2, 1] } });
  const fresh = send(server, 0, { type: "debug-aggressiveness" });
  assert.deepEqual(fresh.points, [0, 0]);
  assert.deepEqual(fresh.roundsWon, [0, 0]);
  assert.equal(fresh.pointsPerCard, 1);
  assert.equal(fresh.result, null);
  assert.equal(fresh.matchResult, null);
  assert.equal(fresh.event, null);
  assert.equal(fresh.drewThisTurn, false);
  assert.deepEqual(fresh.queuedCards, []);
  assert.equal(server.automaticMove, "computer");
  const all = [...fresh.hand, ...server.view(1).hand, ...fresh.lastPlay,
    ...(Reflect.get(server, "stock") as Card[])];
  assert.equal(all.length, 52);
  assert.equal(new Set(all.map(card => card.id)).size, 52);
});

test("the eight-card debug test keeps the same player hand and opening, with cards left to scatter", () => {
  const server = new GameServer(1, () => 0);
  server.setDebug(true);
  const original = send(server, 0, { type: "debug-aggressiveness" });
  const eight = send(server, 0, { type: "debug-aggressiveness", opponentCards: 8 });
  assert.deepEqual(eight.hand, original.hand);
  assert.deepEqual(eight.lastPlay, original.lastPlay);
  assert.equal(eight.turn, 1);
  assert.equal(eight.opponentCount, 8);
  assert.equal(eight.stockCount, 31);
  const all = [...eight.hand, ...server.view(1).hand, ...eight.lastPlay,
    ...(Reflect.get(server, "stock") as Card[])];
  assert.equal(all.length, 52);
  assert.equal(new Set(all.map(card => card.id)).size, 52);
  assert(server.stepAutomatic());
  assert.deepEqual(server.view(0).event?.cards, [card(3, "clubs")]);
  assert.equal(server.view(0).turn, 0);
  assert.equal(server.view(0).opponentCount, 7);
  const jacks = ["clubs", "hearts", "spades", "diamonds"].map(suit => card(11, suit as Suit));
  const aces = ["diamonds", "hearts", "spades", "clubs"].map(suit => card(1, suit as Suit));
  const twos = ["clubs", "diamonds", "spades", "hearts"].map(suit => card(2, suit as Suit));
  assert.equal(send(server, 0, { type: "play-queue", cards: [...jacks, ...aces, ...twos].map(card => card.id) }).event?.aggressiveness, 2);
  assert(server.stepAutomatic());
  assert.equal(server.view(0).event?.aggressiveness, 3);
  assert(server.stepAutomatic());
  assert.equal(server.view(0).event?.aggressiveness, 9);
  assert.equal(server.view(0).opponentCount, 15);
});

test("eight-card setup remains debug-only and invalid hand sizes are rejected", () => {
  const server = new GameServer(1, () => 0);
  const request = (opponentCards: unknown) => JSON.parse(server.handleJSON(0, JSON.stringify({ requestId: 1,
    revision: server.view(0).revision, command: { type: "debug-aggressiveness", opponentCards } }))) as Response;
  const before = server.view(0);
  assert.equal(request(8).type, "error");
  assert.deepEqual(server.view(0), before);
  server.setDebug(true);
  for (const count of [0, 2, 7, 9, "8", null]) {
    assert.equal(request(count).type, "error");
    assert.deepEqual(server.view(0), before);
  }
});
