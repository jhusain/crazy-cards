import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { MAX_HAND_CARDS } from "@crazy-eights/protocol";

const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) &&
  ["drawOrPass", "beginDeckDraw"].includes(statement.name?.text ?? "")).map(statement => statement.getText(source)).join("\n");
const script = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("deck clicks warn at the limit even after a draw, then pass after the warning", () => {
  for (const drewThisTurn of [false, true]) {
    const commands: string[] = [];
    const context = { view: { hand: Array(MAX_HAND_CARDS), drewThisTurn, event: null as any }, staged: [], MAX_HAND_CARDS,
      canUseStock: () => true, send: (command: { type: string }) => commands.push(command.type) };
    runInNewContext(script, context);
    (context as any).drawOrPass();
    assert.deepEqual(commands, ["draw"]);
    context.view.drewThisTurn = true;
    context.view.event = { handLimitReached: true };
    (context as any).drawOrPass();
    assert.deepEqual(commands, ["draw", "pass"]);
  }
});

test("pressing the deck at the limit can request a warning but never reveal an extra card", () => {
  const commands: string[] = [];
  const context: any = { view: { hand: Array(MAX_HAND_CARDS), drewThisTurn: true, event: null }, MAX_HAND_CARDS,
    deckDraw: undefined, canUseStock: () => true, scene: { setLocked() {} },
    send: (command: { type: string }) => { commands.push(command.type); return 1; } };
  runInNewContext(script, context);
  assert.equal(context.beginDeckDraw(), true);
  assert.deepEqual(commands, ["draw"]);
  context.view.event = { handLimitReached: true };
  assert.equal(context.beginDeckDraw(), false);
});
