import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { setupInvitationLinks } from "../src/pwa.ts";
import { invitationUrl, type Invitation } from "../src/network-protocol.ts";

const base = "https://game.test/crazy-cards/";
const first = { room: crypto.randomUUID(), password: crypto.randomUUID() };
const second = { ...first, room: crypto.randomUUID() };

function browser(href = base, launchSupport = true) {
  const listeners = new Map<string, () => void>();
  let consumer: ((launch: { targetURL?: string }) => void) | undefined;
  const browser = {
    location: { href },
    addEventListener: (name: "hashchange", listener: () => void) => listeners.set(name, listener),
    ...(launchSupport ? { launchQueue: { setConsumer: (next: typeof consumer) => { consumer = next; } } } : {}),
  };
  return { browser, navigate(url: string) { browser.location.href = url; listeners.get("hashchange")?.(); },
    launch(targetURL?: string) { consumer?.({ targetURL }); } };
}

test("cold launch and a later fragment invitation both reach the running game", () => {
  const app = browser(invitationUrl(base, first), false);
  const received: Invitation[] = [];
  setupInvitationLinks(invite => received.push(invite), app.browser);
  app.navigate(invitationUrl(base, second));
  app.navigate(base + "#unrelated");
  assert.deepEqual(received, [first, second]);
});

test("launchQueue delivers invitations even when the current URL has no fragment", () => {
  const app = browser();
  const received: Invitation[] = [];
  setupInvitationLinks(invite => received.push(invite), app.browser);
  app.launch(invitationUrl(base, first));
  app.launch(invitationUrl(base + "index.html", second));
  assert.deepEqual(received, [first, second]);
});

test("launches outside the app or with invalid invitations are ignored", () => {
  const app = browser();
  setupInvitationLinks(() => assert.fail("Do not join an unrelated launch"), app.browser);
  for (const url of [undefined, "broken", base, base + "#network=playroom&match=x",
    invitationUrl("https://other.test/crazy-cards/", first),
    invitationUrl("https://game.test/other/", first)]) app.launch(url);
});

test("duplicate launch delivery does not restart a match, but a different invite does", async () => {
  const source = ts.createSourceFile("main.ts", readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const start = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "startNetwork")!;
  const script = ts.transpileModule(start.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const joins: Invitation[] = [];
  let resets = 0;
  const context: any = {
    window: { history: { replaceState() {} } }, location: { href: base }, invitationUrl,
    network: undefined, activeInvitation: undefined, networkGeneration: 0, debug: false, history: {}, worker: undefined,
    resetSession() { resets++; context.network = undefined; context.activeInvitation = undefined; },
    element: () => ({}), networkDialog: { showModal() {} }, bindConnection() {}, sendTiming() {}, updateControls() {},
    NetworkConnection: class { constructor(invite: Invitation) { joins.push(invite); } },
  };
  runInNewContext(script, context);
  await context.startNetwork(first);
  await context.startNetwork({ ...first });
  assert.equal(resets, 1);
  await context.startNetwork(second);
  assert.deepEqual(joins, [first, second]);
  assert.equal(resets, 2);
});
