import assert from "node:assert/strict";
import test from "node:test";
import { SUITS, type Command, type Response, type Seat, type Suit } from "@crazy-eights/protocol";
import { GameServer } from "../src/index.ts";
import { computerMove, sortHand, sortPlayerHand } from "../src/computer.ts";
import { standardDeck } from "../src/rules.ts";

const card = (rank: number, suit: Suit) => standardDeck()[13 * SUITS.indexOf(suit) + rank - 1]!;

function rigged(
  human: number[], opponent: number[], top: number,
  options: { cpuSeat?: Seat; draws?: number[] } = {},
): GameServer {
  const draws = options.draws ?? [];
  const available = standardDeck().map(item => item.id).filter(id => ![...human, ...opponent, top, ...draws].includes(id));
  human = [...human, ...available.splice(0, 8 - human.length)];
  opponent = [...opponent, ...available.splice(0, 8 - opponent.length)];
  const desired = [...available, ...draws.slice().reverse(), ...opponent.reverse(), ...human.reverse(), top];
  const starting = standardDeck().map(item => item.id);
  return new GameServer(options.cpuSeat ?? null, limit => {
    if (starting.length === 1) return 0;
    const selected = starting.indexOf(desired[limit - 1]!);
    [starting[selected], starting[limit - 1]] = [starting[limit - 1]!, starting[selected]!];
    starting.pop();
    return selected;
  });
}

function command(server: GameServer, seat: Seat, command: Command): Response {
  const current = server.view(seat);
  return JSON.parse(server.handleJSON(seat, JSON.stringify({ revision: current.revision, requestId: 1, command }))) as Response;
}

test("projects only the authenticated seat’s hand and rejects stale or malformed moves", () => {
  const server = rigged([card(7, "hearts").id], [card(7, "spades").id], card(3, "hearts").id);
  const view = command(server, 0, { type: "snapshot" }).view;
  assert.equal(view.hand.length, 8);
  assert.equal(view.opponentCount, 8);
  assert(!view.hand.some(item => item.id === card(7, "spades").id));
  assert.equal(JSON.parse(server.handleJSON(0, "{bad")).type, "error");
  const stale = server.handleJSON(0, JSON.stringify({ revision: view.revision - 1, requestId: 12, command: { type: "draw" } }));
  assert.equal(JSON.parse(stale).type, "error");
  assert.equal(server.view(0).revision, view.revision);
});

test("allows a draw before passing and rejects an extra draw in the same turn", () => {
  const server = rigged([], [], card(4, "spades").id);
  assert.equal(command(server, 0, { type: "pass" }).type, "error");
  const draw = command(server, 0, { type: "draw" });
  assert(draw.view.drewThisTurn);
  assert.equal(draw.view.hand.length, 9);
  assert.equal(command(server, 0, { type: "draw" }).type, "error");
  const pass = command(server, 0, { type: "pass" });
  assert.equal(pass.view.turn, 1);
  assert(!pass.view.drewThisTurn);
});

test("draw events disclose card identities in stock order only to the recipient", () => {
  const two = card(2, "hearts").id;
  const draws = [card(9, "clubs").id, card(4, "diamonds").id];
  const server = rigged([two], [], card(3, "hearts").id, { draws });
  const play = command(server, 0, { type: "play", cards: [two] }).view;
  assert.deepEqual(play.event?.penalty, { seat: 1, count: 2 });
  assert.equal(play.event?.drawnCards, undefined);
  assert.deepEqual(server.view(1).event?.drawnCards, draws);
});

test("twos form a cumulative chain and the opening card has no immediate penalty", () => {
  const server = rigged([card(2, "diamonds").id], [card(2, "clubs").id], card(2, "hearts").id);
  assert.equal(server.view(0).opponentCount, 8);
  const first = command(server, 0, { type: "play", cards: [card(2, "diamonds").id] });
  assert.equal(first.view.event?.penalty?.count, 4);
  assert.equal(first.view.opponentCount, 12);
  const reply = command(server, 1, { type: "play", cards: [card(2, "clubs").id] });
  assert.equal(reply.view.event?.penalty?.count, 6);
  assert.equal(reply.view.lastPlay.length, 3);
  assert.deepEqual(reply.view.visibleDiscard.map(card => card.id), [card(2, "clubs").id]);
  const draw = command(server, 0, { type: "draw" });
  assert.deepEqual(draw.view.visibleDiscard, reply.view.visibleDiscard);
});

test("ordinary queens can cover the queen of spades, and a queen on top draws five", () => {
  const spade = card(12, "spades").id;
  const heart = card(12, "hearts").id;
  const covered = rigged([spade, heart], [], card(12, "diamonds").id);
  assert.equal(command(covered, 0, { type: "play", cards: [spade, heart] }).view.event?.penalty, undefined);
  const exposed = rigged([spade, heart], [], card(12, "diamonds").id);
  assert.equal(command(exposed, 0, { type: "play", cards: [heart, spade] }).view.event?.penalty?.count, 5);
});

test("aces and jacks skip, and eights must declare a different suit", () => {
  const ace = card(1, "clubs").id;
  const jack = card(11, "diamonds").id;
  const eight = card(8, "diamonds").id;
  const server = rigged([ace, jack, eight], [], card(1, "diamonds").id);
  const reverse = command(server, 0, { type: "play", cards: [ace] });
  assert(reverse.view.event?.skips);
  assert.equal(reverse.view.turn, 0);
  assert.equal(command(server, 0, { type: "play", cards: [eight], suit: "clubs" }).type, "error");
  assert.equal(command(server, 0, { type: "play", cards: [eight], suit: "diamonds" }).view.activeSuit, "diamonds");
  command(server, 1, { type: "draw" });
  command(server, 1, { type: "pass" });
  assert(command(server, 0, { type: "play", cards: [jack] }).view.event?.skips);
});

test("the opponent gets a chance to tie after a regular last card", () => {
  const ranks = [3, 4, 5, 6, 7, 9, 10, 13];
  const human = ranks.map((rank, index) => card(rank, index % 2 === 0 ? "hearts" : "diamonds").id);
  const opponent = ranks.map((rank, index) => card(rank, index % 2 === 0 ? "diamonds" : "hearts").id);
  const server = rigged(human, opponent, card(12, "hearts").id);
  for (let i = 0; i < ranks.length; i++) {
    assert.equal(command(server, 0, { type: "play", cards: [human[i]!] }).type, "state");
    assert.equal(server.view(0).result, null);
    assert.equal(command(server, 1, { type: "play", cards: [opponent[i]!] }).type, "state");
  }
  assert.deepEqual(server.view(0).result, { winner: "tie", points: 0 });
});

test("100 seeded computer-vs-computer rounds reach a result through the JSON boundary", () => {
  let seed = 1837;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const server = new GameServer(1, random);
  let sawTie = false;
  for (let round = 1; round <= 100; round++) {
    for (let move = 0; !server.view(0).result && move < 500; move++) {
      const before = server.view(0);
      if (before.turn === 1) assert(server.stepComputer());
      else {
        const decision = computerMove(before.hand, before.opponentCount, before.lastPlay.at(-1)!, before.drewThisTurn);
        const next = command(server, 0, decision.move);
        assert.equal(next.type, "state", next.type === "error" ? next.message : undefined);
      }
      const after = server.view(0);
      if (!after.result && after.hand.length === 0 && after.turn === 1) sawTie = true;
      assert.equal(new Set([...after.hand, ...after.lastPlay].map(item => item.id)).size, after.hand.length + after.lastPlay.length);
    }
    assert(server.view(0).result, `Round ${round} did not finish`);
    const next = command(server, 0, { type: "next-round" });
    assert.equal(next.view.round, round + 1);
    assert.equal(next.view.points[0] + next.view.points[1], 0);
  }
  assert(sawTie, "At least one round gives the opponent a chance to tie");
});

test("computer moves match the original ComputerPlayer class on reference hands", () => {
  // Captured by running the original bytecode with fixed hands and Java's original sort routine.
  const cases = [
    { top: 4, opponent: 8, hand: [10, 0, 7, 17, 43], play: [0] },
    { top: 1, opponent: 8, hand: [14, 27, 7, 15, 28], play: [14] },
    { top: 49, opponent: 7, hand: [11, 24, 37, 4, 50], play: [50] },
    { top: 9, opponent: 3, hand: [0, 7, 36, 11], play: [0] },
    { top: 9, opponent: 8, hand: [7, 37, 29, 32], play: [] },
    { top: 3, opponent: 5, hand: [24, 11, 19, 28, 49], play: [11, 24] },
    { top: 5, opponent: 1, hand: [7, 6, 22, 26, 41], play: [6] },
    { top: 5, opponent: 9, hand: [38, 43, 44, 17, 30], play: [44] },
  ];
  const deck = standardDeck();
  for (const sample of cases) {
    const { move } = computerMove(sample.hand.map(id => deck[id]!), sample.opponent, deck[sample.top]!, false);
    assert.deepEqual(move.type === "play" ? move.cards : [], sample.play);
    if (!sample.play.length) assert.equal(move.type, "draw");
  }
});

test("a forced turn draws once and passes automatically if there is still no play", () => {
  const top = card(13, "spades").id;
  const hand = [card(3, "hearts").id, card(4, "hearts").id, card(5, "hearts").id, card(6, "hearts").id,
    card(7, "hearts").id, card(9, "hearts").id, card(10, "hearts").id, card(11, "hearts").id];
  const miss = rigged(hand, [], top, { cpuSeat: 1, draws: [card(5, "clubs").id] });
  assert.equal(miss.view(0).legalLeads.length, 0);
  assert.equal(miss.automaticMove, "draw");
  assert(miss.stepAutomatic());
  assert.equal(miss.view(0).hand.length, 9);
  assert.equal(miss.automaticMove, "pass");
  assert(miss.stepAutomatic());
  assert.equal(miss.view(0).turn, 1);
  assert.equal(miss.view(0).event?.kind, "pass");

  const hit = rigged(hand, [], top, { cpuSeat: 1, draws: [card(5, "spades").id] });
  assert(hit.stepAutomatic());
  assert.equal(hit.view(0).turn, 0);
  assert.equal(hit.automaticMove, null);
  assert.deepEqual(hit.view(0).legalLeads, [card(5, "spades").id]);
  assert.equal(rigged(hand, [], top).automaticMove, null);
});

test("queueing two jacks, an ace and a six executes three distinct turns", () => {
  const sequence = [card(11, "spades").id, card(11, "hearts").id, card(1, "hearts").id, card(6, "hearts").id];
  const server = rigged(sequence, [], card(3, "spades").id, { cpuSeat: 1 });
  const first = command(server, 0, { type: "play-queue", cards: sequence });
  assert.equal(first.type, "state");
  assert.deepEqual(first.view.lastPlay.map(item => item.id), sequence.slice(0, 2));
  assert.deepEqual(first.view.queuedCards, sequence.slice(2));
  const finalHandIds = first.view.hand.filter(item => !first.view.queuedCards.includes(item.id)).map(item => item.id);
  assert.deepEqual(server.view(1).queuedCards, []);
  assert.equal(first.view.turn, 0);
  assert.equal(command(server, 0, { type: "draw" }).type, "error");
  assert.equal(server.automaticMove, "queued");
  assert(server.stepAutomatic());
  assert.equal(server.view(0).lastPlay.at(-1)?.id, sequence[2]);
  assert.equal(server.view(0).turn, 0);
  assert(server.stepAutomatic());
  assert.equal(server.view(0).lastPlay.at(-1)?.id, sequence[3]);
  assert.deepEqual(server.view(0).queuedCards, []);
  assert.equal(server.view(0).turn, 1);
  assert.deepEqual(server.view(0).hand.map(item => item.id), finalHandIds);
});

test("single skips hug the same suit, preferring smaller matching groups", () => {
  const jack = card(11, "spades");
  const ace = card(1, "hearts");
  const single = card(4, "hearts");
  const pair = [card(9, "clubs"), card(9, "spades")];
  const triple = [card(7, "hearts"), card(7, "spades"), card(7, "diamonds")];
  const input = [jack, ace, single, ...pair, ...triple];
  const ordered = sortPlayerHand(input);
  const next = (items: typeof ordered, item: typeof jack) => items[items.indexOf(item) + 1];
  assert.equal(next(ordered, jack), pair[1]);
  assert.equal(next(ordered, pair[1]!), pair[0]);
  assert.equal(next(ordered, ace), single);
  const withQuadruple = [jack, ...SUITS.map(suit => card(3, suit))];
  assert.equal(next(sortPlayerHand(withQuadruple), jack)?.suit, "spades");
  const withTriple = [ace, ...triple];
  assert.equal(next(sortPlayerHand(withTriple), ace), triple[0]);
  assert.deepEqual(sortPlayerHand([jack, single]), sortHand([jack, single]));
});

test("illegal queue suffixes leave the table untouched, and an eight uses its projected suit", () => {
  const jack = card(11, "hearts").id;
  const ace = card(1, "hearts").id;
  const wrongSuit = card(6, "diamonds").id;
  const eight = card(8, "hearts").id;
  const normal = card(6, "hearts").id;
  const top = card(11, "spades").id;
  const server = rigged([jack, ace, wrongSuit, eight, normal], [], top);
  const start = server.view(0);
  for (const cards of [[jack, wrongSuit], [jack, normal, ace], [jack, jack], Array(13).fill(jack)]) {
    assert.equal(command(server, 0, { type: "play-queue", cards }).type, "error");
    assert.deepEqual(server.view(0), start);
  }
  assert.equal(command(server, 0, { type: "play-queue", cards: [jack, eight], suit: "hearts" }).type, "error");
  assert.equal(command(server, 0, { type: "play-queue", cards: [jack, eight], suit: "spades" }).type, "state");
  assert(server.stepAutomatic());
  assert.equal(server.view(0).activeSuit, "spades");
  assert.equal(server.view(0).turn, 1);
});

test("restart clears outstanding queued moves", () => {
  const jack = card(11, "spades").id;
  const normal = card(4, "spades").id;
  const server = rigged([jack, normal], [], card(3, "spades").id);
  assert.equal(command(server, 0, { type: "play-queue", cards: [jack, normal] }).type, "state");
  assert.equal(server.automaticMove, "queued");
  assert.equal(command(server, 0, { type: "restart" }).type, "state");
  assert.equal(server.automaticMove, null);
  assert.deepEqual(server.view(0).queuedCards, []);
});

test("the displayed hand order matches the reference Java automatic sort", () => {
  const deck = standardDeck();
  // Recorded by executing the recovered HumanPlayer.sort() with the original Hand class.
  const input = [7, 20, 0, 13, 39, 50, 11, 37, 5, 44, 3, 1, 15, 32, 28, 34, 36];
  assert.deepEqual(sortHand(input.map(id => deck[id]!)).map(item => item.id),
    [20, 7, 50, 37, 11, 1, 36, 39, 13, 0, 44, 5, 28, 15, 34, 32, 3]);
});

test("a full twelve-card queue runs as three four-card plays", () => {
  const jacks = [49, 10, 23, 36];
  const aces = [26, 0, 13, 39];
  const kings = [51, 12, 25, 38];
  const filler = [28, 29, 30, 31, 32, 33, 34, 35];
  const draws = [51, 2, 12, 3, 25, 4, 38, 5];
  const server = rigged([...jacks, ...aces], filler, 41, { draws });
  for (const seat of [0, 1, 0, 1, 0, 1, 0, 1] as const) {
    assert.equal(command(server, seat, { type: "draw" }).type, "state");
    assert.equal(command(server, seat, { type: "pass" }).type, "state");
  }
  assert.equal(command(server, 0, { type: "play-queue", cards: [...jacks, ...aces, ...kings] }).type, "state");
  assert.deepEqual(server.view(0).lastPlay.map(item => item.id), jacks);
  assert(server.stepAutomatic());
  assert.deepEqual(server.view(0).lastPlay.map(item => item.id), aces);
  assert(server.stepAutomatic());
  assert.deepEqual(server.view(0).lastPlay.map(item => item.id), kings);
  assert.equal(server.view(0).hand.length, 0);
  assert.equal(server.view(0).turn, 1);
});

test("multiple eights can keep the current suit, calling it only on the last card", () => {
  const eightH = card(8, "hearts").id;
  const eightD = card(8, "diamonds").id;
  const top = card(3, "spades").id;
  for (const type of ["play", "play-queue"] as const) {
    const server = rigged([eightH, eightD], [], top);
    assert.equal(command(server, 0, { type, cards: [eightH], suit: "spades" }).type, "error");
    assert.equal(command(server, 0, { type, cards: [eightH, eightD] }).type, "error");
    const play = command(server, 0, { type, cards: [eightH, eightD], suit: "spades" });
    assert.equal(play.type, "state");
    assert.equal(play.view.activeSuit, "spades");
    assert.deepEqual(play.view.visibleDiscard.map(({ id, suit, calledSuit }) => [id, suit, calledSuit]),
      [[eightH, "hearts", undefined], [eightD, "diamonds", "spades"]]);
  }
});

test("queued eights can keep the preceding jack's suit, and recyclables retain their printed suits", () => {
  const jack = card(11, "spades").id;
  const eightH = card(8, "hearts").id;
  const eightD = card(8, "diamonds").id;
  const opponentCard = card(7, "spades").id;
  const server = rigged([jack, eightH, eightD], [opponentCard], card(3, "spades").id);
  assert.equal(command(server, 0, { type: "play-queue", cards: [jack, eightH, eightD], suit: "spades" }).type, "state");
  assert(server.stepAutomatic());
  assert.equal(server.view(0).activeSuit, "spades");
  assert.equal(command(server, 1, { type: "play", cards: [opponentCard] }).type, "state");
  const seen = new Map<number, Suit>();
  for (let i = 0; i < 48; i++) {
    const seat = server.view(0).turn!;
    const draw = command(server, seat, { type: "draw" });
    for (const item of draw.view.hand) {
      if (item.id === eightH || item.id === eightD) {
        assert.equal("calledSuit" in item, false);
        seen.set(item.id, item.suit);
      }
    }
    if (seen.size === 2) break;
    assert.equal(command(server, seat, { type: "pass" }).type, "state");
  }
  assert.deepEqual(Object.fromEntries(seen), { [eightH]: "hearts", [eightD]: "diamonds" });
});
