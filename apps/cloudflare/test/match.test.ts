import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { convertV4MiniflareOptions, Miniflare, type WebSocket } from "miniflare";
import { NETWORK_PROTOCOL } from "@crazy-eights/protocol/network";

test("Cloudflare authenticates seats, keeps draws private, and restores the match after eviction", { timeout: 30_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "crazy-eights-match-"));
  execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "deploy", "--dry-run", "--outdir", directory], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: "pipe",
  });

  const script = (await readFile(join(directory, "index.js"), "utf8")).replace(/\n\/\/# sourceMappingURL=.*$/, "");
  const worker = new Miniflare(convertV4MiniflareOptions({
      name: "crazy-cards",
      modules: true,
      script,
      compatibilityDate: "2026-11-27",
      durableObjects: { MATCHES: { className: "MatchRoom", useSQLite: true } },
      resourcePersistencePath: join(directory, "state"),
      unsafeInspectDurableObjects: true,
  }));
  t.after(async () => {
    await worker.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  const random = () => crypto.randomUUID();
  const invitation = random(), hostKey = random(), guestKey = random();
  const room = random();
  const path = "/rooms/" + room;
  async function connect(worker: Miniflare, role: string, key: string, invite = invitation) {
    const response = await worker.dispatchFetch("http://localhost" + path, {
      headers: {
        Upgrade: "websocket",
        Origin: "https://jhusain.github.io",
        "Sec-WebSocket-Protocol": [NETWORK_PROTOCOL, role, key, invite].join(", "),
      },
    });
    assert.equal(response.status, 101);
    const socket = response.webSocket!;
    const received: any[] = [];
    const events = new EventTarget();
    socket.addEventListener("message", event => {
      received.push(JSON.parse(event.data as string));
      events.dispatchEvent(new Event("received"));
    });
    socket.addEventListener("close", event => {
      received.push({ type: "close", code: event.code });
      events.dispatchEvent(new Event("received"));
    });
    socket.accept();
    if (socket.readyState === 1) socket.send(JSON.stringify({ type: "join" }));
    async function next(predicate: (message: any) => boolean) {
      const available = received.findIndex(predicate);
      if (available >= 0) return received.splice(available, 1)[0];
      const timeout = AbortSignal.timeout(4_000);
      return new Promise<any>((resolve, reject) => {
        const onMessage = () => {
          const index = received.findIndex(predicate);
          if (index === -1) return;
          events.removeEventListener("received", onMessage);
          resolve(received.splice(index, 1)[0]);
        };
        events.addEventListener("received", onMessage, { signal: timeout });
        timeout.addEventListener("abort", () => reject(new Error(`Timed out waiting for ${role} ${String(predicate)} after receiving ${received.map(({ type, opponent, code }) => JSON.stringify({ type, opponent, code })).join(", ")}`)), { once: true });
      });
    }
    return { socket, next };
  }

  const host = await connect(worker, "host", hostKey);
  assert.equal((await host.next(msg => msg.type === "presence")).opponent, false);
  const rejected = await connect(worker, "guest", random(), random());
  assert.equal((await rejected.next(msg => msg.type === "close")).code, 4001);
  const guest = await connect(worker, "guest", guestKey);
  const [hostState, guestState] = await Promise.all([host, guest].map(peer => peer.next(msg => msg.type === "state")));
  assert.equal(hostState.view.seat, 0);
  assert.equal(guestState.view.seat, 1);
  assert.equal(hostState.view.opponentCount, guestState.view.hand.length);
  assert(hostState.view.hand.every((card: { id: number }) => !guestState.view.hand.some((other: { id: number }) => other.id === card.id)));
  const uninvited = await connect(worker, "guest", random());
  assert.equal((await uninvited.next(msg => msg.type === "close")).code, 4001);

  const [actor, opponent] = hostState.view.turn === 0 ? [host, guest] : [guest, host];
  const send = (socket: WebSocket, requestId: number, revision: number, type: string) =>
    socket.send(JSON.stringify({ requestId, revision, command: { type } }));
  send(actor.socket, 11, hostState.view.revision, "debug-reshuffle");
  send(actor.socket, 12, hostState.view.revision, "draw");
  const draw = await actor.next(msg => msg.requestId === 12);
  const observation = await opponent.next(msg => msg.view?.revision === draw.view.revision);
  assert.equal(draw.type, "state");
  assert.equal(draw.view.event.drawnCards.length, 1);
  assert.equal(observation.view.event.drawnCards, undefined);
  assert.equal(observation.requestId, undefined);

  await worker.unsafeEvictDurableObject("crazy-cards", "MatchRoom", { name: room, webSockets: "close" });
  const rejoinedHost = await connect(worker, "host", hostKey);
  const restored = await rejoinedHost.next(msg => msg.type === "state");
  assert.equal(restored.view.revision, draw.view.revision);
  const rejoinedGuest = await connect(worker, "guest", guestKey);
  const guestRestored = await rejoinedGuest.next(msg => msg.type === "state");
  assert.equal(guestRestored.view.revision, draw.view.revision);
  assert.equal(guestRestored.view.seat, 1);
  rejoinedHost.socket.send(JSON.stringify({ type: "leave" }));
  assert.equal((await rejoinedGuest.next(msg => msg.type === "close")).code, 4001);
});
