import assert from "node:assert/strict";
import test from "node:test";
import { SUITS, wildSuitOptions } from "@crazy-eights/protocol";
import { suitInk, wildReelSounds, wildReel, wildReelPosition, wildReelFrame, wildReelInk, WILD_BALANCE, WILD_RELEASE } from "../src/wild-reel.ts";
import { GameServer } from "@crazy-eights/game-server";
import { PLAY_FLIGHT, PLAY_TIME, PLAY_SLIDE, STAGE_FLIGHT, HAND_READY, playPhases, playDuration, handReadinessTimeline, tableAnimationTime } from "../src/table-timing.ts";

// Exercise both preselected endings for every possible call and eligibility set.
test("both snap directions balance between distinct eligible suits and resolve to the actual call", () => {
  for (const active of SUITS) for (const count of [1, 2, 4]) {
    const eligible = wildSuitOptions(active, count);
    for (const first of SUITS) for (const last of eligible) for (const random of [0, .3, .7, .999]) {
      const reel = wildReel(first, last, () => random, eligible);
      assert.equal(reel.snap, random < .5 ? "back" : "forward");
      assert(reel.suits.every(suit => eligible.includes(suit)));
      assert(reel.suits.every((suit, i) => !i || suit !== reel.suits[i - 1]));
      if (eligible.includes(first)) assert.equal(wildReelFrame(reel, 0).current, first);
      const balance = wildReelFrame(reel, WILD_BALANCE);
      assert.equal(balance.offset, .5);
      assert.notEqual(balance.current, balance.next);
      assert(balance.current === last || balance.next === last);
      assert.deepEqual(wildReelFrame(reel, WILD_RELEASE), balance);
      assert.equal(wildReelFrame(reel, 1).current, last);
      assert.equal(wildReelFrame(reel, 1).offset, 0);
      assert.equal(wildReelInk(reel, 1), suitInk(last));
      assert.deepEqual(wildReelFrame(reel, -1), wildReelFrame(reel, 0));
      assert.deepEqual(wildReelFrame(reel, 2), wildReelFrame(reel, 1));
    }
  }
});

test("travel slows progressively to zero at resistance, then accelerates and eases into the call", () => {
  for (const random of [.2, .8]) {
    const reel = wildReel("clubs", "hearts", () => random);
    const position = (time: number) => wildReelPosition(reel, time);
    let lastStep = Infinity;
    for (let i = 1; i <= 76; i++) {
      const step = position(i / 100) - position((i - 1) / 100);
      assert(step > 0 && step < lastStep);
      lastStep = step;
    }
    assert(Math.abs(position(WILD_BALANCE) - position(WILD_BALANCE - 1e-6)) < 1e-12);
    const target = position(1), balance = position(WILD_BALANCE);
    assert.equal(target - balance, reel.snap === "back" ? -.5 : .5);
    for (let i = 0; i <= 100; i++) {
      const value = position(WILD_RELEASE + (1 - WILD_RELEASE) * i / 100);
      assert(value >= Math.min(balance, target) && value <= Math.max(balance, target));
    }
    assert(Math.abs(position(1) - position(1 - 1e-6)) < 1e-9);
  }
});

test("ticks follow downward center departures and clicks follow detent crossings, including final release", () => {
  for (const random of [.2, .8]) {
    const reel = wildReel("clubs", "hearts", () => random);
    const spin = wildReelSounds(reel, 0, WILD_BALANCE);
    const balance = wildReelPosition(reel, WILD_BALANCE);
    assert.equal(spin.filter(sound => sound === "tick").length, Math.ceil(balance));
    assert.equal(spin.filter(sound => sound === "click").length, Math.floor(balance));
    assert.deepEqual(wildReelSounds(reel, WILD_BALANCE, WILD_RELEASE), []);
    assert.deepEqual(wildReelSounds(reel, WILD_RELEASE, 1), ["click"]);
    assert.deepEqual(wildReelSounds(reel, 1, 1.1), []);
    const sampled = Array.from({ length: 600 }, (_, i) => wildReelSounds(reel, i / 600, (i + 1) / 600)).flat();
    assert.deepEqual(sampled, wildReelSounds(reel, 0, 1));
    // Even a dropped frame spanning the hesitation and reversal loses no clicks.
    assert.deepEqual(wildReelSounds(reel, 0, .7).concat(wildReelSounds(reel, .7, 1)), sampled);
  }
});

test("ink follows the moving suits throughout forward travel and recoil", () => {
  for (const random of [.2, .8]) {
    const reel = wildReel("clubs", "hearts", () => random);
    for (let i = 0; i <= 100; i++) {
      const time = i / 100, frame = wildReelFrame(reel, time);
      if (frame.offset === 0 || suitInk(frame.current) === suitInk(frame.next ?? frame.current))
        assert.equal(wildReelInk(reel, time), suitInk(frame.current));
    }
    const frame = wildReelFrame(reel, WILD_BALANCE);
    assert.equal(wildReelInk(reel, WILD_BALANCE), suitInk(frame.current) === suitInk(frame.next!) ? suitInk(frame.current) : "#632b38");
  }
});

test("opponent wilds fly normally, cycle for 5.5 normal durations, pause for .2, then slide at normal speed", () => {
  const view = new GameServer().view(0);
  view.event = { kind:"play", seat:1 };
  view.visibleDiscard = [{ id:7, rank:8, suit:"clubs", special:"wild", calledSuit:"hearts" }];
  view.event.cards = view.visibleDiscard;
  view.turn=0;view.queuedCards=[];view.result=null;
  for(const restoring of [false,true]) {
    const phases = playPhases(false,restoring,true);
    assert.equal(phases.flight,PLAY_FLIGHT);
    const normal = playPhases(false,restoring);
    assert(Math.abs(phases.reelEnd-PLAY_TIME*5.5)<1e-9);
    assert.equal(phases.collapseEnd-phases.collapseStart,normal.collapseEnd-normal.collapseStart);
    assert.equal(phases.total-phases.returnStart,normal.total-normal.returnStart);
    assert.equal(phases.collapseStart,phases.reelEnd+PLAY_TIME*.2);
    assert.equal(phases.total,PLAY_TIME*5.7+normal.total-normal.collapseStart);
    assert(phases.collapseEnd>phases.collapseStart);
    assert(phases.returnStart<=phases.total);
  }
  const duration=playPhases(false,false,true).total;
  assert.equal(playDuration(view),duration);
  assert.deepEqual(handReadinessTimeline(view),{start:duration+STAGE_FLIGHT,duration:HAND_READY});
  assert.equal(tableAnimationTime(view,1,true),duration+STAGE_FLIGHT+HAND_READY+48);
  assert.equal(tableAnimationTime(view,1,false),0);
  assert.equal(playDuration({...view,event:{kind:"play",seat:0}}),PLAY_TIME);
  assert.equal(playDuration({...view,event:{kind:"play",seat:1,cards:[{id:0,rank:1,suit:"clubs",special:"reverse"}]}}),PLAY_TIME);
});


test("wild-on-wild burns for one normal play duration before the incoming slide", () => {
  for (const [queued, wild] of [[false, false], [true, false], [false, true]] as const) {
    for (const restoring of [false, true]) {
      const normal = playPhases(queued, restoring, wild);
      const burn = playPhases(queued, restoring, wild, true);
      assert.equal(normal.burnStart, null);
      assert.equal(burn.burnStart, normal.collapseStart);
      assert.equal(burn.collapseStart, burn.burnStart! + PLAY_TIME);
      assert.equal(burn.collapseEnd - burn.collapseStart, normal.collapseEnd - normal.collapseStart);
      assert.equal(burn.returnStart, normal.returnStart + PLAY_TIME);
      assert.equal(burn.total, normal.total + PLAY_TIME);
      assert.equal(burn.reelEnd, normal.reelEnd);
    }
  }
  const view = new GameServer().view(0);
  view.turn = 0;
  view.event = { kind: "play", seat: 0, burnsPreviousPlay: true,
    cards: [{ id: 7, rank: 8, suit: "clubs", special: "wild", calledSuit: "hearts" }] };
  assert.equal(playDuration(view), PLAY_TIME * 2);
  assert.equal(handReadinessTimeline(view).start, PLAY_TIME * 2 + PLAY_SLIDE + STAGE_FLIGHT);
  assert.equal(tableAnimationTime(view, 1, true), PLAY_TIME * 2 + PLAY_SLIDE + STAGE_FLIGHT + HAND_READY + 48);
  view.event.seat = 1;
  assert.equal(playDuration(view), playPhases(false, false, true).total + PLAY_TIME);
});
