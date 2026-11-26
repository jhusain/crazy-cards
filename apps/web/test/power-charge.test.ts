import assert from "node:assert/strict";
import test from "node:test";
import { chargeDuration, chargePalette, chargePulseThresholds, powerCharge } from "../src/power-charge.ts";
import { slamDescent, slamFlight } from "../src/play-impact.ts";
import { playPhases, playReflow, drawTimeline } from "../src/table-timing.ts";
import { GameServer } from "@crazy-eights/game-server";

test("only level four and above hold the fully raised pose during the charge", () => {
  const from = { x: 30, y: 600, width: 150 }, to = { x: 180, y: 250, width: 120 };
  for (const queued of [false, true]) for (const score of [0, 1, 3, 4, 9, 15]) {
    const timing = playPhases(queued, false, false, false, score);
    const descent = slamDescent(score);
    if (score < 4) {
      assert.equal(chargeDuration(score), 0);
      assert.equal(powerCharge(timing.flight / 2, timing.flight, descent, score).visible, false);
      continue;
    }
    const duration = chargeDuration(score);
    const start = timing.flight - descent - duration;
    assert(start > 0);
    assert.equal(powerCharge(start - 1, timing.flight, descent, score).visible, false);
    const raised = slamFlight(from, to, start, timing.flight, score);
    for (const fraction of [0, .25, .5, .75, 1]) {
      const elapsed = start + duration * fraction;
      const frame = powerCharge(elapsed, timing.flight, descent, score);
      assert(frame.visible);
      assert(Math.abs(frame.progress - fraction) < 1e-8);
      const held = slamFlight(from, to, elapsed, timing.flight, score);
      assert(Math.abs(held.x - raised.x) < 1e-8);
      assert(Math.abs(held.y - raised.y) < 1e-8);
      assert(Math.abs(held.width - raised.width) < 1e-8);
    }
    assert.equal(powerCharge(timing.flight - .001, timing.flight, descent, score).progress, 1);
    assert.equal(powerCharge(timing.flight, timing.flight, descent, score).visible, false);
    const landed = slamFlight(from, to, timing.flight, timing.flight, score);
    assert(Math.abs(landed.x - to.x) < 1e-8);
    assert(Math.abs(landed.y - to.y) < 1e-8);
  }
});

test("the palette brightens continuously to an entirely white background", () => {
  const initial = chargePalette(0);
  assert.equal(initial.base, 0x182b26);
  assert.deepEqual(initial.rays, [0x182b26, 0xefc875]);
  const final = chargePalette(1);
  assert.equal(final.base, 0xffffff);
  assert(final.rays.every(color => color === 0xffffff));
  let previous = [initial.base, ...initial.rays];
  for (let frame = 1; frame <= 100; frame++) {
    const palette = chargePalette(frame / 100);
    const colors = [palette.base, ...palette.rays];
    colors.forEach((color, index) => {
      for (const shift of [0, 8, 16]) assert(((color >> shift) & 255) >= ((previous[index]! >> shift) & 255));
    });
    previous = colors;
  }
});

test("phaser pulse intervals get shorter toward white, with more pulses at higher scores", () => {
  assert.deepEqual(chargePulseThresholds(3), []);
  for (const score of [4, 9, 15]) {
    const pulses = chargePulseThresholds(score);
    assert.equal(pulses.length, 2 * Math.min(12, 6 + Math.floor((score - 4) * .6)));
    assert.equal(pulses[0], 0);
    assert(pulses.at(-1)! < 1);
    let previous = Infinity;
    for (let index = 1; index < pulses.length; index++) {
      const interval = pulses[index]! - pulses[index - 1]!;
      assert(interval > 0 && interval < previous);
      previous = interval;
    }
  }
  assert(chargePulseThresholds(9).length > chargePulseThresholds(4).length);
});

test("charge time delays pickups and hand reflow without changing the discard slide", () => {
  for (const queued of [false, true]) for (const wild of [false, true]) for (const burn of [false, true]) {
    const four = playPhases(queued, false, wild, burn, 4);
    const three = playPhases(queued, false, wild, burn, 3);
    assert(Math.abs((four.collapseEnd - four.collapseStart) - (three.collapseEnd - three.collapseStart)) < 1e-8);
  }
  const view = new GameServer(null, () => 0).view(0);
  view.event = { kind: "play", seat: 0, aggressiveness: 4, penalty: { seat: 1, count: 5 } };
  assert.equal(playReflow(view)!.landing, playPhases(false, false, false, false, 4).total);
  assert.equal(drawTimeline(view, 1).start, playReflow(view)!.end);
});


test("aggressive wild plays hold at full lift through the suit reveal before charging and slamming", () => {
  const from = { x: 30, y: 600, width: 150 }, to = { x: 180, y: 250, width: 120 };
  for (const queued of [false, true]) for (const score of [1, 3, 4, 9]) {
    const timing = playPhases(queued, false, true, false, score);
    const riseEnd = timing.flight - timing.wildHold - chargeDuration(score) - slamDescent(score);
    const pose = slamFlight(from, to, riseEnd, timing.flight, score, timing.wildHold);
    assert(pose.y < to.y && pose.width > to.width);
    for (const elapsed of [riseEnd, (riseEnd + timing.reelEnd) / 2, timing.reelEnd]) {
      const held = slamFlight(from, to, elapsed, timing.flight, score, timing.wildHold);
      for (const key of ["x", "y", "width"] as const) assert(Math.abs(held[key] - pose[key]) < 1e-8);
      assert.equal(powerCharge(elapsed, timing.flight, slamDescent(score), score, timing.wildHold).progress, 0);
    }
    const landed = slamFlight(from, to, timing.flight, timing.flight, score, timing.wildHold);
    for (const key of ["x", "y", "width"] as const) assert(Math.abs(landed[key] - to[key]) < 1e-8);
    assert(timing.collapseStart >= timing.flight + (210 + (score - 1) * 75));
    assert.equal(timing.burnStart, null);
  }
});
