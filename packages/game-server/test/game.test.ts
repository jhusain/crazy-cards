import assert from "node:assert/strict";
import test from "node:test";
import { SUITS, otherSeat, type Command, type Response, type Seat, type Suit } from "@crazy-eights/protocol";
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

function assertFullDeck(server: GameServer): void {
  const state = server.saveMatch();
  const cards = [...state.hands.flat(), ...state.stock, ...state.discard, ...state.lastPlay];
  assert.equal(cards.length, 52);
  assert.deepEqual(cards.map(card => card.id).sort((a, b) => a - b), standardDeck().map(card => card.id));
}

test("fresh deals and restarts retain all 52 cards for AI and human matches", () => {
  // Exercise every result of the old 0–9 removal roll, rather than only zero.
  for (const cpuSeat of [null, 1] as const) for (let value = 0; value < 10; value++) {
    const server = new GameServer(cpuSeat, limit => value % limit);
    const checkDeal = () => {
      const state = server.saveMatch();
      assertFullDeck(server);
      assert.deepEqual(state.hands.map(hand => hand.length), [8, 8]);
      assert.equal(state.stock.length, 35);
      assert.equal(state.lastPlay.length, 1);
      assert.equal(state.discard.length, 0);
    };
    checkDeal();
    assert.equal(command(server, 0, { type: "restart" }).type, "state");
    checkDeal();
    if (server.view(0).turn === 1 && cpuSeat === 1) {
      assert(server.stepComputer());
      assertFullDeck(server);
    }
  }
});

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
    assertFullDeck(server);
    for (let move = 0; !server.view(0).result && move < 500; move++) {
      const before = server.view(0);
      if (before.turn === 1) assert(server.stepComputer());
      else {
        const decision = computerMove(before.hand, before.opponentCount, before.lastPlay.at(-1)!, before.drewThisTurn);
        const next = command(server, 0, decision.move);
        assert.equal(next.type, "state", next.type === "error" ? next.message : undefined);
      }
      const after = server.view(0);
      assertFullDeck(server);
      if (!after.result && after.hand.length === 0 && after.turn === 1) sawTie = true;
      assert.equal(new Set([...after.hand, ...after.lastPlay].map(item => item.id)).size, after.hand.length + after.lastPlay.length);
    }
    assert(server.view(0).result, `Round ${round} did not finish`);
    const finished = server.view(0);
    const next = command(server, 0, { type: finished.matchResult ? "restart" : "next-round" });
    assert.equal(next.type,"state");
    assert.equal(next.view.round, finished.matchResult ? 1 : finished.round + 1);
    assert.equal(next.view.points[0] + next.view.points[1], 0);
  }
  assert(sawTie, "At least one round gives the opponent a chance to tie");
});

test("exhibition games use the AI for both seats, reject manual moves, and stop at every result", () => {
  let seed = 8371;
  const random = (limit: number) => {
    seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
    return seed % limit;
  };
  const server = new GameServer(1,random,true);
  const seats = new Set<Seat>();
  const outcomes = new Set<Seat | "tie">();
  for(let round=1;round<=100;round++) {
    assert.equal(command(server,0,{type:"draw"}).type,"error");
    assert.equal(command(server,0,{type:"play",cards:[server.view(0).hand[0]!.id]}).type,"error");
    for(let step=0;!server.view(0).result && step<1000;step++) {
      const before=server.view(0);
      seats.add(before.turn!);
      const own=server.view(before.turn!);
      const expected=computerMove(own.hand,own.opponentCount,own.lastPlay.at(-1)!,own.drewThisTurn).move;
      assert.equal(server.automaticMove,"computer");
      assert(server.stepAutomatic());
      const after=server.view(0);
      assert.equal(after.event?.seat,before.turn);
      assert.equal(after.event?.kind,expected.type);
      if(expected.type==="play") assert.deepEqual(after.event?.cards?.map(card=>card.id),expected.cards);
      assert.deepEqual(after.queuedCards,[]);
    }
    const finished=server.view(0);
    assert(finished.result,`Exhibition round ${round} did not finish`);
    outcomes.add(finished.result.winner);
    assert.equal(server.automaticMove,null);
    assert.equal(server.stepAutomatic(),false);
    assert.deepEqual(server.view(0),finished);
    assert.equal(command(server,0,{type:finished.matchResult?"restart":"next-round"}).type,"state");
  }
  assert.deepEqual([...seats].sort(),[0,1]);
  assert.deepEqual([...outcomes].sort(),[0,1,"tie"]);
  const restarted=command(server,0,{type:"restart"});
  assert.equal(restarted.type,"state");
  assert.equal(restarted.view.round,1);
  assert.deepEqual(restarted.view.points,[0,0]);
  assert.equal(server.automaticMove,"computer");
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

test("skip hugging searches from the right and keeps adjacent same-suit skips together", () => {
  const ace = card(1, "clubs");
  const jack = card(11, "clubs");
  const right = card(4, "clubs");
  const left = card(6, "clubs");
  const pair = [card(5, "spades"), card(5, "clubs")];
  assert.deepEqual(sortPlayerHand([ace, jack, right, left, ...pair]), [...pair, left, jack, ace, right]);
});

test("skip hugging can continue through an adjacent matching suit", () => {
  const jack = card(11, "spades");
  const nonmatch = card(9, "hearts");
  const single = card(12, "spades");
  const pair = [card(2, "spades"), card(2, "diamonds")];
  const hand = [jack, nonmatch, single, ...pair];
  assert.deepEqual(sortPlayerHand(hand), [single, jack, ...pair, nonmatch]);
});

test("skip hugging ignores wild cards as suit matches", () => {
  const jack = card(11, "clubs");
  const eight = card(8, "clubs");
  const fourClubs = card(4, "clubs");
  const fourDiamonds = card(4, "diamonds");
  assert.deepEqual(sortPlayerHand([jack, eight]), [eight, jack]);
  assert.deepEqual(sortPlayerHand([jack, eight, fourDiamonds, fourClubs]), [eight, jack, fourClubs, fourDiamonds]);
});

test("skip hugging moves the matching card ahead of the whole rank group", () => {
  const jack = card(11, "clubs");
  const fourClubs = card(4, "clubs");
  const fourDiamonds = card(4, "diamonds");
  assert.deepEqual(sortPlayerHand([fourDiamonds, jack, fourClubs]), [jack, fourClubs, fourDiamonds]);

  const ace = card(1, "clubs");
  const fourSpades = card(4, "spades");
  assert.deepEqual(sortPlayerHand([fourSpades, ace, jack, fourDiamonds, fourClubs]),
    [jack, ace, fourClubs, fourSpades, fourDiamonds]);

  const jackHearts = card(11, "hearts");
  const fourHearts = card(4, "hearts");
  assert.deepEqual(sortPlayerHand([fourHearts, fourClubs, fourDiamonds, fourSpades, jackHearts]),
    [jackHearts, fourHearts, fourSpades, fourClubs, fourDiamonds]);
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
  // Recycle directly rather than exceeding the hand limit to exhaust the stock.
  server.setDebug(true);
  assert.equal(command(server, 0, { type: "debug-reshuffle" }).type, "state");
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


test("single skips first join the matching tail of the other skip group", () => {
  for (const [singleRank,groupRank] of [[11,1],[1,11]]) {
    const single=card(singleRank!,"clubs");
    const matching=card(groupRank!,"clubs");
    const other=card(groupRank!,"diamonds");
    const ordinary=card(4,"clubs");
    const ordered=sortPlayerHand([single,matching,other,ordinary]);
    assert.deepEqual(ordered.slice(0,3),[other,matching,single]);
    assert.equal(ordered[3],ordinary);
  }
});

test("ordinary quadruples precede a lone wild, while multiple wilds stay first", () => {
  const quad=SUITS.map(suit=>card(6,suit));
  const wild=card(8,"clubs");
  const ordered=sortPlayerHand([wild,...quad,card(4,"hearts")]);
  assert(ordered.slice(0,4).every(member=>member.rank===6));
  assert.equal(ordered[4],wild);
  const multiple=sortPlayerHand([wild,card(8,"diamonds"),...quad]);
  assert(multiple.slice(0,2).every(member=>member.rank===8));
  for (const rank of [1,2,11,12]) {
    const specialQuad=SUITS.map(suit=>card(rank,suit));
    assert.equal(sortPlayerHand([wild,...specialQuad])[0],wild);
  }
});


// Arrange small endgame positions, then exercise rules through the JSON interface.
function endgame(server:GameServer,winner:Seat|"tie",remaining=1):Response {
  const others=standardDeck().filter(c=>c.rank===4||c.rank===5).slice(0,remaining);
  const hands=winner==="tie"?[[],[]]:winner===0?[[],others]:[others,[]];
  const turn:Seat=winner==="tie"?0:winner===0?1:0;
  Object.assign(server,{hands,turn,stock:[],discard:[],lastPlay:[card(3,"clubs")],lastPlaySize:1,
    drewThisTurn:true,result:null,queued:null,passesWithoutProgress:0});
  return command(server,turn,{type:"pass"});
}

test("real discard recycling doubles PPC, empty stock attempts do not",()=>{
  const server=new GameServer(null);
  Object.assign(server,{hands:[[card(6,"clubs")],[card(7,"hearts")]],turn:0,stock:[],
    discard:[card(4,"clubs"),card(5,"clubs")],lastPlay:[card(3,"clubs")],lastPlaySize:1,drewThisTurn:false});
  assert.equal(command(server,0,{type:"draw"}).view.pointsPerCard,2);
  command(server,0,{type:"pass"});
  assert.equal(command(server,1,{type:"draw"}).view.pointsPerCard,2);
  command(server,1,{type:"pass"});
  assert.equal(command(server,0,{type:"draw"}).view.pointsPerCard,2);
  command(server,0,{type:"pass"});
  Object.assign(server,{discard:[card(9,"clubs")]});
  assert.equal(command(server,1,{type:"draw"}).view.pointsPerCard,4);
});

test("ties double the next starting PPC independently of in-round recycling",()=>{
  const server=new GameServer(null);
  assert.equal(server.view(0).pointsPerCard,1);
  Object.assign(server,{pointsPerCard:4});
  assert.equal(endgame(server,"tie").view.result?.winner,"tie");
  assert.deepEqual(server.view(0).roundsWon,[0,0]);
  assert.equal(command(server,0,{type:"next-round"}).view.pointsPerCard,2);
  endgame(server,"tie");
  assert.equal(command(server,0,{type:"next-round"}).view.pointsPerCard,4);
  const won=endgame(server,0,2).view;
  assert.deepEqual(won.result,{winner:0,points:8});
  assert.deepEqual(won.points,[8,-8]);
  assert.equal(command(server,0,{type:"next-round"}).view.pointsPerCard,1);
});

test("ties and deck wraps cap points per card at sixteen", () => {
  const server = new GameServer(null);
  for (const expected of [2, 4, 8, 16, 16]) {
    endgame(server, "tie");
    assert.equal(command(server, 0, { type: "next-round" }).view.pointsPerCard, expected);
  }
  Object.assign(server, {
    hands: [[card(6, "clubs")], [card(7, "hearts")]], turn: 0, stock: [],
    discard: [card(4, "clubs"), card(5, "clubs")], lastPlay: [card(3, "clubs")],
    lastPlaySize: 1, drewThisTurn: false,
  });
  const draw = command(server, 0, { type: "draw" }).view;
  assert.equal(draw.pointsPerCard, 16);
  assert.equal(draw.event?.drawCount, 1);
  assert.deepEqual(draw.event?.reshuffles, [{ drawIndex: 0, stockCount: 2, pointsBefore: 16, pointsAfter: 16 }]);
  assert.deepEqual(endgame(server, 0, 2).view.result, { winner: 0, points: 32 });
  assert.equal(command(server, 0, { type: "next-round" }).view.pointsPerCard, 1);
});

test("restoring an older room caps its active scoring and shuffle display", () => {
  const saved = new GameServer(null).saveMatch();
  saved.pointsPerCard = 64;
  saved.roundStartingPpc = 32;
  saved.event = { kind: "draw", seat: 0, reshuffles: [{ drawIndex: 0, stockCount: 2, pointsBefore: 32, pointsAfter: 64 }] };
  const restored = GameServer.restoreMatch(saved).saveMatch();
  assert.equal(restored.pointsPerCard, 16);
  assert.equal(restored.roundStartingPpc, 16);
  assert.deepEqual(restored.event?.reshuffles, [{ drawIndex: 0, stockCount: 2, pointsBefore: 16, pointsAfter: 16 }]);
});

test("three decisive rounds end a match by total points, recording both players' wins",()=>{
  const server=new GameServer(null);
  endgame(server,"tie");command(server,0,{type:"next-round"});
  assert.deepEqual(endgame(server,0).view.roundsWon,[1,0]); // two points after a tie
  command(server,0,{type:"next-round"});
  assert.equal(endgame(server,0).view.matchResult,null);
  command(server,0,{type:"next-round"});
  const final=endgame(server,1,5).view;
  assert.deepEqual(final.roundsWon,[2,1]);
  assert.deepEqual(final.points,[-2,2]);
  assert.deepEqual(final.matchResult,{winner:1,points:2,roundsWon:[2,1]});
  assert.equal(server.automaticMove,null);
  assert.equal(command(server,0,{type:"next-round"}).type,"error");
  const reset=command(server,0,{type:"restart"}).view;
  assert.equal(reset.round,1);assert.equal(reset.pointsPerCard,1);assert.equal(reset.matchResult,null);
  assert.deepEqual(reset.roundsWon,[0,0]);assert.deepEqual(reset.points,[0,0]);
});

test("a points tie after three decisive rounds extends the match until a winner emerges",()=>{
  const server=new GameServer(null);
  endgame(server,0);command(server,0,{type:"next-round"});
  endgame(server,0);command(server,0,{type:"next-round"});
  assert.equal(endgame(server,1,2).view.matchResult,null);
  assert.deepEqual(server.view(0).points,[0,0]);
  assert.equal(command(server,0,{type:"next-round"}).type,"state");
  assert.equal(endgame(server,"tie").view.matchResult,null);
  assert.equal(command(server,0,{type:"next-round"}).type,"state");
  assert.deepEqual(endgame(server,0).view.matchResult,{winner:0,points:2,roundsWon:[3,1]});
});

test("debug assistance uses the existing AI and autoplay can be toggled at runtime",()=>{
  const server=rigged([card(6,"clubs").id,card(6,"hearts").id],[],card(3,"clubs").id);
  const before=server.view(0);
  const expected=computerMove(before.hand,before.opponentCount,before.lastPlay.at(-1)!,before.drewThisTurn).move;
  const assisted=command(server,0,{type:"auto-play"});
  assert.equal(assisted.type,"state");
  assert.equal(assisted.view.event?.kind,expected.type);
  if(expected.type==="play") assert.deepEqual(assisted.view.event?.cards?.map(c=>c.id),expected.cards);
  server.setAutoplay(true);
  assert.equal(command(server,0,{type:"draw"}).type,"error");
  server.setAutoplay(false);
  const reset=command(server,0,{type:"restart"});
  assert.equal(reset.type,"state");
  assert.equal(command(server,0,{type:"auto-play"}).type,reset.view.turn===0?"state":"error");
});

test("reshuffle JSON records the exact draw boundary and PPC change for both observers",()=>{
  const server=new GameServer(null);
  Object.assign(server,{hands:[[card(12,"spades"),card(7,"clubs")],[card(5,"hearts")]],turn:0,
    stock:[card(9,"clubs")],discard:[card(4,"clubs"),card(6,"clubs"),card(10,"clubs")],
    lastPlay:[card(12,"hearts")],lastPlaySize:1,drewThisTurn:false});
  const after=command(server,0,{type:"play",cards:[card(12,"spades").id]}).view;
  const expected=[{drawIndex:1,stockCount:4,pointsBefore:1,pointsAfter:2}];
  assert.deepEqual(after.event?.reshuffles,expected);
  assert.equal(after.event?.drawnCards,undefined);
  assert.deepEqual(server.view(1).event?.reshuffles,expected);
  assert.equal(server.view(1).event?.drawnCards?.length,5);
  assert.equal(server.view(1).event?.drawnCards?.[0],card(9,"clubs").id);
  assert.equal(after.pointsPerCard,2);
  assert.equal(after.stockCount,0);
});

test("debug reshuffles replace a nonempty stock exactly as an empty stock, preserving the last play and turn",()=>{
  const create=(stock:ReturnType<typeof standardDeck>)=>{
    const server=new GameServer(null,()=>0);
    Object.assign(server,{hands:[[card(6,"clubs")],[card(7,"hearts")]],turn:0,drewThisTurn:true,
      stock,discard:[card(4,"clubs"),card(8,"hearts"),card(10,"diamonds")],
      lastPlay:[{...card(8,"clubs"),calledSuit:"spades"}],lastPlaySize:1});
    server.setDebug(true);
    return server;
  };
  const full=create([card(3,"hearts"),card(9,"clubs")]),empty=create([]);
  const before=full.view(0);
  const actual=command(full,0,{type:"debug-reshuffle"}),expected=command(empty,0,{type:"debug-reshuffle"});
  assert.equal(actual.type,"state");assert.deepEqual(actual.view,expected.view);
  const after=actual.view;
  assert.equal(after.revision,before.revision+1);
  assert.equal(after.stockCount,3);assert.equal(after.pointsPerCard,2);
  assert.deepEqual(after.lastPlay,before.lastPlay);assert.deepEqual(after.visibleDiscard,before.visibleDiscard);
  assert.deepEqual(after.hand,before.hand);assert.equal(after.opponentCount,before.opponentCount);
  assert.equal(after.turn,before.turn);assert.equal(after.drewThisTurn,true);
  assert.deepEqual(after.event,{seat:0,kind:"shuffle",reshuffles:[{drawIndex:0,stockCount:3,pointsBefore:1,pointsAfter:2}]});
  assert.deepEqual(full.view(1).event,after.event);
  const drawn:number[]=[];
  for(let i=0;i<3;i++){
    Object.assign(full,{drewThisTurn:false});Object.assign(empty,{drewThisTurn:false});
    const a=command(full,0,{type:"draw"}),b=command(empty,0,{type:"draw"});
    assert.deepEqual(a.view,b.view);drawn.push(...a.view.event!.drawnCards!);
  }
  assert.deepEqual(drawn.sort((a,b)=>a-b),[card(4,"clubs").id,card(8,"hearts").id,card(10,"diamonds").id].sort((a,b)=>a-b));
  assert.equal(full.view(0).hand.find(c=>c.id===card(8,"hearts").id)?.suit,"hearts");
});

test("debug reshuffling is gated and does not invent a refill when no earlier discards exist",()=>{
  const server=new GameServer(null);
  Object.assign(server,{discard:[card(4,"clubs")],turn:1});
  const before=server.view(0);
  assert.equal(command(server,0,{type:"debug-reshuffle"}).type,"error");
  assert.deepEqual(server.view(0),before);
  server.setDebug(true);server.setAutoplay(true);
  assert.equal(command(server,0,{type:"debug-reshuffle"}).type,"state");
  assert.equal(server.view(0).turn,1);assert.equal(server.view(0).stockCount,1);
  const after=server.view(0);
  assert.equal(command(server,0,{type:"debug-reshuffle"}).type,"error");
  assert.deepEqual(server.view(0),after);
  Object.assign(server,{discard:[card(5,"clubs")]});server.setDebug(false);
  assert.equal(command(server,0,{type:"debug-reshuffle"}).type,"error");
});


test("a new match is opened by the last round winner, even when the other player won the match",()=>{
  for(const lastWinner of [0,1] as const) {
    const server=new GameServer(null,()=>0);
    const matchWinner=otherSeat(lastWinner);
    endgame(server,matchWinner,5);command(server,0,{type:"next-round"});
    endgame(server,matchWinner,5);command(server,0,{type:"next-round"});
    const final=endgame(server,lastWinner).view;
    assert.equal(final.matchResult?.winner,matchWinner);
    const reset=command(server,0,{type:"restart"}).view;
    assert.equal(reset.turn,lastWinner);
    assert.equal(reset.round,1);
    assert.deepEqual(reset.points,[0,0]);
    assert.deepEqual(reset.roundsWon,[0,0]);
  }
});

test("consecutive wild plays announce a burn to both players, including multiple eights", () => {
  const heart = card(8, "hearts").id;
  const club = card(8, "clubs").id;
  const diamond = card(8, "diamonds").id;
  const spade = card(8, "spades").id;
  const ordinary = card(7, "clubs").id;
  const server = rigged([heart, spade], [club, diamond, ordinary], card(3, "hearts").id);
  const first = command(server, 0, { type: "play", cards: [heart], suit: "diamonds" });
  assert.equal(first.type, "state");
  assert.equal(first.view.event?.burnsPreviousPlay, undefined);
  const second = command(server, 1, { type: "play", cards: [club, diamond], suit: "hearts" });
  assert.equal(second.type, "state");
  assert.equal(second.view.event?.burnsPreviousPlay, true);
  assert.equal(server.view(0).event?.burnsPreviousPlay, true);
  const third = command(server, 0, { type: "play", cards: [spade], suit: "clubs" });
  assert.equal(third.type, "state");
  assert.equal(third.view.event?.burnsPreviousPlay, true);
  const fourth = command(server, 1, { type: "play", cards: [ordinary] });
  assert.equal(fourth.type, "state");
  assert.equal(fourth.view.event?.burnsPreviousPlay, undefined);
});


test("wild-on-wild does not burn the same player's previous wild after a draw and pass", () => {
  for (const seat of [0, 1] as const) {
    const server = new GameServer(null);
    const opponent = otherSeat(seat);
    const hands = [[card(8, "hearts"), card(8, "spades"), card(6, "clubs")], [card(7, "diamonds")]];
    Object.assign(server, { hands: seat === 0 ? hands : hands.slice().reverse(), turn: seat,
      lastPlay: [card(3, "hearts")], lastPlaySize: 1, stock: [card(4, "clubs")] });
    assert.equal(command(server, seat, { type: "play", cards: [card(8, "hearts").id], suit: "diamonds" }).type, "state");
    assert.equal(command(server, opponent, { type: "draw" }).type, "state");
    assert.equal(command(server, opponent, { type: "pass" }).type, "state");
    const next = command(server, seat, { type: "play", cards: [card(8, "spades").id], suit: "hearts" });
    assert.equal(next.type, "state");
    assert.equal(next.view.event?.burnsPreviousPlay, undefined);
  }
});

test("wild-on-wild does not burn when the previous wild emptied the other hand", () => {
  for (const seat of [0, 1] as const) for (const tie of [false, true]) {
    const server = new GameServer(null);
    const hands = [[card(8, "hearts")], [card(8, "spades"), ...(tie ? [] : [card(6, "clubs")])]];
    Object.assign(server, { hands: seat === 0 ? hands : hands.slice().reverse(), turn: seat,
      lastPlay: [card(3, "hearts")], lastPlaySize: 1 });
    assert.equal(command(server, seat, { type: "play", cards: [card(8, "hearts").id], suit: "diamonds" }).type, "state");
    const next = command(server, otherSeat(seat), { type: "play", cards: [card(8, "spades").id], suit: "hearts" });
    assert.equal(next.type, "state");
    assert.equal(next.view.event?.burnsPreviousPlay, undefined);
    assert.equal(next.view.result?.winner, tie ? "tie" : seat);
  }
});
