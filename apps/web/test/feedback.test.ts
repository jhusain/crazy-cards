import assert from "node:assert/strict";
import test from "node:test";
import { countdownBeat } from "../src/feedback.ts";
import { guaranteedSkipFinish } from "../src/card-gesture.ts";
import { standardDeck } from "../../../packages/game-server/src/rules.ts";
test("countdown feedback changes beat only once per elapsed second",()=>{
 assert.deepEqual([0,16,999,1000,1016,1999,2000].map(countdownBeat),[0,0,0,1,1,1,2]);
});
test("whole-hand skip groups need no final-suit ordering prompt",()=>{
 for(const rank of [1,11]){
  const cards=standardDeck().filter(c=>c.rank===rank);
  assert(guaranteedSkipFinish(cards.slice(0,3),cards.slice(0,3)));
  assert(guaranteedSkipFinish(cards,cards));
  assert(!guaranteedSkipFinish(cards.slice(0,3),cards));
  assert(!guaranteedSkipFinish(cards.slice(0,2),cards.slice(0,2)));
 }
 const queens=standardDeck().filter(c=>c.rank===12);
 assert(!guaranteedSkipFinish(queens,queens));
});
