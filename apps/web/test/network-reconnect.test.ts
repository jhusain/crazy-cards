import assert from "node:assert/strict";
import test from "node:test";
import { NetworkConnection } from "../src/network.ts";

test("returning to the game replaces a stale socket and resets the lobby status", async t => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    readonly protocols: string[];
    closed = false;
    onmessage?: (event: { data: string }) => void;
    constructor(_url: URL, protocols: string[]) {
      this.protocols = protocols;
      sockets.push(this);
    }
    close(): void { this.closed = true; }
    receive(message: object): void {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }

  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  for (const [key, value] of Object.entries({ document, window: new EventTarget(), WebSocket: FakeSocket })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }

  const statuses: string[] = [];
  const connection = new NetworkConnection({ room: crypto.randomUUID(), password: crypto.randomUUID() }, true, {
    connected: () => statuses.push("connected"),
    waiting: message => statuses.push(message),
    disconnected: message => assert.fail(message),
  }, crypto.randomUUID(), "wss://example.test");
  try {
    await Promise.resolve();
    const original = sockets[0]!;
    original.receive({ type: "ready" });
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(sockets.length, 1);

    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(sockets.length, 2);
    assert.equal(original.closed, true);
    const replacement = sockets[1]!;
    assert.deepEqual(replacement.protocols, original.protocols);
    assert.match(statuses.at(-1)!, /Reconnecting/);

    replacement.receive({ type: "ready" });
    replacement.receive({ type: "presence", opponent: false });
    assert.equal(statuses.at(-1), "Waiting for your opponent…");
    replacement.receive({ type: "presence", opponent: true });
    replacement.receive({ type: "state", view: {} });
    assert.equal(statuses.at(-1), "connected");
  } finally {
    connection.terminate();
  }
});
