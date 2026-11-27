import { DurableObject } from "cloudflare:workers";
import { GameServer } from "@crazy-eights/game-server";
import type { Response as GameResponse, Seat } from "@crazy-eights/protocol";
import { isMatchToken, isNetworkRequest, NETWORK_PROTOCOL } from "@crazy-eights/protocol/network";
import { DEFAULT_SETTINGS, readSettings } from "../../web/src/settings.ts";
import { tableAnimationTime, type TableTiming } from "../../web/src/table-timing.ts";

interface Env {
  MATCHES: DurableObjectNamespace<MatchRoom>;
}

const idleLifetime = 2 * 60 * 60 * 1000;
const defaultTiming = { ...DEFAULT_SETTINGS, animate: true };

interface Room {
  host: string;
  invitation: string;
  guest?: string;
  match?: ReturnType<GameServer["saveMatch"]>;
  timing: [TableTiming, TableTiming];
  expiresAt: number;
  nextMoveAt?: number;
  closed?: boolean;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/health") return new Response(NETWORK_PROTOCOL);
    const room = /^\/rooms\/([^/]+)$/.exec(path)?.[1];
    if (!isMatchToken(room)) return new Response("Not found", { status: 404 });
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    // The browser's Origin identifies the Pages app. Local Vite is allowed in development.
    const origin = request.headers.get("Origin") ?? "";
    const local = new URL(request.url).hostname === "localhost" || new URL(request.url).hostname === "127.0.0.1";
    if (origin !== "https://jhusain.github.io" && !(local && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
      return new Response("Origin not allowed", { status: 403 });
    }
    return env.MATCHES.getByName(room).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class MatchRoom extends DurableObject<Env> {
  private get room(): Room | undefined {
    return this.ctx.storage.kv.get<Room>("room");
  }

  async fetch(request: Request): Promise<Response> {
    const [protocol, role, credential, invitation, extra] = (request.headers.get("Sec-WebSocket-Protocol") ?? "").split(/,\s*/);
    if (protocol !== NETWORK_PROTOCOL || !isMatchToken(credential) || !isMatchToken(invitation) || extra ||
      (role !== "host" && role !== "guest")) return new Response("Invalid credentials", { status: 400 });

    let room = this.room;
    const now = Date.now();
    if (!room && role === "host") {
      room = { host: credential, invitation, timing: [defaultTiming, defaultTiming], expiresAt: now + idleLifetime };
    }
    if (!room || room.closed || room.expiresAt <= now) return this.reject("This invitation has expired or the match has ended.");
    if (room.invitation !== invitation || role === "host" && room.host !== credential) {
      return this.reject("This invitation is invalid.");
    }
    if (role === "guest" && room.guest && room.guest !== credential) {
      return this.reject("The guest seat is already taken.");
    }

    const seat: Seat = role === "host" ? 0 : 1;
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const tag = String(seat);
    const existing = this.ctx.getWebSockets(tag);
    this.ctx.acceptWebSocket(server, [tag]);
    for (const previous of existing) previous.close(4002, "Seat reconnected");

    if (seat === 1) room.guest = credential;
    if (this.room) this.ctx.storage.kv.put("room", room);
    else await this.save(room);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": NETWORK_PROTOCOL } });
  }

  private reject(reason: string): Response {
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    server.accept();
    server.close(4001, reason);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": NETWORK_PROTOCOL } });
  }

  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== "string" || data.length > 4096 || socket.readyState !== WebSocket.OPEN) return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (!message || typeof message !== "object") return;
    const room = this.room;
    if (!room || room.closed || room.expiresAt <= Date.now()) return;
    const seat: Seat = this.ctx.getTags(socket).includes("0") ? 0 : 1;
    if (message.type === "join" && !socket.deserializeAttachment()) {
      socket.serializeAttachment(true);
      if (message.timing && typeof message.timing === "object") {
        room.timing[seat] = { ...readSettings(message.timing), animate: message.timing.animate !== false };
      }
      let game = room.match ? GameServer.restoreMatch(room.match) : undefined;
      const starting = !game && this.bothPresent();
      if (starting) {
        game = new GameServer(null, undefined, false, true);
        this.updateMatch(room, game);
      }
      const saved = starting ? this.save(room) : undefined;
      if (!starting) this.ctx.storage.kv.put("room", room);
      this.send(socket, { type: "ready" });
      this.sendPresence();
      if (game) {
        if (this.bothPresent()) this.publish(game);
        else this.send(socket, JSON.parse(game.stateJSON(seat)));
      }
      await saved;
      return;
    }
    if (!socket.deserializeAttachment()) return;
    if (message.type === "leave") {
      const reason = seat === 0 ? "The host left the match." : "Your opponent left the match.";
      await this.end(room, reason);
      return;
    }
    if (message.timing && typeof message.timing === "object") {
      room.timing[seat] = { ...readSettings(message.timing), animate: message.timing.animate !== false };
      this.ctx.storage.kv.put("room", room);
      return;
    }
    if (!room.match || !isNetworkRequest(message)) return;
    const game = GameServer.restoreMatch(room.match);
    const previousRevision = game.view(seat).revision;
    const response = JSON.parse(game.handleJSON(seat, data)) as GameResponse;
    if (response.type === "state" && response.view.revision !== previousRevision) {
      this.updateMatch(room, game, message.command.type === "draw");
      const saved = this.save(room);
      this.publish(game, seat, response);
      await saved;
    } else {
      this.send(socket, response);
    }
  }

  webSocketClose(socket: WebSocket): void {
    this.sendPresence(socket);
  }

  async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    if (room.expiresAt <= now) {
      this.closeSockets("The match expired.");
      this.ctx.storage.kv.delete("room");
      return;
    }
    if (room.match && room.nextMoveAt !== undefined && room.nextMoveAt <= now) {
      const game = GameServer.restoreMatch(room.match);
      game.stepAutomatic();
      this.updateMatch(room, game);
      const saved = this.save(room);
      this.publish(game);
      await saved;
    } else {
      await this.save(room);
    }
  }

  private updateMatch(room: Room, game: GameServer, voluntaryDraw = false): void {
    room.match = game.saveMatch();
    const now = Date.now();
    room.expiresAt = now + idleLifetime;
    const move = game.automaticMove;
    if (!move || move === "pass" && voluntaryDraw) {
      delete room.nextMoveAt;
      return;
    }
    const delay = Math.max(...([0, 1] as const).map(seat => {
      const timing = room.timing[seat];
      return tableAnimationTime(game.view(seat), timing.animationSpeed, timing.animate);
    }));
    room.nextMoveAt = now + (move === "queued" ? delay + 80 : Math.max(delay, move === "draw" ? 850 : 900));
  }

  private async save(room: Room): Promise<void> {
    this.ctx.storage.kv.put("room", room);
    const next = Math.min(room.expiresAt, room.nextMoveAt ?? Infinity);
    // The SQLite-backed storage commits these operations together. Avoid an intervening read
    // before setAlarm, which could let another event replace the deadline.
    await this.ctx.storage.setAlarm(next);
  }

  private sockets(seat: Seat, except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets(String(seat)).filter(ws => ws !== except && ws.readyState === WebSocket.OPEN && ws.deserializeAttachment() === true);
  }

  private bothPresent(): boolean {
    return !!(this.sockets(0).length && this.sockets(1).length);
  }

  private sendPresence(except?: WebSocket): void {
    const host = this.sockets(0, except), guest = this.sockets(1, except);
    for (const ws of host) this.send(ws, { type: "presence", opponent: !!guest.length });
    for (const ws of guest) this.send(ws, { type: "presence", opponent: !!host.length });
  }

  private publish(game: GameServer, actor?: Seat, response?: GameResponse): void {
    for (const seat of [0, 1] as const) {
      const state = seat === actor && response ? response : JSON.parse(game.stateJSON(seat));
      for (const socket of this.sockets(seat)) this.send(socket, state);
    }
  }

  private send(socket: WebSocket, message: object): void {
    try { socket.send(JSON.stringify(message)); } catch { /* The socket closed during delivery. */ }
  }

  private closeSockets(reason: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) socket.close(4001, reason);
    }
  }

  private async end(room: Room, reason: string): Promise<void> {
    room.closed = true;
    delete room.match;
    delete room.nextMoveAt;
    await this.save(room);
    this.closeSockets(reason);
  }
}
