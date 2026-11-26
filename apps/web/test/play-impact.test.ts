import assert from "node:assert/strict";
import test from "node:test";
import { otherSeat } from "@crazy-eights/protocol";
import { GameServer } from "@crazy-eights/game-server";
import { slamFlight, slamPlayFlight, slamShadow, slamDescent, slamIntensity, impactEnvelope, scatteredCard, tableShock } from "../src/play-impact.ts";
import { drawTimeline, playPhases, playReflow, tableAnimationTime, PLAY_FLIGHT, PLAY_SHAKE, PLAY_TIME } from "../src/table-timing.ts";
import { ART_WIDTH, CORNER_WIDTH, PILE_STEP, artHeight } from "../src/table-layout.ts";

const from = { x: 130, y: 560, width: 100 };
const landing = { x: 210, y: 300, width: 90 };

test("slams lift and enlarge the group, then land exactly without changing the discard slide", () => {
  for (const score of [1, 4, 5, 9, 15]) {
    for (const queued of [false, true]) for (const wild of [false, true]) for (const burn of [false, true]) {
      const normal = playPhases(queued, false, wild, burn);
      const slam = playPhases(queued, false, wild, burn, score);
      assert(Math.abs((slam.collapseEnd - slam.collapseStart) - (normal.collapseEnd - normal.collapseStart)) < 1e-8);
      assert(Math.abs((slam.total - slam.returnStart) - (normal.total - normal.returnStart)) < 1e-8);
      assert(Math.abs(slam.total - normal.total - PLAY_FLIGHT - PLAY_SHAKE) < 1e-8);
      assert(slam.flight > 0);
      assert(slam.collapseStart > slam.flight);
    }
    const flight = playPhases(false, false, false, false, score).flight;
    const raised = slamFlight(from, landing, flight - slamDescent(score), flight, score);
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

test("each aggression step raises the play higher and enlarges its apparent elevation", () => {
  const flight = playPhases(false, false, false, false, 1).flight;
  let previous = landing;
  for (let score = 1; score <= 15; score++) {
    const peak = slamFlight(from, landing, flight - slamDescent(score), flight, score);
    assert(peak.y < previous.y);
    assert(peak.width > previous.width);
    previous = peak;
  }
});

test("raised groups keep every identifying corner visible, allowing card bodies to clip", () => {
  for (const boardWidth of [320, 412, 768]) for (const count of [1, 2, 4]) for (const score of [1, 4, 9, 15]) {
    const width = Math.min(200, boardWidth / 2);
    const positions = Array.from({ length: count }, (_, i) => ({ x: 60 + i * width * PILE_STEP, y: 170, width }));
    const flight = playPhases(true, false, false, false, score).flight;
    const raised = slamPlayFlight(positions, positions, flight - slamDescent(score), flight, score, boardWidth, 12);
    raised.forEach((position, index) => {
      assert(position.x >= 12 - 1e-8);
      assert(position.y >= 12 - 1e-8);
      const cornerRight = position.x + position.width * CORNER_WIDTH / ART_WIDTH;
      assert(cornerRight <= boardWidth - 12 + 1e-8);
      if (index + 1 < raised.length) assert(cornerRight <= raised[index + 1]!.x + 1e-8);
    });
    const landed = slamPlayFlight(positions, positions, flight, flight, score, boardWidth, 12);
    landed.forEach((position, index) => {
      assert(Math.abs(position.x - positions[index]!.x) < 1e-8);
      assert(Math.abs(position.y - positions[index]!.y) < 1e-8);
      assert(Math.abs(position.width - positions[index]!.width) < 1e-8);
    });
  }
});

test("all aggressive plays finish shaking before the discard slide starts", () => {
  for (const queued of [false, true]) for (const wild of [false, true]) for (const burn of [false, true]) {
    const timing = playPhases(queued, false, wild, burn, 9);
    assert(timing.collapseStart >= timing.flight + PLAY_SHAKE);
    assert.deepEqual(tableShock(timing.collapseStart, timing.flight, 9), { x: 0, y: 0 });
  }
});

test("raised cards project a moving shadow onto the surface below and lose it on landing", () => {
  for (const staged of [false, true]) for (const score of [1, 4, 9]) {
    const source = staged ? { ...landing, x: landing.x + 100 } : from;
    const flight = playPhases(staged, false, false, false, score).flight;
    const atStart = slamShadow(source, landing, 0, flight, score);
    assert.equal(atStart.alpha, 0);
    assert.equal(atStart.x, source.x);
    assert.equal(atStart.y, source.y);
    const elapsed = flight - slamDescent(score);
    const raised = slamFlight(source, landing, elapsed, flight, score);
    const shadow = slamShadow(source, landing, elapsed, flight, score);
    assert(shadow.y > raised.y);
    assert(shadow.x > raised.x);
    assert(shadow.blur > 0);
    assert(shadow.alpha > 0 && shadow.alpha <= .24);
    // The shadow stays on the surface at the projected card size, below its raised silhouette.
    assert(shadow.width < raised.width);
    assert.equal(shadow.height, artHeight(shadow.width));
    const contact = slamShadow(source, landing, flight, flight, score);
    assert(contact.alpha < 1e-8);
    assert(contact.blur < 1e-8);
    assert(Math.abs(contact.x - landing.x) < 1e-8);
    assert(Math.abs(contact.y - landing.y) < 1e-8);
  }
});

test("table shake scales linearly with score and stops completely", () => {
  assert.equal(tableShock(0, 0, 1).y, 3 * .7);
  for (const elapsed of [10, 30, 90, 150]) {
    const low = tableShock(elapsed, 0, 1), high = tableShock(elapsed, 0, 9);
    assert(Math.abs(high.x - low.x * 9) < 1e-8);
    assert(Math.abs(high.y - low.y * 9) < 1e-8);
  }
  assert.deepEqual(tableShock(0, 100, 9), { x: 0, y: 0 });
  assert.deepEqual(tableShock(400, 100, 9), { x: 0, y: 0 });
});

test("each aggression step adds three intensity units and triples the descent-speed increment", () => {
  assert.equal(slamIntensity(0), 0);
  for (let score = 1; score <= 15; score++) {
    assert.equal(slamIntensity(score) - slamIntensity(score - 1), 3);
    const previousIncrement = .18 / 115;
    const increment = 1 / slamDescent(score) - 1 / slamDescent(score - 1);
    assert(Math.abs(increment - 3 * previousIncrement) < 1e-10);
  }
});

test("only scores four and above scatter the other hand, radially toward its own edge", () => {
  const origin = { x: 200, y: 350, width: 100 };
  for (const towardPlayer of [false, true]) {
    const handY = towardPlayer ? 590 : -50;
    const positions = [20, 120, 230, 330].map(x => ({ x, y: handY, width: 90 }));
    positions.forEach((home, index) => {
      assert.deepEqual(scatteredCard(home, origin, 3, index, towardPlayer, 1), { position: home, angle: 0 });
      const four = scatteredCard(home, origin, 4, index, towardPlayer, 1);
      const nine = scatteredCard(home, origin, 9, index, towardPlayer, 1);
      assert(towardPlayer ? four.position.y > home.y : four.position.y < home.y);
      assert((four.position.x - home.x) * (home.x + home.width / 2 - origin.x) >= 0);
      assert(Math.abs(nine.position.x - home.x - (four.position.x - home.x) * 6) < 1e-8);
      assert(Math.abs(nine.position.y - home.y - (four.position.y - home.y) * 6) < 1e-8);
      assert.deepEqual(scatteredCard(home, origin, 9, index, towardPlayer, 0), { position: home, angle: 0 });
      assert.equal(artHeight(four.position.width), artHeight(home.width));
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
  assert.equal(slam.landing, PLAY_TIME + PLAY_FLIGHT + PLAY_SHAKE);
  assert.equal(draw.start, slam.end);
  assert(tableAnimationTime(view, 1, true) > draw.total);
  assert.equal(tableAnimationTime(view, 1, false), 0);
  assert.equal(tableAnimationTime(view, 2, true) - 48, (tableAnimationTime(view, 1, true) - 48) / 2);
});
