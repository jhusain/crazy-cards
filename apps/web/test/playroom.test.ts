import assert from "node:assert/strict";
import test from "node:test";
import { GameServer } from "@crazy-eights/game-server";
import { NetworkConnection } from "../src/network.ts";
import { decryptPacket, encryptPacket, networkKey } from "../src/network-crypto.ts";
import type { NetworkTransportEvents, TransportFactory } from "../src/playroom-transport.ts";
import type { Invitation } from "../src/network-protocol.ts";
import type { Response } from "@crazy-eights/protocol";

const waitFor = async (predicate: () => boolean) => {
  const until = Date.now() + 3000;
  while (!predicate()) { if (Date.now() >= until) throw new Error("Timed out waiting for the game"); await new Promise(resolve => setTimeout(resolve, 5)); }
};

function setupPair() {
  const endpoints = new Map<string, NetworkTransportEvents>();
  const wires: string[] = [];
  const factory: TransportFactory = (_invitation, host, events) => {
    const id = host ? "host" : "guest";
    endpoints.set(id, events);
    queueMicrotask(() => {
      for (const [other, remote] of endpoints) if (other !== id) { remote.peerJoined(id); events.peerJoined(other); }
    });
    return {
      ready: Promise.resolve({ id, room: "TEST", isHost: host }),
      send: async wire => { wires.push(wire); for (const [other, remote] of endpoints) if (other !== id) remote.packet(wire, id); },
      close: () => { endpoints.delete(id); for (const remote of endpoints.values()) remote.peerLeft(id); },
    };
  };
  return { factory, wires, endpoints };
}

function fakeWorker() {
  let game: GameServer | undefined;
  const worker = {
    onmessage: null as ((event: { data: string | { remote: string } }) => void) | null,
    onerror: null,
    stopped: false,
    postMessage(message: string | { network?: boolean; remote?: string }) {
      if (typeof message === "object" && message.network) game = new GameServer(null, undefined, false, true);
      else if (typeof message === "object" && message.remote && game) {
        const response = game.handleJSON(1, message.remote);
        queueMicrotask(() => worker.onmessage?.({ data: { remote: response } }));
      }
      if (game && typeof message === "object" && message.network) queueMicrotask(() => {
        worker.onmessage?.({ data: game!.stateJSON(0) });
        worker.onmessage?.({ data: { remote: game!.stateJSON(1) } });
      });
    },
    terminate() { worker.stopped = true; },
  };
  return worker;
}

test("invitation encryption rejects wrong keys and altered packets", async () => {
  const key = await networkKey("a-random-invitation-secret");
  const packet = { type: "state", privateHand: [1, 8, 21] };
  const wire = await encryptPacket(key, packet);
  assert(!wire.includes("privateHand"));
  assert.deepEqual(await decryptPacket(key, wire), packet);
  await assert.rejects(decryptPacket(await networkKey("other-secret"), wire));
  const changed = JSON.parse(wire); changed.data = changed.data.slice(0, 4) + "AAAA" + changed.data.slice(8);
  await assert.rejects(decryptPacket(key, JSON.stringify(changed)));
});

test("Playroom admission starts the host worker and routes private guest responses", async t => {
  const { factory, wires, endpoints } = setupPair();
  const server = fakeWorker();
  let hostStarted = 0, guestStarted = 0;
  const failures: string[] = [];
  const hostViews: Response[] = [], guestViews: Response[] = [];
  const host = new NetworkConnection(server as unknown as Worker, { room: "", host: "", password: "secret" }, {
    connected: () => { hostStarted++; }, disconnected: message => failures.push(message), problem: message => failures.push(message),
  }, factory);
  host.onmessage = event => hostViews.push(JSON.parse(event.data));
  t.after(() => host.terminate());
  const invite = await host.getInvitation();
  assert.deepEqual(invite, { room: "TEST", host: "host", password: "secret" });
  const guest = new NetworkConnection(undefined, invite, {
    connected: () => { guestStarted++; }, disconnected() {}, problem: message => failures.push(message),
  }, factory);
  guest.onmessage = event => guestViews.push(JSON.parse(event.data));
  t.after(() => guest.terminate());
  await waitFor(() => guestViews.length >= 1 && hostViews.length >= 1);
  assert.equal(hostStarted, 1); assert.equal(guestStarted, 1);
  assert(guestViews.every(response => response.view.seat === 1));
  assert(hostViews.every(response => response.view.seat === 0));
  assert(wires.every(wire => !wire.includes('"hand"')));
  const snapshot = guestViews.at(-1)!;
  guest.postMessage(JSON.stringify({ requestId: 41, revision: snapshot.view.revision, command: { type: "snapshot" } }));
  await waitFor(() => guestViews.some(response => response.requestId === 41));
  assert(!hostViews.some(response => response.requestId === 41));
  // Replayed encrypted traffic is ignored, not replayed into the UI.
  const before = guestViews.length;
  for (const wire of wires.slice()) endpoints.get("guest")!.packet(wire, "host");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(guestViews.length, before);
  guest.terminate();
  assert(failures.some(message => message.includes("Opponent disconnected")));
});

test("a guessed room without its invitation secret cannot start the game", async t => {
  const { factory } = setupPair();
  const server = fakeWorker();
  let starts = 0;
  const callbacks = { connected: () => starts++, disconnected() {}, problem() {} };
  const host = new NetworkConnection(server as unknown as Worker, { room: "", host: "", password: "right" }, callbacks, factory);
  t.after(() => host.terminate());
  const invitation = await host.getInvitation();
  const guest = new NetworkConnection(undefined, { ...invitation, password: "wrong" }, callbacks, factory);
  t.after(() => guest.terminate());
  await guest.getInvitation();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(starts, 0);
});

test("cancelling while a transport starts disposes the late session", async () => {
  let finish!: (value: Awaited<ReturnType<TransportFactory>>) => void;
  let disposed = false;
  const factory: TransportFactory = () => new Promise(resolve => { finish = resolve; });
  const host = new NetworkConnection(fakeWorker() as unknown as Worker, { room: "", host: "", password: "secret" }, {
    connected() { throw new Error("Cancelled match started"); }, disconnected() {}, problem() {},
  }, factory);
  await Promise.resolve();
  host.terminate();
  finish({ ready: Promise.resolve({ id: "host", room: "TEST", isHost: true }), send: async () => {}, close: () => { disposed = true; } });
  await assert.rejects(host.getInvitation());
  assert(disposed);
});
