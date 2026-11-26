import { joinRoom, type Room, type MessageAction } from "trystero";
import type { Response } from "@crazy-eights/protocol";
import { isNetworkRequest, NETWORK_PROTOCOL, type Invitation } from "./network-protocol.ts";
import type { TableTiming } from "./table-timing.ts";

export interface GameConnection {
  postMessage(data: string): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
interface Callbacks {
  connected(): void;
  disconnected(message: string): void;
  problem(message: string): void;
}

/** One host worker owns all state. Only seat-specific views cross the data channel. */
export class NetworkConnection implements GameConnection {
  onmessage: GameConnection["onmessage"] = null;
  onerror: GameConnection["onerror"] = null;
  private room: Room;
  private channel: MessageAction<string>;
  private peer?: string;
  private started = false;
  private closed = false;
  private ended = false;
  private timing?: TableTiming;
  private timer: ReturnType<typeof setTimeout>;
  readonly isHost: boolean;

  constructor(private server: Worker | undefined, private invitation: Invitation, private callbacks: Callbacks) {
    this.isHost = !!server;
    this.room = joinRoom({ appId: "jhusain/crazy-cards", password: invitation.password }, invitation.room);
    this.channel = this.room.makeAction<string>("match-v1");
    this.channel.onMessage((data, { peerId }) => {
      if (this.closed || this.ended || typeof data !== "string" || data.length > 100_000) return;
      let packet;
      try { packet = JSON.parse(data); } catch { return; }
      if (packet.protocol !== NETWORK_PROTOCOL) return;
      if (this.isHost) {
        if (packet.type === "hello") {
          if (this.peer && this.peer !== peerId) { this.transmit({ type: "full" }, peerId); return; }
          this.peer = peerId;
          if (!this.started) {
            this.start();
            server!.postMessage({ network: true });
          }
          this.transmit({ type: "accepted" });
          return;
        }
        if (peerId !== this.peer || !this.started) return;
        if (packet.type === "request" && isNetworkRequest(packet.request)) {
          server!.postMessage({ remote: JSON.stringify(packet.request) });
        } else if (packet.type === "timing" && packet.timing && typeof packet.timing === "object") {
          server!.postMessage({ guestTiming: packet.timing });
        } else if (packet.type === "leave") this.disconnect("Opponent left the match.");
      } else {
        if (peerId !== invitation.host) return;
        this.peer = peerId;
        if (packet.type === "full") { this.disconnect("This invitation is already in use."); return; }
        if (packet.type === "leave") { this.disconnect("The host left the match."); return; }
        if (packet.type === "accepted" || packet.type === "state") {
          if (!this.started) { this.start(); if (this.timing) this.postMessage(JSON.stringify({ timing: this.timing })); }
        }
        if (packet.type === "state" && typeof packet.response === "string") {
          const response = JSON.parse(packet.response) as Response;
          if (response.view?.seat === 1) this.onmessage?.(new MessageEvent("message", { data: packet.response }));
        }
      }
    });
    this.room.onPeerJoin(({ peerId }) => {
      if (!this.isHost && peerId === invitation.host) {
        this.peer = peerId;
        this.transmit({ type: "hello" });
      }
    });
    this.room.onPeerLeave(({ peerId }) => {
      if (peerId === this.peer) this.disconnect(this.isHost ? "Opponent disconnected." : "Host disconnected.");
    });
    this.room.onError(error => {
      if (!this.started && !this.closed) callbacks.problem(error.code === "peer-connect-failed"
        ? "These networks could not connect directly. Try another Wi-Fi or mobile network."
        : "Connection service unavailable. Still trying…");
    });
    this.timer = setTimeout(() => {
      if (!this.started && !this.closed) callbacks.problem("Still waiting. Keep both pages open. If connection fails, try another network.");
    }, 25_000);
    if (server) {
      server.onmessage = ({ data }: MessageEvent<string | { remote: string }>) => {
        if (this.closed || this.ended) return;
        if (typeof data === "string") this.onmessage?.(new MessageEvent("message", { data }));
        else if (data.remote) this.transmit({ type: "state", response: data.remote });
      };
      server.onerror = event => { this.disconnect("The host’s game stopped. Start a new match."); this.onerror?.(event); };
    }
  }

  async getInvitation(): Promise<Invitation> {
    return { ...this.invitation, host: (await this.room.getSelf()).peerId };
  }

  private start(): void {
    this.started = true;
    clearTimeout(this.timer);
    this.callbacks.connected();
  }

  private transmit(packet: object, target = this.peer): void {
    if (!target || this.closed || this.ended) return;
    void this.channel.send(JSON.stringify({ protocol: NETWORK_PROTOCOL, ...packet }), { target })
      .catch(() => this.disconnect("Connection lost. Start a new match."));
  }

  private disconnect(message: string): void {
    if (this.closed || this.ended) return;
    this.ended = true;
    clearTimeout(this.timer);
    this.server?.postMessage({ disconnected: true });
    this.callbacks.disconnected(message + " Start a new network match to reconnect.");
  }

  postMessage(data: string): void {
    if (this.closed || this.ended) return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.timing) {
      this.timing = message.timing;
      if (this.isHost) this.server!.postMessage(data);
      else if (this.started) this.transmit({ type: "timing", timing: this.timing });
    } else if (isNetworkRequest(message) && this.started) {
      if (this.isHost) this.server!.postMessage(data);
      else this.transmit({ type: "request", request: message });
    }
    // Replay and menu controls are local: they must never pause the other player.
  }

  terminate(): void {
    if (this.closed) return;
    if (!this.ended) this.transmit({ type: "leave" });
    this.closed = true;
    clearTimeout(this.timer);
    this.server?.terminate();
    void this.room.leave().catch(() => {});
  }
}
