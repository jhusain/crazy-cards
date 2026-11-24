import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "@crazy-eights/game-server";
import type { TableView } from "@crazy-eights/protocol";
import { BACK_INNER_TOP, BACK_INNER_BOTTOM, pointRollOffsets, shuffleFrame } from "../src/shuffle-animation.ts";
import { roundProgress } from "../src/round-progress.ts";
import { OpponentReplay } from "../src/opponent-replay.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";
import { HAND_READY, PLAY_TIME, SHUFFLE_DURATION, SHUFFLE_FILL, SHUFFLE_HALF, SHUFFLE_ROLL, SHUFFLE_PAUSE,
  drawTimeline, handReadinessTimeline, replayDelay, tableAnimationTime } from "../src/table-timing.ts";

const deck={x:20,y:120,width:118};
const discard={x:155,y:120,width:118};
const close=(a:number,b:number)=>assert(Math.abs(a-b)<.0001,`${a} differs from ${b}`);
const pickup=():TableView=>({...new GameServer().view(0),seat:0,turn:0,legalLeads:[3],event:{kind:"play",seat:1,
  penalty:{seat:0,count:5},reshuffles:[{drawIndex:2,stockCount:20,pointsBefore:1,pointsAfter:2}]}});

test("shuffle timing fills in a third, cuts and returns in halves, then rolls and pauses for one normal animation each",()=>{
  close(SHUFFLE_FILL,PLAY_TIME/3);close(SHUFFLE_HALF,PLAY_TIME/2);close(SHUFFLE_ROLL,PLAY_TIME);close(SHUFFLE_PAUSE,PLAY_TIME);
  close(SHUFFLE_DURATION,PLAY_TIME*16/3);
  for(let i=0;i<=4;i++){
    const frame=shuffleFrame(SHUFFLE_FILL*i/4,deck,discard,2);
    assert.equal(frame.cards.filter(card=>card.visible).length,i);
    assert(frame.cards.every(card=>card.position.width===118));
  }
});

test("the bottom half covers the first discard before its depth swaps and it returns above the other half",()=>{
  const almost=shuffleFrame(SHUFFLE_FILL+SHUFFLE_HALF-.001,deck,discard,2);
  assert.equal(almost.stage,"cut");
  assert(almost.cards[2]!.depth<almost.cards[0]!.depth);
  const cut=shuffleFrame(SHUFFLE_FILL+SHUFFLE_HALF,deck,discard,2);
  assert.equal(cut.stage,"return");assert.equal(cut.cycle,0);
  assert.deepEqual(cut.cards[2]!.position,discard);
  assert.deepEqual(cut.cards[0]!.position,{...deck,x:24,y:124});
  assert(cut.cards[2]!.depth>cut.cards[0]!.depth);
  const returned=shuffleFrame(SHUFFLE_FILL+2*SHUFFLE_HALF,deck,discard,2);
  assert.equal(returned.cycle,1);
  assert.deepEqual(returned.cards[2]!.position,deck);
  assert.deepEqual(returned.cards[0]!.position,{...deck,x:24,y:124});
  const points=shuffleFrame(SHUFFLE_FILL+6*SHUFFLE_HALF,deck,discard,2);
  assert.equal(points.stage,"points");assert.equal(points.cycle,3);assert.equal(points.pointProgress,0);
  const paused=shuffleFrame(SHUFFLE_DURATION-SHUFFLE_PAUSE,deck,discard,2);
  assert.equal(paused.stage,"pause");assert.equal(paused.pointProgress,1);
  const stillPaused=shuffleFrame(SHUFFLE_DURATION-.001,deck,discard,2);
  assert.equal(stillPaused.stage,"pause");assert.deepEqual(stillPaused.cards,paused.cards);
  const done=shuffleFrame(SHUFFLE_DURATION,deck,discard,2);
  assert.equal(done.stage,"done");assert.equal(done.cycle,3);assert.equal(done.pointProgress,1);
  for(const frame of [almost,cut,returned,points,paused,done]){
    assert.deepEqual(frame.cards.map(card=>card.depth).sort(),[0,1,2,3]);
    assert(frame.cards.every(card=>card.position.width===deck.width));
  }
});

test("a debug reshuffle has its entire timeline and pause without drawing or replaying a player turn",()=>{
  const view=pickup();
  view.event={kind:"shuffle",seat:0,reshuffles:[{drawIndex:0,stockCount:20,pointsBefore:2,pointsAfter:4}]};
  const draw=drawTimeline(view,0);
  assert.equal(draw.count,0);assert.deepEqual(draw.cardStarts,[]);
  assert.equal(draw.shuffles.length,1);assert.equal(draw.shuffles[0]!.start,0);
  assert.equal(draw.total,SHUFFLE_DURATION);
  assert.equal(handReadinessTimeline(view).start,SHUFFLE_DURATION);
  assert.equal(tableAnimationTime(view,1,true),SHUFFLE_DURATION+HAND_READY+48);
  assert.equal(drawTimeline(view,1).total,0);
  assert.equal(tableAnimationTime(view,1,false),0);
  const history=new OpponentReplay();
  const prior={...view,revision:view.revision-1,event:{seat:1 as const,kind:"play" as const}};
  history.record({...prior,revision:prior.revision-1},prior);
  assert(history.last);
  history.record(prior,view);
  assert.equal(history.last,undefined);
});

test("both point labels travel downward through the full inner rectangle",()=>{
  const height=BACK_INNER_BOTTOM-BACK_INNER_TOP;
  assert.deepEqual(pointRollOffsets(0),{old:0,next:-height});
  assert.deepEqual(pointRollOffsets(.5),{old:height/2,next:-height/2});
  assert.deepEqual(pointRollOffsets(1),{old:height,next:0});
});

test("a mid-pickup recycle waits for old-stock draws, then delays every subsequent draw and the hand's ready state",()=>{
  const view=pickup(),draw=drawTimeline(view,0),step=draw.duration+draw.reveal;
  assert.deepEqual(draw.cardStarts,[PLAY_TIME,PLAY_TIME+step,PLAY_TIME+2*step+SHUFFLE_DURATION,
    PLAY_TIME+3*step+SHUFFLE_DURATION,PLAY_TIME+4*step+SHUFFLE_DURATION]);
  assert.equal(draw.shuffles[0]!.start,PLAY_TIME+2*step);
  assert.equal(draw.total,PLAY_TIME+5*step+SHUFFLE_DURATION);
  assert.equal(handReadinessTimeline(view).start,draw.total);
  assert.equal(tableAnimationTime(view,.7,true),(draw.total+HAND_READY)/.7+48);
  assert.equal(tableAnimationTime(view,.7,false),0);
  assert.deepEqual(drawTimeline(view,1).shuffles,[]);
  const timing={...DEFAULT_SETTINGS,animate:true};
  assert.equal(replayDelay(view,timing,false),tableAnimationTime(view,timing.animationSpeed*.5,true));
});

test("an empty-deck recycle precedes the first draw, while a new-round PPC change alone has no shuffle",()=>{
  const view=pickup();
  view.event={kind:"draw",seat:0,drawCount:1,reshuffles:[{drawIndex:0,stockCount:20,pointsBefore:2,pointsAfter:4}]};
  const draw=drawTimeline(view,0);
  assert.equal(draw.shuffles[0]!.start,0);
  assert.equal(draw.cardStarts[0],SHUFFLE_DURATION);
  assert.equal(draw.total,SHUFFLE_DURATION+draw.duration+draw.reveal);
  assert.deepEqual(drawTimeline({...view,pointsPerCard:8,event:null},0).shuffles,[]);
});

test("the round denominator grows for ties, without changing for decisive results",()=>{
  const initial={round:1,roundsWon:[0,0] as [number,number],points:[0,0] as [number,number],result:null};
  assert.deepEqual(roundProgress(initial),{current:1,total:3});
  assert.deepEqual(roundProgress({...initial,result:{winner:"tie",points:0}}),{current:1,total:4});
  assert.deepEqual(roundProgress({...initial,round:2}),{current:2,total:4});
  assert.deepEqual(roundProgress({...initial,round:2,roundsWon:[1,0],result:{winner:0,points:2}}),{current:2,total:4});
  assert.deepEqual(roundProgress({...initial,round:3,roundsWon:[1,0]}),{current:3,total:4});
  assert.deepEqual(roundProgress({...initial,round:5,roundsWon:[1,2],points:[-2,2],result:{winner:1,points:2}}),{current:5,total:5});
});


test("tied match scores add a round and extra decisive rounds never shrink the total",()=>{
  const tied={round:3,roundsWon:[2,1] as [number,number],points:[0,0] as [number,number],result:{winner:1 as const,points:2}};
  assert.deepEqual(roundProgress(tied),{current:3,total:4});
  assert.deepEqual(roundProgress({...tied,round:4,result:null}),{current:4,total:4});
  assert.deepEqual(roundProgress({...tied,round:4,result:{winner:"tie",points:0}}),{current:4,total:5});
  assert.deepEqual(roundProgress({...tied,round:5,roundsWon:[3,1],points:[1,-1]}),{current:5,total:5});
});
