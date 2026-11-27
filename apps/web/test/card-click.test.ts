import assert from "node:assert/strict";
import test from "node:test";
import { CardClicks } from "../src/card-click.ts";

test("a mouse double click flicks without first tapping, while a single click taps", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const clicks = new CardClicks(), events: string[] = [];
  const tap = () => events.push("tap"), flick = () => events.push("flick");
  clicks.click(1, "mouse", 0, tap, flick);
  context.mock.timers.tick(150);
  assert.deepEqual(events, []);
  clicks.click(1, "mouse", 150, tap, flick);
  context.mock.timers.tick(500);
  assert.deepEqual(events, ["flick"]);
  clicks.click(1, "mouse", 700, tap, flick);
  context.mock.timers.tick(450);
  assert.deepEqual(events, ["flick", "tap"]);
});

test("touch taps are immediate and a double tap has no additional action", () => {
  const clicks = new CardClicks(), events: string[] = [];
  const tap = () => events.push("tap"), flick = () => events.push("flick");
  clicks.click(1, "touch", 0, tap, flick);
  assert.deepEqual(events, ["tap"]);
  clicks.click(1, "touch", 150, tap, flick);
  assert.deepEqual(events, ["tap"]);
  clicks.click(1, "touch", 1000, tap, flick);
  assert.deepEqual(events, ["tap", "tap"]);
});

test("clicking different cards quickly preserves both single clicks and cancel clears a pending click", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const clicks = new CardClicks(), events: number[] = [];
  clicks.click(1, "mouse", 0, () => events.push(1), () => events.push(-1));
  clicks.click(2, "mouse", 50, () => events.push(2), () => events.push(-2));
  context.mock.timers.tick(450);
  assert.deepEqual(events, [1, 2]);
  clicks.click(3, "mouse", 1000, () => events.push(3), () => events.push(-3));
  clicks.cancel(); context.mock.timers.tick(500);
  assert.deepEqual(events, [1, 2]);
});
