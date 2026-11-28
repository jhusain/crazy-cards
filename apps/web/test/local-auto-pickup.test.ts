import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { GameServer } from "@crazy-eights/game-server";
import type { Response } from "@crazy-eights/protocol";
import ts from "typescript";
import { standardDeck } from "../../../packages/game-server/src/rules.ts";
import { DEFAULT_SETTINGS, readSettings } from "../src/settings.ts";

test("the AI match worker draws for a blocked human only when the no-eligible option is enabled", () => {
  const cards = standardDeck();
  const card = (rank: number, suit: string) => cards.find(c => c.rank === rank && c.suit === suit)!;
  const engine = new GameServer(1);
  Object.assign(engine, {
    turn: 0,
    hands: [[card(3, "hearts")], [card(6, "clubs")]],
    lastPlay: [card(4, "clubs")],
    stock: [card(4, "hearts")],
  });
  const published: Response[] = [];
  const self = {
    postMessage: (response: string) => published.push(JSON.parse(response)),
    onmessage: undefined as ((event: { data: string }) => void) | undefined,
  };
  const source = readFileSync(new URL("../src/game.worker.ts", import.meta.url), "utf8");
  const script = ts.transpileModule(source.replace(/^import .*;$/gm, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let pending: (() => void) | undefined;
  runInNewContext(script, {
    self, DEFAULT_SETTINGS, readSettings, GameServer: function () { return engine; },
    tableAnimationTime: () => 0, performance: { now: () => 0 },
    setTimeout: (fn: () => void) => { pending = fn; },
    clearTimeout: () => { pending = undefined; },
  });
  const send = (message: object) => self.onmessage!({ data: JSON.stringify(message) });
  send({ requestId: 1, revision: 0, command: { type: "snapshot" } });
  assert.deepEqual(published[0]?.view.legalLeads, []);
  assert.equal(pending, undefined);
  send({ timing: { autoPickupSameEligible: true } });
  assert.equal(pending, undefined);
  send({ timing: { autoPickupNoEligible: true } });
  assert.equal(typeof pending, "function");
  pending!();
  assert.equal(published.at(-1)?.view.event?.kind, "draw");
  assert.equal(published.at(-1)?.view.event?.drawCount, 1);
});
