import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "@crazy-eights/game-server";
import { wildSuitOptions, type Card, type TableView, type TurnEvent } from "@crazy-eights/protocol";
import { isUpwardFlick, isVerticalFlick, shouldPlayFlick } from "../src/card-gesture.ts";
import { OpponentReplay } from "../src/opponent-replay.ts";
import { ANIMATION_SPEEDS, DEFAULT_SETTINGS, readSettings } from "../src/settings.ts";
import { drawTimeline, PLAY_TIME, replayDelay, replaySpeed, tableAnimationTime } from "../src/table-timing.ts";

test("only a quick upward pointer gesture qualifies, and only a legal singleton plays directly", () => {
  assert(isUpwardFlick(9, -50, 150));
  assert(!isUpwardFlick(2, 50, 150));
  assert(!isUpwardFlick(35, -40, 150));
  assert(!isUpwardFlick(5, -50, 800));
  const single: Card = { id: 40, suit: "spades", rank: 2, special: "pickup" };
  const pair: Card = { id: 14, suit: "diamonds", rank: 2, special: "pickup" };
  assert(shouldPlayFlick(single, [single], [single.id]));
  assert(!shouldPlayFlick(single, [single, pair], [single.id]));
  assert(!shouldPlayFlick(single, [single], []));
});

test("the suit picker matches the game rule for single and multiple eights", () => {
  assert.deepEqual(wildSuitOptions("hearts", 1), ["diamonds", "clubs", "spades"]);
  assert.deepEqual(wildSuitOptions("hearts", 2), ["hearts", "diamonds", "clubs", "spades"]);
});

test("a queued card can be flicked in either vertical direction", () => {
  assert(isVerticalFlick(9, -50, 150));
  assert(isVerticalFlick(9, 50, 150));
  assert(!isVerticalFlick(48, 26, 150));
  assert(!isVerticalFlick(4, 60, 620));
});

test("skip flicks queue suit chains and the wild preference overrides rank grouping", () => {
  const jack: Card = { id: 49, suit: "spades", rank: 11, special: "skip" };
  const sameSuit: Card = { id: 42, suit: "spades", rank: 4, special: "normal" };
  const wild: Card = { id: 7, suit: "hearts", rank: 8, special: "wild" };
  const secondWild: Card = { id: 20, suit: "diamonds", rank: 8, special: "wild" };
  assert(!shouldPlayFlick(jack, [jack, sameSuit], [49]));
  assert(shouldPlayFlick(jack, [jack], [49]));
  assert(!shouldPlayFlick(wild, [wild, secondWild], [7]));
  assert(shouldPlayFlick(wild, [wild, secondWild], [7], true));
  assert.equal(readSettings({ alwaysPlayWild: true }).alwaysPlayWild, true);
  assert.equal(readSettings({ alwaysPlayWild: "true" }).alwaysPlayWild, false);
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
    { ...DEFAULT_SETTINGS, pickupAnimation: "concurrent", dangerWarning: false, dangerThreshold: 0 });
});

test("replays use half the configured speed and keep the configured pause between actions", () => {
  const frame: TableView = { ...new GameServer().view(0), event: { kind: "play", seat: 1 } };
  const timing = { ...DEFAULT_SETTINGS, animationSpeed: .05, aiPauseMs: 1750, animate: true };
  assert.equal(replaySpeed(timing), .025);
  assert.equal(replayDelay(frame, timing, true) - replayDelay(frame, timing, false), 1750);
  assert(replayDelay(frame, timing, false) > tableAnimationTime(frame, timing.animationSpeed, true, "sequential") * 1.9);
  assert.equal(replayDelay(frame, { ...timing, animate: false }, true), 1750);
});

test("pickups have one reflow followed by separate flights in sequential mode", () => {
  const initial = new GameServer().view(0);
  const frame: TableView = { ...initial, event: { kind: "play", seat: 1, penalty: { seat: 0, count: 2 } } };
  const sequential = drawTimeline(frame, 0, "sequential");
  const concurrent = drawTimeline(frame, 0, "concurrent");
  assert(sequential.sequential);
  assert.equal(sequential.start, PLAY_TIME);
  assert.equal(concurrent.start, PLAY_TIME);
  assert.equal(sequential.total, PLAY_TIME + sequential.reflow + 2 * sequential.duration);
  assert.equal(concurrent.total, PLAY_TIME + concurrent.duration);
  assert.equal(tableAnimationTime({ ...frame, event: { kind: "play", seat: 0 } }, 1, true, "sequential"), PLAY_TIME + 48);
  assert.equal(drawTimeline(frame, 1, "sequential").total, 0);
  assert.equal(tableAnimationTime(initial, 1, true, "sequential"), tableAnimationTime(initial, 1, true, "concurrent"));
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
  assert.deepEqual(replay.voluntaryDraw, { before: frames[5], after: frames[6] });
  for (let i = 7; i < frames.length; i++) replay.record(frames[i - 1], frames[i]!);
  assert.equal(replay.voluntaryDraw, undefined);
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
