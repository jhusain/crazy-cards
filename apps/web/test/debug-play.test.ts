import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "@crazy-eights/game-server";
import type { TableView, TurnEvent } from "@crazy-eights/protocol";
import { debugPlayMessage } from "../src/debug-play.ts";

const before = new GameServer(null, () => 0).view(0);
const next = (event: TurnEvent): TableView => ({ ...before, revision: before.revision + 1, event });

test("debug play toasts include zero scores and identify either player", () => {
  assert.equal(debugPlayMessage(before, next({ kind: "play", seat: 0, aggressiveness: 0 }), true),
    "Your play: aggressiveness 0");
  assert.equal(debugPlayMessage(before, next({ kind: "play", seat: 1, aggressiveness: 9 }), true),
    "Opponent’s play: aggressiveness 9");
});

test("normal mode, duplicate snapshots, and non-play events never announce a score", () => {
  const play = next({ kind: "play", seat: 0, aggressiveness: 2 });
  assert.equal(debugPlayMessage(before, play, false), undefined);
  assert.equal(debugPlayMessage(play, play, true), undefined);
  assert.equal(debugPlayMessage(before, next({ kind: "play", seat: 0 }), true), undefined);
  for (const kind of ["draw", "pass", "shuffle"] as const) {
    assert.equal(debugPlayMessage(before, next({ kind, seat: 0 }), true), undefined);
  }
});

test("each individual play in a staged sequence produces its own toast", () => {
  let previous = before;
  for (const score of [1, 2, 9]) {
    const current = { ...previous, revision: previous.revision + 1,
      event: { kind: "play" as const, seat: 0 as const, aggressiveness: score } };
    assert.equal(debugPlayMessage(previous, current, true), `Your play: aggressiveness ${score}`);
    previous = current;
  }
});
