import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { GameServer } from "@crazy-eights/game-server";
import { SUITS, type Seat, type TableView, type Response } from "@crazy-eights/protocol";
import { invitationFromHash, invitationUrl, isNetworkRequest } from "../src/network-protocol.ts";
import { OpponentReplay } from "../src/opponent-replay.ts";

test("invitation round-trips a Pages subpath without putting secrets in the query", () => {
  const invite = { room: "random-room", password: "random-secret", host: "host-peer" };
  const url = new URL(invitationUrl("https://jhusain.github.io/crazy-cards/?debug=true#old", invite));
  assert.equal(url.pathname, "/crazy-cards/");
  assert.equal(url.search, "?debug=true");
  assert.deepEqual(invitationFromHash(url.hash), invite);
  assert.equal(invitationFromHash("#match=abc"), undefined);
  assert.equal(invitationFromHash("#match=a&key=b&host="), undefined);
});

test("network requests exclude debug, autoplay, and transport controls", () => {
  for (const type of ["draw", "pass", "play", "play-queue", "snapshot", "restart", "next-round"]) {
    assert(isNetworkRequest({ requestId: 1, revision: 2, command: { type } }));
  }
  for (const value of [null, {}, { debug: true }, { autoplay: true }, { command: { type: "draw" } },
    ...["debug-reshuffle", "debug-aggressiveness", "auto-play"].map(type => ({ requestId: 1, revision: 2, command: { type } }))]) {
    assert.equal(isNetworkRequest(value), false);
  }
});

for (const seat of [0, 1] as const) test(`network replay for seat ${seat} excludes every local action`, () => {
  const replay = new OpponentReplay();
  replay.network = true;
  const other = (1 - seat) as Seat;
  const initial = new GameServer(null).view(seat);
  const frames: TableView[] = [initial];
  const add = (actor: Seat, kind: "draw" | "pass" | "play", turn: Seat) => {
    const before = frames.at(-1)!;
    const after = { ...before, revision: before.revision + 1, turn, event: { seat: actor, kind } };
    replay.record(before, after); frames.push(after); return after;
  };
  add(seat, "play", other);
  const first = add(other, "play", other);
  const second = add(other, "play", seat);
  assert.deepEqual(replay.last?.frames, [first, second]);
  add(seat, "draw", seat); add(seat, "pass", other);
  assert.deepEqual(replay.last?.frames, [first, second]);
  const third = add(other, "play", seat);
  assert.deepEqual(replay.last?.frames, [third]);
  assert(replay.last?.frames.every(frame => frame.event?.seat !== seat));
  replay.reset(); assert.equal(replay.last, undefined);
});

test("two human seats finish rounds with host validation and private drawn cards", () => {
  const game = new GameServer(null, undefined, false, true);
  let plays = 0, rounds = 0;
  for (let step = 0; step < 1500 && rounds < 3; step++) {
    const host = game.view(0), guest = game.view(1);
    assert.equal(host.revision, guest.revision);
    assert.equal(game.cpuIsUp, false);
    assert.equal(new Set([...host.hand, ...guest.hand].map(card => card.id)).size, host.hand.length + guest.hand.length);
    const drawSeat = host.event?.kind === "draw" ? host.event.seat : host.event?.penalty?.seat;
    if (drawSeat !== undefined) assert.equal(game.view((1 - drawSeat) as Seat).event?.drawnCards, undefined);
    if (host.result) {
      rounds++;
      if (rounds === 3) break;
      const response = JSON.parse(game.handleJSON(1, JSON.stringify({ requestId: step, revision: guest.revision,
        command: { type: guest.matchResult ? "restart" : "next-round" } }))) as Response;
      assert.equal(response.type, "state");
      continue;
    }
    if (game.automaticMove) { assert.notEqual(game.automaticMove, "computer"); game.stepAutomatic(); continue; }
    const seat = host.turn!;
    const view = game.view(seat);
    const card = view.hand.find(card => view.legalLeads.includes(card.id));
    const command = card ? { type: "play", cards: [card.id], ...(card.special === "wild" ? { suit: SUITS.find(s => s !== view.activeSuit) } : {}) }
      : { type: view.drewThisTurn ? "pass" : "draw" };
    const response = JSON.parse(game.handleJSON(seat, JSON.stringify({ requestId: step, revision: view.revision, command }))) as Response;
    assert.equal(response.type, "state");
    if (card) plays++;
  }
  assert.equal(rounds, 3); assert(plays > 10);
});

test("host worker routes request IDs to the right seat and rejects remote worker controls", async t => {
  const workerUrl = new URL("../src/game.worker.ts", import.meta.url).href;
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');
    globalThis.self={postMessage:data=>parentPort.postMessage(data)};
    import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage('ready')});`, { eval: true });
  t.after(() => worker.terminate());
  const messages: Array<string | { remote: string }> = [];
  const next = (predicate: (message: string | { remote: string }) => boolean) => new Promise<string | { remote: string }>((resolve, reject) => {
    const timer = setTimeout(() => { worker.off("message", listener); reject(new Error("Host worker response timed out")); }, 5000);
    const listener = (message: string | { remote: string }) => { if (predicate(message)) { clearTimeout(timer); worker.off("message", listener); resolve(message); } };
    worker.on("message", listener);
  });
  const ready = next(message => message === "ready");
  worker.on("message", message => { if (message !== "ready") messages.push(message); });
  await ready;
  let remote = next(message => typeof message !== "string" && !!message.remote);
  worker.postMessage({ network: true });
  const initial = JSON.parse((await remote as { remote: string }).remote) as Response;
  assert.equal(initial.view.seat, 1);
  worker.postMessage({ remote: JSON.stringify({ debug: true }) });
  worker.postMessage({ remote: JSON.stringify({ requestId: 20, revision: initial.view.revision, command: { type: "debug-aggressiveness" } }) });
  remote = next(message => typeof message !== "string" && JSON.parse(message.remote).requestId === 21);
  worker.postMessage({ remote: JSON.stringify({ requestId: 21, revision: initial.view.revision, command: { type: "snapshot" } }) });
  assert.equal(JSON.parse((await remote as { remote: string }).remote).view.seat, 1);
  assert(!messages.some(message => typeof message === "string" && JSON.parse(message).requestId === 21));
  assert(!messages.some(message => typeof message !== "string" && JSON.parse(message.remote).requestId === 20));
  const local = next(message => typeof message === "string" && JSON.parse(message).requestId === 22);
  worker.postMessage(JSON.stringify({ requestId: 22, revision: initial.view.revision, command: { type: "snapshot" } }));
  assert.equal(JSON.parse(await local as string).view.seat, 0);
  remote = next(message => typeof message !== "string" && JSON.parse(message.remote).requestId === 23);
  worker.postMessage({ remote: JSON.stringify({ requestId: 23, revision: -1, command: { type: "draw" } }) });
  assert.equal(JSON.parse((await remote as { remote: string }).remote).type, "error");
});

test("connection reports the failing stage instead of overwriting it with still waiting", async t => {
  const { NetworkConnection } = await import("../src/network.ts");
  const { joinRoom } = await import("trystero");
  let config: { trickleIce?: boolean } | undefined;
  let errorHandler: (error: { code: string; message: string }) => void = () => {};
  const fakeRoom = {
    ready: Promise.resolve(),
    makeAction: () => ({ onMessage() {}, send: async () => {} }),
    onPeerJoin() {}, onPeerLeave() {}, getPeers: () => ({}),
    onError: (handler: typeof errorHandler) => { errorHandler = handler; },
    getSelf: async () => ({ peerId: "host" }), leave: async () => {},
  };
  const connect = ((options: typeof config) => { config = options; return fakeRoom; }) as unknown as typeof joinRoom;
  const problems: string[] = [];
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const connection = new NetworkConnection(undefined, { room: "test", password: "secret", host: "host" }, {
    connected() {}, disconnected() {}, problem: message => problems.push(message),
  }, connect);
  t.after(() => connection.terminate());
  assert.equal(config?.trickleIce, false);
  connection.terminate();
  const timed = new NetworkConnection(undefined, { room: "test2", password: "secret", host: "host" }, {
    connected() {}, disconnected() {}, problem: message => problems.push(message),
  }, connect);
  t.after(() => timed.terminate());
  errorHandler({ code: "peer-connect-failed", message: "ICE path failed" });
  t.mock.timers.tick(46_000);
  assert(problems.length >= 1);
  assert(problems.every(message => message.includes("peer-connect-failed")));
});
