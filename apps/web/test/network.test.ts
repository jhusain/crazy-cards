import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "@crazy-eights/game-server";
import { SUITS, type Seat, type TableView, type Response } from "@crazy-eights/protocol";
import { invitationFromHash, invitationUrl, isNetworkRequest } from "../src/network-protocol.ts";
import { OpponentReplay } from "../src/opponent-replay.ts";

test("invitation round-trips a Pages subpath without putting secrets in the query", () => {
  const invite = { room: crypto.randomUUID(), password: crypto.randomUUID() };
  const url = new URL(invitationUrl("https://jhusain.github.io/crazy-cards/?debug=true#old", invite));
  assert.equal(url.pathname, "/crazy-cards/");
  assert.equal(url.search, "?debug=true");
  assert.deepEqual(invitationFromHash(url.hash), invite);
  assert.equal(invitationFromHash("#match=abc"), undefined);
  assert.equal(invitationFromHash("#match=a&key=b&host="), undefined);
});

test("network requests exclude debug, autoplay, and transport controls", () => {
  for (const type of ["draw", "pass", "play", "play-queue", "snapshot", "restart", "next-round"]) {
    assert(isNetworkRequest({ requestId: 1, revision: 2, command: { type } }));
  }
  for (const value of [null, {}, { debug: true }, { autoplay: true }, { command: { type: "draw" } },
    ...["debug-reshuffle", "debug-aggressiveness", "auto-play"].map(type => ({ requestId: 1, revision: 2, command: { type } }))]) {
    assert.equal(isNetworkRequest(value), false);
  }
});

for (const seat of [0, 1] as const) test(`network replay for seat ${seat} excludes every local action`, () => {
  const replay = new OpponentReplay();
  replay.network = true;
  const other = (1 - seat) as Seat;
  const initial = new GameServer(null).view(seat);
  const frames: TableView[] = [initial];
  const add = (actor: Seat, kind: "draw" | "pass" | "play", turn: Seat) => {
    const before = frames.at(-1)!;
    const after = { ...before, revision: before.revision + 1, turn, event: { seat: actor, kind } };
    replay.record(before, after); frames.push(after); return after;
  };
  add(seat, "play", other);
  const first = add(other, "play", other);
  const second = add(other, "play", seat);
  assert.deepEqual(replay.last?.frames, [first, second]);
  add(seat, "draw", seat); add(seat, "pass", other);
  assert.deepEqual(replay.last?.frames, [first, second]);
  const third = add(other, "play", seat);
  assert.deepEqual(replay.last?.frames, [third]);
  assert(replay.last?.frames.every(frame => frame.event?.seat !== seat));
  replay.reset(); assert.equal(replay.last, undefined);
});

test("two human seats finish rounds with host validation and private drawn cards", () => {
  const game = new GameServer(null, undefined, false, true);
  let plays = 0, rounds = 0;
  for (let step = 0; step < 1500 && rounds < 3; step++) {
    const host = game.view(0), guest = game.view(1);
    assert.equal(host.revision, guest.revision);
    assert.equal(game.cpuIsUp, false);
    assert.equal(new Set([...host.hand, ...guest.hand].map(card => card.id)).size, host.hand.length + guest.hand.length);
    const drawSeat = host.event?.kind === "draw" ? host.event.seat : host.event?.penalty?.seat;
    if (drawSeat !== undefined) assert.equal(game.view((1 - drawSeat) as Seat).event?.drawnCards, undefined);
    if (host.result) {
      rounds++;
      if (rounds === 3) break;
      const response = JSON.parse(game.handleJSON(1, JSON.stringify({ requestId: step, revision: guest.revision,
        command: { type: guest.matchResult ? "restart" : "next-round" } }))) as Response;
      assert.equal(response.type, "state");
      continue;
    }
    if (game.automaticMove) { assert.notEqual(game.automaticMove, "computer"); game.stepAutomatic(); continue; }
    const seat = host.turn!;
    const view = game.view(seat);
    const card = view.hand.find(card => view.legalLeads.includes(card.id));
    const command = card ? { type: "play", cards: [card.id], ...(card.special === "wild" ? { suit: SUITS.find(s => s !== view.activeSuit) } : {}) }
      : { type: view.drewThisTurn ? "pass" : "draw" };
    const response = JSON.parse(game.handleJSON(seat, JSON.stringify({ requestId: step, revision: view.revision, command }))) as Response;
    assert.equal(response.type, "state");
    if (card) plays++;
  }
  assert.equal(rounds, 3); assert(plays > 10);
});
