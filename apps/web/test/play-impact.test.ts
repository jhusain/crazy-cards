import assert from "node:assert/strict";
import test from "node:test";
import { otherSeat } from "@crazy-eights/protocol";
import { GameServer } from "@crazy-eights/game-server";
import { slamFlight, impactEnvelope, scatteredCard, tableShock } from "../src/play-impact.ts";
import { drawTimeline, playPhases, playReflow, tableAnimationTime, PLAY_FLIGHT, PLAY_HOLD, PLAY_TIME } from "../src/table-timing.ts";
import { artHeight } from "../src/table-layout.ts";

const from = { x: 130, y: 560, width: 100 };
const landing = { x: 210, y: 300, width: 90 };

test("slams lift and enlarge the group, then land exactly without changing the discard slide", () => {
  for (const score of [1, 4, 5, 9, 15]) {
    for (const queued of [false, true]) for (const wild of [false, true]) for (const burn of [false, true]) {
      const normal = playPhases(queued, false, wild, burn);
      const slam = playPhases(queued, false, wild, burn, score);
      assert(Math.abs((slam.collapseEnd - slam.collapseStart) - (normal.collapseEnd - normal.collapseStart)) < 1e-8);
      assert(Math.abs((slam.total - slam.returnStart) - (normal.total - normal.returnStart)) < 1e-8);
      assert(Math.abs(slam.total - normal.total - PLAY_FLIGHT - PLAY_HOLD) < 1e-8);
      assert(slam.flight > 0);
      assert(slam.collapseStart > slam.flight);
    }
    const flight = playPhases(false, false, false, false, score).flight;
    const raised = slamFlight(from, landing, flight - 115 / (1 + score * .18), flight, score);
    assert(raised.width > landing.width);
    assert(raised.y < landing.y);
    const start = slamFlight(from, landing, 0, flight, score);
    assert.equal(start.x, from.x); assert.equal(start.y, from.y); assert.equal(start.width, from.width);
    const end = slamFlight(from, landing, flight, flight, score);
    assert(Math.abs(end.x - landing.x) < 1e-8);
    assert(Math.abs(end.y - landing.y) < 1e-8);
    assert(Math.abs(end.width - landing.width) < 1e-8);
  }
  assert.equal(playPhases(false, false).total, PLAY_TIME);
  assert.equal(playPhases(true, false, false, false, 0).flight, 0);
});

test("higher aggression spends less time descending", () => {
  const flight = playPhases(false, false, false, false, 1).flight;
  const low = slamFlight(from, landing, flight - 50, flight, 1);
  const high = slamFlight(from, landing, flight - 50, flight, 9);
  // A strong slam stays fully raised until later, then falls faster.
  assert(high.width > low.width);
});

test("table shake scales linearly with score and stops completely", () => {
  for (const elapsed of [10, 30, 90, 150]) {
    const low = tableShock(elapsed, 0, 1), high = tableShock(elapsed, 0, 9);
    assert(Math.abs(high.x - low.x * 9) < 1e-8);
    assert(Math.abs(high.y - low.y * 9) < 1e-8);
  }
  assert.deepEqual(tableShock(0, 100, 9), { x: 0, y: 0 });
  assert.deepEqual(tableShock(400, 100, 9), { x: 0, y: 0 });
});

test("only scores five and above scatter the other hand, radially toward its own edge", () => {
  const origin = { x: 200, y: 350, width: 100 };
  for (const towardPlayer of [false, true]) {
    const handY = towardPlayer ? 590 : -50;
    const positions = [20, 120, 230, 330].map(x => ({ x, y: handY, width: 90 }));
    positions.forEach((home, index) => {
      assert.deepEqual(scatteredCard(home, origin, 4, index, towardPlayer, 1), { position: home, angle: 0 });
      const five = scatteredCard(home, origin, 5, index, towardPlayer, 1);
      const nine = scatteredCard(home, origin, 9, index, towardPlayer, 1);
      assert(towardPlayer ? five.position.y > home.y : five.position.y < home.y);
      assert((five.position.x - home.x) * (home.x + home.width / 2 - origin.x) >= 0);
      assert(Math.abs(nine.position.x - home.x - (five.position.x - home.x) * 5) < 1e-8);
      assert(Math.abs(nine.position.y - home.y - (five.position.y - home.y) * 5) < 1e-8);
      assert.deepEqual(scatteredCard(home, origin, 9, index, towardPlayer, 0), { position: home, angle: 0 });
      assert.equal(artHeight(five.position.width), artHeight(home.width));
    });
  }
});

test("scattered cards return concurrently with the existing slide, including staged and wild plays", () => {
  for (const queued of [false, true]) for (const wild of [false, true]) for (const burn of [false, true]) {
    const timing = playPhases(queued, false, wild, burn, 7);
    const at = (elapsed: number) => impactEnvelope(elapsed, timing.flight, timing.collapseStart, timing.collapseEnd);
    assert.equal(at(timing.flight - 1), 0);
    assert.equal(at(timing.collapseStart), 1);
    assert(Math.abs(at((timing.collapseStart + timing.collapseEnd) / 2) - .5) < 1e-8);
    assert.equal(at(timing.collapseEnd), 0);
    assert.equal(at(timing.total + 1), 0);
  }
});

test("input locking, pickup animations, and reflow wait for the complete slam timeline", () => {
  const view = new GameServer(null, () => 0).view(0);
  view.event = { kind: "play", seat: view.seat, aggressiveness: 9, penalty: { seat: otherSeat(view.seat), count: 2 } };
  const slam = playReflow(view)!;
  const draw = drawTimeline(view, otherSeat(view.seat));
  assert.equal(slam.landing, PLAY_TIME + PLAY_FLIGHT + PLAY_HOLD);
  assert.equal(draw.start, slam.end);
  assert(tableAnimationTime(view, 1, true) > draw.total);
  assert.equal(tableAnimationTime(view, 1, false), 0);
  assert.equal(tableAnimationTime(view, 2, true) - 48, (tableAnimationTime(view, 1, true) - 48) / 2);
});
