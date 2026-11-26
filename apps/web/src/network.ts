import type { Response } from "@crazy-eights/protocol";
import { isNetworkRequest, NETWORK_PROTOCOL, type Invitation } from "./network-protocol.ts";
import { decryptPacket, encryptPacket, networkKey } from "./network-crypto.ts";
import type { NetworkTransport, TransportFactory } from "./playroom-transport.ts";
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
  diagnostics?(message: string): void;
}
const defaultTransport: TransportFactory = async (invitation, host, events) => {
  const { createPlayroomTransport } = await import("./playroom-transport.ts");
  return createPlayroomTransport(invitation, host, events);
};

/** Host authority stays in the worker. Playroom carries encrypted, seat-specific packets. */
export class NetworkConnection implements GameConnection {
  onmessage: GameConnection["onmessage"] = null;
  onerror: GameConnection["onerror"] = null;
  readonly isHost: boolean;
  private server: Worker | undefined;
  private invitation: Invitation;
  private callbacks: Callbacks;
  private transport?: NetworkTransport;
  private ready: Promise<void>;
  private key: Promise<CryptoKey>;
  private selfId?: string;
  private peer?: string;
  private peers = new Set<string>();
  private started = false;
  private closed = false;
  private ended = false;
  private timing?: TableTiming;
  private timer: ReturnType<typeof setTimeout>;
  private helloTimer: ReturnType<typeof setInterval>;
  private incoming = Promise.resolve();
  private outgoing = Promise.resolve();
  private sequence = 0;
  private received = new Map<string, number>();

  constructor(server: Worker | undefined, invitation: Invitation, callbacks: Callbacks, connect: TransportFactory = defaultTransport) {
    this.server = server;
    this.invitation = { ...invitation };
    this.callbacks = callbacks;
    this.isHost = !!server;
    this.key = networkKey(invitation.password);
    this.timer = setTimeout(() => {
      if (!this.started && !this.closed && !this.ended) callbacks.problem(this.selfId
        ? "Connected to Playroom. Still waiting for the other player; keep the host’s page open and use a fresh invitation."
        : "Connecting to Playroom…");
    }, 25_000);
    this.helloTimer = setInterval(() => this.hello(), 1500);
    if (server) {
      server.onmessage = ({ data }: MessageEvent<string | { remote: string }>) => {
        if (this.closed || this.ended) return;
        if (typeof data === "string") this.onmessage?.(new MessageEvent("message", { data }));
        else if (data.remote) this.transmit({ type: "state", response: data.remote });
      };
      server.onerror = event => { this.disconnect("The host’s game stopped."); this.onerror?.(event); };
    }
    this.ready = Promise.resolve().then(async () => {
      const transport = await connect(invitation, this.isHost, {
        packet: (wire, sender) => {
          // Preserve wire order while asynchronous decryption completes.
          this.incoming = this.incoming.then(() => this.receive(wire, sender)).catch(() => {});
        },
        peerJoined: id => { this.peers.add(id); this.hello(); },
        peerLeft: id => { this.peers.delete(id); if (id === this.peer || !this.isHost && id === this.invitation.host) this.disconnect(this.isHost ? "Opponent disconnected." : "Host disconnected."); },
        disconnected: () => this.disconnect("Connection to Playroom ended."),
        problem: message => { if (!this.closed && !this.ended) callbacks.problem(message); },
      });
      if (this.closed) { transport.close(); return; }
      this.transport = transport;
      const self = await transport.ready;
      if (this.closed) return;
      this.selfId = self.id;
      if (this.isHost && !self.isHost) throw new Error("Could not create a new room");
      if (!this.isHost && self.isHost) { this.disconnect("The host is no longer in this room."); return; }
      if (this.isHost) this.invitation = { ...this.invitation, host: self.id, room: self.room };
      callbacks.diagnostics?.("Connected to Playroom. Reliable message delivery is available.");
      this.hello();
    });
    void this.ready.catch(error => {
      if (this.closed || this.ended) return;
      clearTimeout(this.timer); clearInterval(this.helloTimer);
      callbacks.problem("Could not open the Playroom match. Cancel and create a fresh invitation.");
      console.warn("[network] Playroom setup failed:", error instanceof Error ? error.message : "Unknown error");
    });
  }

  async getInvitation(): Promise<Invitation> {
    await this.ready;
    if (this.closed || this.ended || !this.selfId) throw new Error("Connection closed");
    return { ...this.invitation };
  }

  private hello(): void {
    if (this.isHost || !this.selfId || this.started || this.closed || this.ended || !this.peers.has(this.invitation.host)) return;
    this.peer = this.invitation.host;
    this.transmit({ type: "hello" });
  }

  private async receive(wire: string, sender: string): Promise<void> {
    if (this.closed || this.ended || !this.selfId || sender === this.selfId || typeof wire !== "string") return;
    let packet;
    try { packet = await decryptPacket(await this.key, wire) as Record<string, unknown>; } catch { return; }
    if (!packet || packet.protocol !== NETWORK_PROTOCOL || packet.target !== this.selfId ||
      !Number.isSafeInteger(packet.sequence) || (packet.sequence as number) <= (this.received.get(sender) ?? 0)) return;
    this.received.set(sender, packet.sequence as number);
    if (this.isHost) {
      if (packet.type === "hello") {
        if (this.peer && this.peer !== sender) return;
        this.peer = sender;
        this.transmit({ type: "accepted" });
        if (!this.started) {
          this.start();
          this.server!.postMessage({ network: true });
        }
        return;
      }
      if (!this.started || sender !== this.peer) return;
      if (packet.type === "request" && isNetworkRequest(packet.request)) this.server!.postMessage({ remote: JSON.stringify(packet.request) });
      else if (packet.type === "timing" && packet.timing && typeof packet.timing === "object") this.server!.postMessage({ guestTiming: packet.timing });
      else if (packet.type === "leave") this.disconnect("Opponent left the match.");
    } else {
      if (sender !== this.invitation.host) return;
      if (packet.type === "leave") { this.disconnect("The host left the match."); return; }
      if (packet.type === "accepted" || packet.type === "state") {
        if (!this.started) {
          this.start();
          if (this.timing) this.postMessage(JSON.stringify({ timing: this.timing }));
        }
      }
      if (packet.type === "accepted") {
        // A snapshot also recovers the opening state after any delayed admission.
        this.transmit({ type: "request", request: { requestId: 0, revision: 0, command: { type: "snapshot" } } });
      }
      if (packet.type === "state" && typeof packet.response === "string") {
        let response: Response;
        try { response = JSON.parse(packet.response); } catch { return; }
        if (response.view?.seat === 1) this.onmessage?.(new MessageEvent("message", { data: packet.response }));
      }
    }
  }

  private start(): void {
    this.started = true;
    clearTimeout(this.timer); clearInterval(this.helloTimer);
    this.callbacks.connected();
  }

  private transmit(data: object): void {
    const target = this.peer;
    if (!target || this.closed || this.ended) return;
    const packet = { ...data, protocol: NETWORK_PROTOCOL, target, sequence: ++this.sequence };
    this.outgoing = this.outgoing.then(async () => {
      if (this.closed || this.ended) return;
      const wire = await encryptPacket(await this.key, packet);
      await this.transport?.send(wire);
    }).catch(() => this.disconnect("Connection lost."));
  }

  private disconnect(message: string): void {
    if (this.closed || this.ended) return;
    this.ended = true;
    clearTimeout(this.timer); clearInterval(this.helloTimer);
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
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer); clearInterval(this.helloTimer);
    this.transport?.close();
    this.server?.terminate();
  }
}
