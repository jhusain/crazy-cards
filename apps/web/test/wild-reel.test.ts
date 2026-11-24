import assert from "node:assert/strict";
import test from "node:test";
import { SUITS, wildSuitOptions } from "@crazy-eights/protocol";
import { suitInk, wildReelStop, wildReel, wildReelFrame, wildReelInk } from "../src/wild-reel.ts";
import { GameServer } from "@crazy-eights/game-server";
import { PLAY_FLIGHT, PLAY_TIME, STAGE_FLIGHT, HAND_READY, playPhases, playDuration, handReadinessTimeline, tableAnimationTime } from "../src/table-timing.ts";

test("wild reels start with the printed suit, end with the call and never repeat adjacent stops", () => {
  for (const first of SUITS) for (const last of SUITS) for (const random of [0, .3, .7, .999]) {
    const reel = wildReel(first, last, () => random);
    assert.equal(reel.length, 9);
    assert.equal(reel[0], first); assert.equal(reel[8], last);
    reel.forEach((suit,index)=>assert.equal(wildReelInk(reel,index/(8+Math.PI/3)),suitInk(suit)));
    assert(reel.every((suit, index) => !index || suit !== reel[index - 1]));
    assert.deepEqual(wildReelFrame(reel, 0), { current:first, next:reel[1], offset:0 });
    assert.deepEqual(wildReelFrame(reel, 1), { current:last, next:undefined, offset:0 });
  }
});

test("the reel spins at constant speed, springs back faster and stops abruptly at center", () => {
  const reel = wildReel("clubs", "hearts", () => .5);
  const velocity = 8 + Math.PI/3, arrival = 8/velocity, frequency=velocity*3;
  const frameAt = (time:number) => wildReelFrame(reel,time);
  const positionAt = (time:number) => Math.floor(time*velocity)+frameAt(time).offset;
  // Equal time steps throughout the spin, including just before spring engagement.
  for (const time of [0,.1,.3,.5,.7,arrival-.011]) {
    assert(Math.abs(positionAt(time+.01)-positionAt(time)-velocity*.01)<1e-10);
  }
  assert(Math.abs(frameAt(arrival).offset)<1e-12);
  const peakTime = arrival + Math.PI/(2*frequency);
  assert(Math.abs(frameAt(peakTime).offset - 1/3) < 1e-12);
  const epsilon=1e-6;
  assert(Math.abs(frameAt(arrival+epsilon).offset/epsilon-velocity)<.001);
  // Return speed increases after reversal, and is still full speed at the catch.
  const returnTime = 1-peakTime;
  const earlyReturn = frameAt(peakTime).offset-frameAt(peakTime+returnTime/4).offset;
  const lateReturn = frameAt(1-returnTime/4).offset-frameAt(1).offset;
  assert(lateReturn>earlyReturn*2);
  assert(Math.abs(frameAt(1-epsilon).offset/epsilon-velocity)<.001);
  assert.deepEqual(frameAt(1),{current:"hearts",next:undefined,offset:0});
  assert.deepEqual(frameAt(1.1),frameAt(1));
  for (let i=0;i<=100;i++) {
    const time=arrival+(1-arrival)*i/100;
    assert.equal(frameAt(time).current,"hearts");
    assert.equal(wildReelInk(reel,time),suitInk("hearts"));
  }
});

test("opponent wilds fly normally, cycle for 2.3 normal durations, pause for .2, then slide at normal speed", () => {
  const view = new GameServer().view(0);
  view.event = { kind:"play", seat:1 };
  view.visibleDiscard = [{ id:7, rank:8, suit:"clubs", special:"wild", calledSuit:"hearts" }];
  view.event.cards = view.visibleDiscard;
  view.turn=0;view.queuedCards=[];view.result=null;
  for(const restoring of [false,true]) {
    const phases = playPhases(false,restoring,true);
    assert.equal(phases.flight,PLAY_FLIGHT);
    const normal = playPhases(false,restoring);
    assert(Math.abs(phases.reelEnd-PLAY_TIME*2.3)<1e-9);
    assert.equal(phases.collapseEnd-phases.collapseStart,normal.collapseEnd-normal.collapseStart);
    assert.equal(phases.total-phases.returnStart,normal.total-normal.returnStart);
    assert.equal(phases.collapseStart,phases.reelEnd+PLAY_TIME*.2);
    assert.equal(phases.total,PLAY_TIME*2.5+normal.total-normal.collapseStart);
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


test("every reel stop uses only eligible suits for single and multiple wild plays",()=>{
  for(const active of SUITS) for(const count of [1,2,4]) {
    const eligible=wildSuitOptions(active,count);
    for(const first of SUITS) for(const last of eligible) for(const random of [0,.25,.75,.999]) {
      const reel=wildReel(first,last,()=>random,eligible);
      assert(reel.every(suit=>eligible.includes(suit)));
      assert.equal(reel.at(-1),last);
      assert.equal(reel.length,9);
      assert(reel.every((suit,i)=>!i||suit!==reel[i-1]));
      if(eligible.includes(first)) assert.equal(reel[0],first);
    }
  }
  assert(wildReel("hearts","hearts",()=>0,wildSuitOptions("hearts",2)).includes("hearts"));
});

test("rank ink follows the eased reel through black, red, black, black and red",()=>{
  const suits = ["spades", "hearts", "clubs", "spades", "hearts"] as const;
  const progressAt = (position:number) => position / (4 + Math.PI/3);
  suits.forEach((suit,index)=>assert.equal(wildReelInk(suits,progressAt(index)),suitInk(suit)));
  assert.equal(wildReelInk(suits,progressAt(.5)),"#632b38");
  assert.equal(wildReelInk(suits,progressAt(1.5)),"#632b38");
  assert.equal(wildReelInk(suits,progressAt(2.5)),"#202c33");
  assert.equal(wildReelInk(suits,progressAt(3.5)),"#632b38");
  assert.equal(wildReelInk(suits,-1),"#202c33");
  assert.equal(wildReelInk(suits,2),"#a6293d");
});


test("suit chimes align with each new centered suit and never repeat during recoil",()=>{
 const reel=wildReel("clubs","hearts",()=>.3), velocity=8+Math.PI/3;
 assert.equal(wildReelStop(reel,0),0);
 for(let stop=1;stop<reel.length;stop++){
  const time=stop/velocity;
  assert.equal(wildReelStop(reel,time-1e-6),stop-1);
  assert.equal(wildReelStop(reel,time),stop);
  assert.equal(wildReelInk(reel,time),suitInk(reel[stop]!));
 }
 for(let i=0;i<=100;i++)assert.equal(wildReelStop(reel,8/velocity+(1-8/velocity)*i/100),8);
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
  assert.equal(handReadinessTimeline(view).start, PLAY_TIME * 2 + STAGE_FLIGHT);
  assert.equal(tableAnimationTime(view, 1, true), PLAY_TIME * 2 + STAGE_FLIGHT + HAND_READY + 48);
  view.event.seat = 1;
  assert.equal(playDuration(view), playPhases(false, false, true).total + PLAY_TIME);
});
