import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "@crazy-eights/game-server";
import { canFollowInQueue, wildSuitOptions, type Card, type TableView, type TurnEvent } from "@crazy-eights/protocol";
import { retainedFlickPlay, eligibleDrawDrop, cardDropRegion, coveredArea, flickPlayableCards, flickPlay, isCardDrag, isUpwardFlick, isVerticalFlick, queuedCardFlick } from "../src/card-gesture.ts";
import { OpponentReplay } from "../src/opponent-replay.ts";
import { isDebug } from "../src/play-mode.ts";
import { ANIMATION_SPEEDS, DEFAULT_SETTINGS, readSettings } from "../src/settings.ts";
import { drawTimeline, HAND_READY, PLAY_TIME, PLAY_SLIDE, STAGE_FLIGHT, playReflow, handReadinessTimeline, replayDelay, replaySpeed, tableAnimationTime } from "../src/table-timing.ts";

test("debug mode requires the debug query value to be exactly true", () => {
  assert(isDebug("?debug=true"));
  assert(isDebug("?other=1&debug=true"));
  assert.equal(isDebug("?autoplay=true"),false);
  for (const query of ["", "?debug", "?debug=false", "?debug=True", "?debug=1", "?other=debug=true"]) {
    assert.equal(isDebug(query),false);
  }
});

test("only a quick upward pointer gesture qualifies", () => {
  assert(isUpwardFlick(9, -50, 150));
  assert(!isUpwardFlick(2, 50, 150));
  assert(!isUpwardFlick(35, -40, 150));
  assert(!isUpwardFlick(5, -50, 800));

});

test("top-selection mode plays the sole eligible group member alone", () => {
  const clubs: Card = { id: 31, suit: "clubs", rank: 6, special: "normal" };
  const diamonds: Card = { id: 18, suit: "diamonds", rank: 6, special: "normal" };
  const hearts: Card = { id: 5, suit: "hearts", rank: 6, special: "normal" };
  for (const hand of [[clubs], [diamonds, clubs], [diamonds, clubs, hearts]]) {
    assert.deepEqual(flickPlay(clubs, hand, [clubs.id], DEFAULT_SETTINGS), [clubs]);
  }
  assert.equal(flickPlay(clubs, [diamonds, clubs], [], DEFAULT_SETTINGS), undefined);
});

test("the suit picker matches the game rule for single and multiple eights", () => {
  assert.deepEqual(wildSuitOptions("hearts", 1), ["diamonds", "clubs", "spades"]);
  assert.deepEqual(wildSuitOptions("hearts", 2), ["hearts", "diamonds", "clubs", "spades"]);
});

test("queued cards play on left or upward swipes and clear on downward swipes", () => {
  assert(isVerticalFlick(9, -50, 150));
  assert(isVerticalFlick(9, 50, 150));
  assert(!isVerticalFlick(48, 26, 150));
  assert(!isVerticalFlick(4, 60, 620));
  assert.equal(queuedCardFlick(-50, 7, 150), "play");
  assert.equal(queuedCardFlick(7, -50, 150), "play");
  assert.equal(queuedCardFlick(7, 50, 150), "clear");
  for (const [dx, dy, time] of [[50,7,150],[-50,40,150],[-20,0,150],[-50,0,700]]) {
    assert.equal(queuedCardFlick(dx!, dy!, time!), undefined);
  }
});

test("flicks always select the top card, using a matching group lead when needed", () => {
  const clubs: Card = { id: 31, suit: "clubs", rank: 6, special: "normal" };
  const hearts: Card = { id: 5, suit: "hearts", rank: 6, special: "normal" };
  const jack: Card = { id: 49, suit: "spades", rank: 11, special: "skip" };
  const hand = [hearts, clubs, jack];
  const legal = [clubs.id, jack.id];
  assert.deepEqual(flickPlay(clubs, hand, legal, DEFAULT_SETTINGS), [clubs]);
  assert.deepEqual(flickPlay(jack, hand, legal, DEFAULT_SETTINGS), [jack]);
  assert.deepEqual(flickPlay(hearts, hand, legal, DEFAULT_SETTINGS), [clubs, hearts]);
});

test("wild flicks play one immediately while two exclusions still stage pairs", () => {
  const wild: Card = { id: 7, suit: "hearts", rank: 8, special: "wild" };
  const wildPair: Card = { id: 20, suit: "diamonds", rank: 8, special: "wild" };
  const two: Card = { id: 1, suit: "hearts", rank: 2, special: "pickup" };
  const twoPair: Card = { id: 14, suit: "diamonds", rank: 2, special: "pickup" };
  const hand = [wild, wildPair, two, twoPair];
  for (const [card, setting] of [[wild, "groupExceptWild"], [two, "groupExceptTwo"]] as const) {
    const legal = [card.id, ...hand.filter(other => other.rank === card.rank).map(other => other.id)];
    assert.deepEqual(flickPlay(card, hand, legal, DEFAULT_SETTINGS), setting === "groupExceptWild" ? [card] : undefined);
    assert.equal(flickPlay(card, hand, legal, { ...DEFAULT_SETTINGS, [setting]: false })?.length, 2);
    const singletonHand = hand.filter(other => other.id === card.id || other.rank !== card.rank);
    assert.deepEqual(flickPlay(card, singletonHand, legal, DEFAULT_SETTINGS), [card]);
    assert.deepEqual(flickPlay(card, singletonHand, legal, { ...DEFAULT_SETTINGS, [setting]: false }), [card]);
  }
});

test("settings preserve exact speed endpoints, the default and quarter-second pauses", () => {
  assert.equal(ANIMATION_SPEEDS[0], .05);
  assert.equal(ANIMATION_SPEEDS.at(-1), 1.5);
  assert(ANIMATION_SPEEDS.includes(1));
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings({ animationSpeed: .05, aiPauseMs: 2750 }),
    { ...DEFAULT_SETTINGS, animationSpeed: .05, aiPauseMs: 2750 });
  assert.deepEqual(readSettings({ animationSpeed: 0, aiPauseMs: 2300 }), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings({ pickupAnimation: "concurrent", dangerWarning: false, dangerThreshold: 0 }),
    { ...DEFAULT_SETTINGS, dangerWarning: false, dangerThreshold: 0 });
});

test("target card width defaults to 240 and preserves ten-dp settings", () => {
  assert.equal(readSettings({}).targetCardWidth, 240);
  for (let targetCardWidth = 40; targetCardWidth <= 1000; targetCardWidth+=10) {
    assert.equal(readSettings(JSON.parse(JSON.stringify({ targetCardWidth }))).targetCardWidth, targetCardWidth);
  }
  for (const targetCardWidth of [0, 30, 1010, 65, "40", null]) assert.equal(readSettings({ targetCardWidth }).targetCardWidth, 240);
});

test("autopass defaults off and validates its cancellable window", () => {
  assert.equal(readSettings({ autoPass: "true", automaticDelayMs: 10500 }).autoPass, false);
  for (const seconds of [1, 2, 6, 10]) {
    const input = { ...DEFAULT_SETTINGS, autoPass: true, automaticDelayMs: seconds * 1000 };
    assert.deepEqual(readSettings(JSON.parse(JSON.stringify(input))), input);
  }
  for (const automaticDelayMs of [0, 999, 2500, 10001, "2000", null]) {
    assert.equal(readSettings({ automaticDelayMs }).automaticDelayMs, 3000);
  }
});

test("removed rendering and flick choices are ignored while surviving saved preferences remain intact", () => {
  assert.deepEqual(readSettings({flickMode:"add",singleAlwaysWild:true,singleAlwaysTwo:true,improveSuitReadability:false}),DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.keepGroupsTogether, true);
  assert.equal(DEFAULT_SETTINGS.groupExceptWild, true);
  assert.equal(DEFAULT_SETTINGS.groupExceptTwo, true);
  assert.equal(DEFAULT_SETTINGS.autoPass, false);
  const saved = { ...DEFAULT_SETTINGS, animationSpeed: 1, keepGroupsTogether:false,
    groupExceptWild: false, groupExceptTwo: false, autoPass: true };
  assert.deepEqual(readSettings(JSON.parse(JSON.stringify(saved))), saved);
  for(const keepGroupsTogether of [null,"false",1]) assert.equal(readSettings({keepGroupsTogether}).keepGroupsTogether,true);
});

test("replays use half the configured speed and keep the configured pause between actions", () => {
  const frame: TableView = { ...new GameServer().view(0), event: { kind: "play", seat: 1 } };
  const timing = { ...DEFAULT_SETTINGS, animationSpeed: .05, aiPauseMs: 1750, animate: true };
  assert.equal(replaySpeed(timing), .025);
  assert.equal(replayDelay(frame, timing, true) - replayDelay(frame, timing, false), 1750);
  assert(replayDelay(frame, timing, false) > tableAnimationTime(frame, timing.animationSpeed, true) * 1.9);
  assert.equal(replayDelay(frame, { ...timing, animate: false }, true), 1750);
});

test("pickups run after the play, revealing each player card before its own flight", () => {
  const initial: TableView = { ...new GameServer().view(0), turn: 1, legalLeads: [] };
  const player: TableView = { ...initial, event: { kind: "play", seat: 1, penalty: { seat: 0, count: 2 } } };
  const opponent: TableView = { ...initial, event: { kind: "play", seat: 0, penalty: { seat: 1, count: 5 } } };
  const playerDraw = drawTimeline(player, 0);
  const opponentDraw = drawTimeline(opponent, 1);
  const reflow = playReflow(player)!;
  assert.deepEqual(reflow, { landing: PLAY_TIME, start: PLAY_TIME, end: PLAY_TIME + STAGE_FLIGHT });
  assert.equal(playerDraw.start, reflow.end);
  assert.equal(playerDraw.cardStarts[0], reflow.end);
  assert(playerDraw.reveal > 0);
  assert.equal(playerDraw.total, reflow.end + 2 * (playerDraw.reveal + playerDraw.duration));
  assert.equal(opponentDraw.start, reflow.end + PLAY_SLIDE);
  assert.equal(opponentDraw.cardStarts[0], opponentDraw.start);
  assert.equal(opponentDraw.reveal, 0);
  assert.equal(opponentDraw.total, opponentDraw.start + 5 * opponentDraw.duration);
  assert.equal(tableAnimationTime(player, 1, true), playerDraw.total + 48);
  assert.equal(tableAnimationTime(opponent, 1, true), opponentDraw.total + 48);
  assert.equal(drawTimeline(player, 1).total, 0);
  assert.equal(drawTimeline({ ...initial, event: { kind: "draw", seat: 0, drawCount: 1 } }, 0).start, 0);
  assert.equal(tableAnimationTime({ ...player, event: { kind: "play", seat: 0 } }, 1, true), PLAY_TIME + PLAY_SLIDE + STAGE_FLIGHT + 48);
});

test("hand contrast settles only after the play and every pickup animation has finished", () => {
  const ready: TableView = { ...new GameServer().view(0), turn: 0, legalLeads: [7] };
  const play: TableView = { ...ready, event: { kind: "play", seat: 1 } };
  assert.deepEqual(handReadinessTimeline(play), { start: PLAY_TIME + STAGE_FLIGHT, duration: HAND_READY });
  const skip: TableView = { ...ready, event: { kind: "play", seat: 0, skips: true } };
  assert.deepEqual(handReadinessTimeline(skip), { start: PLAY_TIME + PLAY_SLIDE + STAGE_FLIGHT, duration: HAND_READY });
  const penalty: TableView = { ...play, event: { kind: "play", seat: 1, penalty: { seat: 0, count: 5 } } };
  assert.deepEqual(handReadinessTimeline(penalty), { start: drawTimeline(penalty, 0).total, duration: HAND_READY });
  const draw: TableView = { ...ready, event: { kind: "draw", seat: 0, drawCount: 1 } };
  assert.deepEqual(handReadinessTimeline(draw), { start: drawTimeline(draw, 0).total, duration: HAND_READY });
  for (const frame of [play, skip, penalty, draw]) {
    const phase = handReadinessTimeline(frame);
    assert.equal(tableAnimationTime(frame, .5, true), (phase.start + phase.duration) / .5 + 48);
    assert.equal(tableAnimationTime(frame, .5, false), 0);
  }
  assert.equal(handReadinessTimeline({ ...play, legalLeads: [] }).duration, HAND_READY);
  assert.equal(handReadinessTimeline({ ...skip, queuedCards: [7] }).duration, 0);
  assert.equal(handReadinessTimeline({ ...skip, turn: 1 }).duration, 0);
});

test("replay includes forced draws and passes, and stops when the player can act", () => {
  const initial = new GameServer().view(0);
  const replay = new OpponentReplay();
  const frame = (revision: number, seat: 0 | 1, turn: 0 | 1, kind: TurnEvent["kind"], leads: number[] = []): TableView =>
    ({ ...initial, revision, turn, legalLeads: leads, event: { seat, kind } });
  const frames = [frame(2, 0, 1, "play"), frame(3, 1, 0, "play"), frame(4, 0, 0, "draw"),
    frame(5, 0, 1, "pass"), frame(6, 1, 1, "play"), frame(7, 1, 0, "play", [5]),
    frame(8, 0, 0, "draw", [5]), frame(9, 0, 1, "pass"), frame(10, 1, 0, "play", [2])];
  for (let i = 1; i <= 5; i++) replay.record(frames[i - 1], frames[i]!);
  assert.equal(replay.last?.before, frames[0]);
  assert.deepEqual(replay.last?.frames, frames.slice(1, 6));
  replay.record(frames[5], frames[6]!);
  for (let i = 7; i < frames.length; i++) replay.record(frames[i - 1], frames[i]!);
  assert.equal(replay.last?.before, frames[7]);
  assert.deepEqual(replay.last?.frames, frames.slice(8));
  replay.record(frames[8], { ...frames[8]!, revision: 11, event: null });
  assert.equal(replay.last, undefined);
});

test("a forced draw on the game's opening turn alone does not enable replay", () => {
  const replay = new OpponentReplay();
  const initial = { ...new GameServer().view(0), turn: 0 as const, legalLeads: [] };
  const after: TableView = { ...initial, revision: initial.revision + 1, legalLeads: [7],
    event: { kind: "draw", seat: 0, drawCount: 1 } };
  replay.record(initial, after);
  assert.equal(replay.last, undefined);
});


test("a forced draw that offers a choice is excluded, along with voluntary automatic actions", () => {
  const initial={...new GameServer().view(0),revision:1,turn:1 as const,legalLeads:[]};
  const opponent={...initial,revision:2,turn:0 as const,event:{seat:1 as const,kind:"play" as const}};
  const drew={...opponent,revision:3,drewThisTurn:true,legalLeads:[7],event:{seat:0 as const,kind:"draw" as const}};
  const replay=new OpponentReplay();
  replay.record(initial,opponent);
  replay.record(opponent,drew);
  assert.deepEqual(replay.last?.frames,[opponent]);
  const voluntary={...drew,revision:4,event:{seat:0 as const,kind:"draw" as const}};
  replay.record(drew,voluntary);
  replay.record(voluntary,{...voluntary,revision:5,turn:1,event:{seat:0,kind:"pass"}});
  assert.deepEqual(replay.last?.frames,[opponent]);
});

test("automatic action preferences default off, persist, and migrate the earlier cancel delay",()=>{
  const settings=readSettings({autoPickup:true,autoSingle:true,autoSingleExcludeWild:true,autoSingleExcludeTwo:true,
    autoSingleExcludeQueen:true,autoSingleSkips:true,dimUnplayable:true,automaticDelayMs:10000});
  assert.deepEqual(readSettings(JSON.parse(JSON.stringify(settings))),settings);
  for(const key of ["autoPickup","autoSingle","autoSingleExcludeWild","autoSingleExcludeTwo","autoSingleExcludeQueen","autoSingleSkips","dimUnplayable"] as const){
    assert.equal(DEFAULT_SETTINGS[key],false);
    assert.equal(settings[key],true);
    assert.equal(readSettings({[key]:"true"})[key],false);
  }
  assert.equal(readSettings({autoPassDelayMs:5000}).automaticDelayMs,5000);
  assert.equal(readSettings({autoPassDelayMs:5000,automaticDelayMs:2000}).automaticDelayMs,2000);
});

test("queued skip prefixes end at landing and the final pickup waits for pile return and reflow", () => {
  const view: TableView = { ...new GameServer().view(0), turn: 0, queuedCards: [7],
    event: { kind: "play", seat: 0, skips: true } };
  assert.deepEqual(playReflow(view), { landing: PLAY_TIME, start: PLAY_TIME, end: PLAY_TIME });
  assert.deepEqual(handReadinessTimeline(view), { start: PLAY_TIME, duration: 0 });

  const final: TableView = { ...view, turn: 1, queuedCards: [],
    event: { kind: "play", seat: 0, penalty: { seat: 1, count: 2 } } };
  const reflow = playReflow(final)!;
  assert.deepEqual(reflow, { landing: PLAY_TIME, start: PLAY_TIME + PLAY_SLIDE,
    end: PLAY_TIME + PLAY_SLIDE + STAGE_FLIGHT });
  const draw = drawTimeline(final, 1);
  assert.deepEqual(draw.cardStarts, [reflow.end, reflow.end + draw.duration]);
});


test("group flicks put a non-eligible five on top while keeping the matching club first", () => {
  const clubs: Card = { id: 30, rank: 5, suit: "clubs", special: "normal" };
  const diamonds: Card = { id: 17, rank: 5, suit: "diamonds", special: "normal" };
  const spades: Card = { id: 43, rank: 5, suit: "spades", special: "normal" };
  const hand = [diamonds, spades, clubs];
  const settings = DEFAULT_SETTINGS;
  const legal = [clubs.id]; // 3 of clubs on the discard pile.
  for (const random of [() => 0, () => .99]) {
    assert.deepEqual(flickPlay(diamonds, hand, legal, settings, random), [clubs, spades, diamonds]);
    assert.deepEqual(flickPlay(spades, hand, legal, settings, random), [clubs, diamonds, spades]);
  }
  // The sole individually eligible card plays alone, without a top-suit picker.
  assert.deepEqual(flickPlay(clubs, hand, legal, settings), [clubs]);
  assert.deepEqual(flickPlay(diamonds, hand, legal, DEFAULT_SETTINGS), [clubs, spades, diamonds]);
  assert.equal(flickPlay(diamonds, hand, [], settings), undefined);
});

test("when every five can lead, the flicked five ends the group and the others are shuffled", () => {
  const hand: Card[] = ["clubs", "diamonds", "spades"].map((suit, id) =>
    ({ id, rank: 5, suit: suit as Card["suit"], special: "normal" }));
  const legal = hand.map(card => card.id); // 5 of hearts on the discard pile.
  const settings = DEFAULT_SETTINGS;
  for (const card of hand) {
    const first = flickPlay(card, hand, legal, settings, () => 0)!;
    const second = flickPlay(card, hand, legal, settings, () => .99)!;
    assert.equal(first.at(-1), card);
    assert.equal(second.at(-1), card);
    assert.deepEqual(first.slice(0, -1), second.slice(0, -1).reverse());
    assert.deepEqual(new Set(first), new Set(hand));
  }
});

test("shading shares group eligibility and respects flick exclusions and the remaining queue hand", () => {
  const clubs: Card = { id: 30, rank: 5, suit: "clubs", special: "normal" };
  const diamonds: Card = { id: 17, rank: 5, suit: "diamonds", special: "normal" };
  const other: Card = { id: 44, rank: 6, suit: "spades", special: "normal" };
  const hand = [clubs, diamonds, other];
  const settings = DEFAULT_SETTINGS;
  assert.deepEqual(flickPlayableCards(hand, [clubs.id], settings), new Set([clubs.id, diamonds.id]));
  assert.deepEqual(flickPlayableCards(hand, [], settings), new Set());
  // A staged lead is absent from the remaining hand and cannot unlock its group again.
  assert.deepEqual(flickPlayableCards([diamonds, other], [], settings), new Set());
  for (const [rank, special, exclusion] of [[2, "pickup", "groupExceptTwo"], [8, "wild", "groupExceptWild"]] as const) {
    const a = { ...clubs, rank, special }, b = { ...diamonds, rank, special };
    const group = [a, b];
    assert.deepEqual(flickPlay(a, group, [a.id], settings), exclusion === "groupExceptWild" ? [a] : undefined);
    assert.equal(flickPlay(b, group, [a.id], settings), undefined);
    assert.deepEqual(flickPlayableCards(group, [a.id], settings), new Set([a.id]));
    const allowed = { ...settings, [exclusion]: false };
    assert.deepEqual(flickPlayableCards(group, [a.id], allowed), new Set([a.id, b.id]));
    assert.deepEqual(flickPlay(b, group, [a.id], allowed), [a, b]);
    assert.deepEqual(flickPlay(a, [a], [a.id], settings), [a]);
  }
});

test("old group flick preferences are ignored", () => {
  for (const value of [undefined, false, true, null, 1, "true"]) {
    assert.deepEqual(readSettings({ flickNonEligibleGroup: value }), DEFAULT_SETTINGS);
  }
  assert(!("flickNonEligibleGroup" in DEFAULT_SETTINGS));
  assert(!("flickNonEligibleGroup" in readSettings({ flickNonEligibleGroup: false })));
});


test("two-card eligible groups put either flicked card on top without choosing a suit", () => {
  const clubs: Card = { id: 30, rank: 5, suit: "clubs", special: "normal" };
  const diamonds: Card = { id: 17, rank: 5, suit: "diamonds", special: "normal" };
  const hand = [clubs, diamonds];
  const legal = hand.map(card => card.id);
  assert.deepEqual(flickPlay(clubs, hand, legal, DEFAULT_SETTINGS), [diamonds, clubs]);
  assert.deepEqual(flickPlay(diamonds, hand, legal, DEFAULT_SETTINGS), [clubs, diamonds]);
});


test("dimming eligibility includes top cards against the discard and staged play", () => {
  const clubs: Card = { id: 30, rank: 5, suit: "clubs", special: "normal" };
  const diamonds: Card = { id: 17, rank: 5, suit: "diamonds", special: "normal" };
  const spades: Card = { id: 43, rank: 5, suit: "spades", special: "normal" };
  const other: Card = { id: 44, rank: 6, suit: "spades", special: "normal" };
  const hand = [clubs, diamonds, spades, other];
  const topMode = { ...DEFAULT_SETTINGS, dimUnplayable: true };
  assert.deepEqual(flickPlayableCards(hand, [clubs.id], topMode), new Set([clubs.id, diamonds.id, spades.id]));
  // A staged skip of diamonds allows the diamond five to start the next group.
  const staged: Card = { id: 23, rank: 11, suit: "diamonds", special: "skip" };
  const legal = hand.filter(card => canFollowInQueue(card, staged)).map(card => card.id);
  assert.deepEqual(legal, [diamonds.id]);
  assert.deepEqual(flickPlayableCards(hand, legal, topMode), new Set([diamonds.id, clubs.id, spades.id]));
  assert.deepEqual(flickPlay(clubs, hand, legal, topMode), [diamonds, spades, clubs]);
  // Group eligibility never lets an individually ineligible card be tapped into the queue.
  assert.equal(canFollowInQueue(clubs, staged), false);
});

test("obsolete top-card preferences cannot restore bottom-card behavior", () => {
  assert(!("flickSelectsTopCard" in DEFAULT_SETTINGS));
  for (const value of [undefined, false, true, null, 1, "true"]) {
    assert.deepEqual(readSettings({ flickSelectsTopCard: value }), DEFAULT_SETTINGS);
  }
});

test("drag tracking starts early with vertical intent, and also supports staged left swipes", () => {
  assert(!isCardDrag(0, 5, false));
  assert(!isCardDrag(20, 0, false));
  assert(isCardDrag(1, -6, false));
  assert(isCardDrag(0, 6, false));
  assert(isCardDrag(-6, 0, true));
  assert(!isCardDrag(6, 0, true));
  assert(!isUpwardFlick(0, -6, 100));
});

test("slow drops select the region with more actual group coverage", () => {
  const discard = { x: 0, y: 0, width: 100, height: 150 };
  const play = { x: 100, y: 0, width: 200, height: 150 };
  assert.equal(cardDropRegion([{ x: 30, y: 20, width: 100, height: 100 }], discard, play), "discard");
  assert.equal(cardDropRegion([{ x: 70, y: 20, width: 100, height: 100 }], discard, play), "play");
  assert.equal(cardDropRegion([{ x: 30, y: 200, width: 100, height: 100 }], discard, play), undefined);
  // Repeated overlap on the left cannot outweigh a larger distinct area on the right.
  const group = [{ x: 80, y: 0, width: 70, height: 100 }, { x: 80, y: 0, width: 20, height: 100 },
    { x: 80, y: 0, width: 20, height: 100 }, { x: 80, y: 0, width: 20, height: 100 }];
  assert.equal(coveredArea(group, discard), 2000);
  assert.equal(cardDropRegion(group, discard, play), "play");
});

test("drawn cards must be independently eligible for their drop destination", () => {
  const card: Card = { id: 30, rank: 5, suit: "clubs", special: "normal" };
  const skip: Card = { id: 49, rank: 11, suit: "spades", special: "skip" };
  const five: Card = { id: 4, rank: 5, suit: "hearts", special: "normal" };
  const view = { ...new GameServer().view(0), turn: 0 as const, hand: [card, skip, five], queuedCards: [], result: null, legalLeads: [card.id] };
  assert.equal(eligibleDrawDrop(card, view, [], "discard"), "discard");
  assert.equal(eligibleDrawDrop(card, view, [], "play"), "play");
  assert.equal(eligibleDrawDrop(card, view, [skip], "play"), undefined);
  assert.equal(eligibleDrawDrop(card, { ...view, legalLeads: [] }, [five], "discard"), undefined);
  assert.equal(eligibleDrawDrop(card, { ...view, legalLeads: [] }, [five], "play"), "play");
  assert.equal(eligibleDrawDrop(card, view, Array(12).fill(five), "play"), undefined);
  assert.equal(eligibleDrawDrop(card, view, [], undefined), undefined);
  assert.equal(eligibleDrawDrop(card, { ...view, hand: [] }, [], "discard"), undefined);
});

test("release preserves the sampled hover order and rejects stale or invalid plans", () => {
  const hand: Card[] = ["clubs", "diamonds", "hearts", "spades"].map((suit, id) =>
    ({ id, rank: 5, suit: suit as Card["suit"], special: "normal" }));
  const top = hand[1]!;
  const order = [0, 3, 2, 1];
  assert.deepEqual(retainedFlickPlay(order, top, hand, [0], DEFAULT_SETTINGS)?.map(card => card.id), order);
  assert.equal(retainedFlickPlay([3, 0, 2, 1], top, hand, [0], DEFAULT_SETTINGS), undefined);
  assert.equal(retainedFlickPlay([0, 3, 1, 2], top, hand, [0], DEFAULT_SETTINGS), undefined);
  assert.equal(retainedFlickPlay([0, 3, 3, 1], top, hand, [0], DEFAULT_SETTINGS), undefined);
  assert.equal(retainedFlickPlay(order, top, hand.slice(0, 3), [0], DEFAULT_SETTINGS), undefined);
  assert.equal(retainedFlickPlay(order, top, hand, [], DEFAULT_SETTINGS), undefined);
});
