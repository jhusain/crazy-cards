import assert from "node:assert/strict";
import test from "node:test";
import { MAX_HAND_CARDS, type Command, type Response, type Seat } from "@crazy-eights/protocol";
import { GameServer } from "../src/index.ts";
import { standardDeck } from "../src/rules.ts";

const deck = standardDeck();
const card = (rank: number, suit = "hearts") => deck.find(c => c.rank === rank && c.suit === suit)!;
function position(seat: Seat = 0, full = true) {
  const server = new GameServer(null, () => 0);
  const top = card(3);
  const blocked = deck.filter(c => c.suit !== "hearts" && ![3, 4, 5, 8].includes(c.rank)).slice(0, full ? MAX_HAND_CARDS : 25);
  const available = deck.filter(c => c.id !== top.id && !blocked.includes(c));
  const hand = full ? [card(4), card(5), card(8)] : available;
  const stock = full ? available.filter(c => !hand.includes(c)) : [];
  Object.assign(server, { hands: seat === 0 ? [hand, blocked] : [blocked, hand], turn: seat,
    stock, discard: [], lastPlay: [top], lastPlaySize: 1, drewThisTurn: false });
  return server;
}
function request(server: GameServer, seat: Seat, command: Command): Response {
  return JSON.parse(server.handleJSON(seat, JSON.stringify({ requestId: 1, revision: server.view(seat).revision, command })));
}

test("either seat must play when its opponent is blocked at the hand limit; rejected actions do not mutate state", () => {
  for (const seat of [0, 1] as const) {
    const server = position(seat);
    assert.equal(server.view(seat).mustPlayReason, "opponent-hand-full");
    assert.equal(server.view(seat === 0 ? 1 : 0).mustPlayReason, null);
    for (const command of [{ type: "draw" }, { type: "pass" }] as const) {
      const before = server.saveMatch();
      const response = request(server, seat, command);
      assert.equal(response.type, "error");
      if (response.type === "error") assert.match(response.message, /must play.*opponent/i);
      assert.deepEqual(server.saveMatch(), before);
    }
    const played = request(server, seat, { type: "play", cards: [card(4).id] });
    assert.equal(played.type, "state");
    // Playing once doesn't exempt a player if their opponent is still blocked next turn.
    const opponent = seat === 0 ? 1 : 0;
    assert.equal(server.view(opponent).legalLeads.length, 0);
    request(server, opponent, { type: "draw" });
    request(server, opponent, { type: "draw" });
    assert.equal(server.view(seat).mustPlayReason, "opponent-hand-full");
  }
});

test("exhausted stock blocks passing, but recyclable discards or remaining stock permit strategic drawing", () => {
  const server = position(0, false);
  assert.equal(server.view(0).mustPlayReason, "deck-exhausted");
  assert.equal(request(server, 0, { type: "draw" }).type, "error");
  Object.assign(server, { discard: [card(6)] });
  assert.equal(server.view(0).mustPlayReason, null);
  Object.assign(server, { discard: [], stock: [card(6)] });
  assert.equal(server.view(0).mustPlayReason, null);
});

test("a matching rank or wild in the opponent's hand removes the restriction", () => {
  for (const eligible of [card(3, "clubs"), card(8, "clubs")]) {
    const server = position();
    const saved = server.saveMatch();
    saved.hands[1][0] = eligible;
    Object.assign(server, { hands: saved.hands });
    assert.equal(server.view(0).mustPlayReason, null);
    assert.equal(request(server, 0, { type: "draw" }).type, "state");
  }
});

test("a full active hand cannot bypass the rule with the draw-again pass shortcut", () => {
  const server = position(0, false);
  Object.assign(server, { drewThisTurn: true, event: { seat: 0, kind: "draw", handLimitReached: true } });
  assert.equal(server.view(0).hand.length, MAX_HAND_CARDS);
  assert.equal(request(server, 0, { type: "draw" }).type, "error");
  assert.equal(request(server, 0, { type: "pass" }).type, "error");
});

test("the AI plays a held-back same-suit wild when required, including debug assistance", () => {
  for (const assistance of [false, true]) {
    const server = position();
    Object.assign(server, { hands: [[card(8)], server.saveMatch().hands[1]], ...(assistance ? {} : { cpuSeat: 0 }) });
    assert.equal(server.view(0).mustPlayReason, "opponent-hand-full");
    if (assistance) assert.equal(request(server, 0, { type: "auto-play" }).type, "state");
    else assert.equal(server.stepComputer(), true);
    assert.equal(server.view(0).event?.kind, "play");
    assert.equal(server.view(0).mustPlayReason, null);
  }
});

test("when neither player can play or draw, the existing tie rule still ends the round", () => {
  const server = position();
  Object.assign(server, { hands: [[card(6, "clubs")], [card(7, "clubs")]], stock: [], discard: [] });
  assert.equal(server.view(0).mustPlayReason, null);
  for (const seat of [0, 1] as const) {
    assert.equal(request(server, seat, { type: "draw" }).type, "state");
    assert.equal(request(server, seat, { type: "pass" }).type, "state");
  }
  assert.equal(server.view(0).result?.winner, "tie");
});


test("an empty opponent hand retains the final response window and permits conceding by passing", () => {
  const server = position();
  Object.assign(server, { hands: [[card(4)], []], stock: [], discard: [], drewThisTurn: true });
  assert.equal(server.view(0).mustPlayReason, null);
  assert.equal(request(server, 0, { type: "pass" }).type, "state");
  assert.equal(server.view(0).result?.winner, 1);
});
