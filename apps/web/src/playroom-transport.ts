import sdkSource from "playroomkit/multiplayer.full.umd.js?raw";
import type * as Playroom from "playroomkit";
import type { Invitation } from "./network-protocol.ts";

export const PLAYROOM_GAME_ID = "Gg5IWVj3dv7J7pF7wJTC";
export interface NetworkTransportEvents {
  packet(wire: string, sender: string): void;
  peerJoined(id: string): void;
  peerLeft(id: string): void;
  disconnected(message: string): void;
  problem(message: string): void;
}
export interface NetworkTransport {
  ready: Promise<{ id: string; room: string; isHost: boolean }>;
  send(wire: string): Promise<void>;
  close(): void;
}
export type TransportFactory = (invitation: Invitation, host: boolean, events: NetworkTransportEvents) => NetworkTransport | Promise<NetworkTransport>;

/** Runs in its own frame: removing it really closes the SDK's singleton and sockets. */
function runBridge(origin: string): void {
  const sdk = (window as unknown as { Playroom: typeof Playroom }).Playroom;
  const post = (data: object) => parent.postMessage({ crazyEights: true, ...data }, origin);
  let initialized = false;
  window.addEventListener("message", event => {
    if (event.source !== parent || event.origin !== origin || !event.data?.crazyEights) return;
    const message = event.data;
    if (message.type === "init" && !initialized) {
      initialized = true;
      void (async () => {
        try {
          sdk.RPC.register("ce-packet-v2", async (wire: unknown, sender) => {
            if (sender && typeof wire === "string" && wire.length <= 150_000) post({ type: "packet", wire, sender: sender.id });
            return true;
          });
          sdk.onPlayerJoin(player => {
            post({ type: "peer", id: player.id });
            player.onQuit(() => post({ type: "quit", id: player.id }));
          });
          await sdk.insertCoin({
            gameId: message.gameId,
            skipLobby: true,
            maxPlayersPerRoom: 2,
            reconnectGracePeriod: 1000,
            baseUrl: message.baseUrl,
            ...(message.host ? {} : { roomCode: message.room }),
          });
          sdk.onDisconnect(error => post({ type: "lost", message: error.reason || "Playroom connection ended." }));
          post({ type: "ready", id: sdk.myPlayer().id, room: sdk.getRoomCode(), isHost: sdk.isHost() });
        } catch (error) { post({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
      })();
    } else if (message.type === "send" && initialized) {
      // RPC uses Playroom's reliable WebSocket path; it does not wait for WebRTC.
      void sdk.RPC.call("ce-packet-v2", message.wire, sdk.RPC.Mode.OTHERS)
        .then(() => post({ type: "sent", ticket: message.ticket }))
        .catch(() => post({ type: "send-error", ticket: message.ticket }));
    }
  });
  post({ type: "boot" });
}

export function createPlayroomTransport(invitation: Invitation, host: boolean, events: NetworkTransportEvents): NetworkTransport {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Network match connection";
  frame.setAttribute("aria-hidden", "true");
  let closed = false, booted = false, ticket = 0;
  const pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let resolveReady!: (value: { id: string; room: string; isHost: boolean }) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<{ id: string; room: string; isHost: boolean }>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // A cancelled guest may not have anyone awaiting ready yet.
  void ready.catch(() => {});
  const post = (data: object) => frame.contentWindow?.postMessage({ crazyEights: true, ...data }, location.origin);
  const onMessage = (event: MessageEvent) => {
    if (closed || event.source !== frame.contentWindow || event.origin !== location.origin || !event.data?.crazyEights) return;
    const message = event.data;
    switch (message.type) {
      case "boot":
        if (booted) { events.disconnected("The connection restarted. Create a fresh invitation."); return; }
        booted = true;
        post({ type: "init", gameId: PLAYROOM_GAME_ID, host, room: invitation.room, baseUrl: location.href.split("#")[0] });
        break;
      case "ready":
        clearTimeout(timeout);
        resolveReady({ id: message.id, room: message.room, isHost: message.isHost });
        break;
      case "peer": events.peerJoined(message.id); break;
      case "quit": events.peerLeft(message.id); break;
      case "packet": events.packet(message.wire, message.sender); break;
      case "lost": events.disconnected(message.message); break;
      case "error":
        clearTimeout(timeout);
        rejectReady(new Error(message.message));
        events.problem(message.message === "ROOM_LIMIT_EXCEEDED" ? "This match already has two players." : "Could not connect to Playroom. Check your connection and try a fresh invitation.");
        break;
      case "sent": case "send-error": {
        const request = pending.get(message.ticket);
        if (!request) break;
        pending.delete(message.ticket); clearTimeout(request.timer);
        if (message.type === "sent") request.resolve(); else request.reject(new Error("Send failed"));
      }
    }
  };
  const timeout = setTimeout(() => {
    rejectReady(new Error("Playroom connection timed out"));
    events.problem("Could not reach Playroom. Check your internet connection, then cancel and try again.");
  }, 30_000);
  window.addEventListener("message", onMessage);
  const escape = (script: string) => script.replaceAll(/<\/script/gi, "<\\/script");
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><script>${escape(sdkSource)}</script><script>(${escape(runBridge.toString())})(${JSON.stringify(location.origin)})</script>`;
  document.body.append(frame);
  return {
    ready,
    send: wire => new Promise<void>((resolve, reject) => {
      if (closed) { reject(new Error("Connection closed")); return; }
      const id = ++ticket;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Game message timed out")); }, 15_000);
      pending.set(id, { resolve, reject, timer });
      post({ type: "send", wire, ticket: id });
    }),
    close: () => {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      frame.remove();
      rejectReady(new Error("Connection closed"));
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Connection closed")); }
      pending.clear();
    },
  };
}
