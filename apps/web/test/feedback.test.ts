import assert from "node:assert/strict";
import test from "node:test";
import { countdownBeat } from "../src/feedback.ts";
test("countdown feedback changes beat only once per elapsed second",()=>{
 assert.deepEqual([0,16,999,1000,1016,1999,2000].map(countdownBeat),[0,0,0,1,1,1,2]);
});
