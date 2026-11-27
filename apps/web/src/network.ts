import { isMatchToken, isNetworkRequest, NETWORK_PROTOCOL } from "@crazy-eights/protocol/network";
import type { Invitation } from "./network-protocol.ts";

export interface GameConnection {
  postMessage(data: string): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

interface Callbacks {
  connected(): void;
  waiting(message: string): void;
  disconnected(message: string): void;
}

export interface HostedMatch extends Invitation { credential: string }

const hostedMatchKey = "crazy-eights.hosted-match";
export function getHostedMatch(): HostedMatch | undefined {
  try {
    const match = JSON.parse(sessionStorage.getItem(hostedMatchKey) ?? "null");
    if (isMatchToken(match?.room) && isMatchToken(match.password) && isMatchToken(match.credential)) return match;
  } catch { /* A browser without storage can still reconnect while open. */ }
}

function storeHostedMatch(match?: HostedMatch): void {
  try {
    if (match) sessionStorage.setItem(hostedMatchKey, JSON.stringify(match));
    else sessionStorage.removeItem(hostedMatchKey);
  } catch { /* A browser without storage can still reconnect while open. */ }
}

const reconnectWindow = 120_000;
const connectionTimeout = 10_000;

export class NetworkConnection implements GameConnection {
  onmessage: GameConnection["onmessage"] = null;
  onerror: GameConnection["onerror"] = null;

  private socket?: WebSocket;
  private closed = false;
  private admitted = false;
  private started = false;
  private waitingForState = false;
  private retryDeadline = 0;
  private retries = 0;
  private timeout?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  private timing?: string;
  private resolveInvitation!: (invitation: Invitation) => void;
  private rejectInvitation!: (error: Error) => void;
  private invitationReady = new Promise<Invitation>((resolve, reject) => {
    this.resolveInvitation = resolve;
    this.rejectInvitation = reject;
  });

  constructor(
    private readonly invitation: Invitation,
    private readonly host: boolean,
    private readonly callbacks: Callbacks,
    hostCredential?: string,
    private readonly endpoint = import.meta.env.VITE_NETWORK_SERVER_URL as string | undefined,
  ) {
    void this.invitationReady.catch(() => {});
    const credential = hostCredential ?? this.seatCredential();
    queueMicrotask(() => this.connect(credential));
  }

  getInvitation(): Promise<Invitation> {
    return this.invitationReady;
  }

  private seatCredential(): string {
    const random = crypto.randomUUID();
    if (this.host) return random;
    // A guest reopening the invitation in this tab can reclaim its seat after a reload.
    const key = `crazy-eights.match.${this.invitation.room}`;
    try {
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
      sessionStorage.setItem(key, random);
    } catch { /* Storage may be disabled. Reconnect within this page still works. */ }
    return random;
  }

  private connect(credential: string): void {
    if (this.closed) return;
    if (!this.endpoint) {
      this.fail("Network play is not configured for this build.");
      return;
    }
    let socket: WebSocket;
    try {
      const url = new URL(`/rooms/${this.invitation.room}`, this.endpoint);
      const role = this.host ? "host" : "guest";
      socket = new WebSocket(url, [NETWORK_PROTOCOL, role, credential, this.invitation.password]);
    } catch {
      this.fail("The network server address is invalid.");
      return;
    }
    this.socket = socket;
    this.timeout = setTimeout(() => socket.close(), connectionTimeout);
    socket.onopen = () => {
      if (this.closed || this.socket !== socket) return;
      const timing = this.timing ? JSON.parse(this.timing).timing : undefined;
      socket.send(JSON.stringify({ type: "join", timing }));
    };
    socket.onmessage = ({ data }: MessageEvent<string>) => {
      if (this.closed || this.socket !== socket || typeof data !== "string") return;
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (message?.type === "ready") {
        clearTimeout(this.timeout);
        this.retryDeadline = this.retries = 0;
        this.admitted = true;
        if (this.host) storeHostedMatch({ ...this.invitation, credential });
        this.resolveInvitation(this.invitation);
      } else if (message?.type === "presence" && typeof message.opponent === "boolean") {
        this.waitingForState = message.opponent;
        if (!message.opponent && this.started) this.callbacks.waiting("Waiting for your opponent to reconnect…");
      } else if ((message?.type === "state" || message?.type === "error") && message.view) {
        if (this.waitingForState) {
          this.waitingForState = false;
          this.started = true;
          this.callbacks.connected();
        }
        this.onmessage?.(new MessageEvent("message", { data }));
      }
    };
    socket.onclose = event => {
      if (this.closed || this.socket !== socket) return;
      clearTimeout(this.timeout);
      if (event.code === 4001 || event.code === 4002) {
        if (this.host && event.code === 4001) storeHostedMatch();
        this.fail(event.reason || "This match is no longer available.");
      } else if (this.admitted) {
        this.retryDeadline ||= Date.now() + reconnectWindow;
        if (Date.now() >= this.retryDeadline) this.fail("Couldn’t reconnect to the match.");
        else {
          this.callbacks.waiting("Connection interrupted. Reconnecting…");
          this.retry = setTimeout(() => this.connect(credential), Math.min(500 * 2 ** this.retries++, 5_000));
        }
      } else {
        this.fail("Couldn’t reach the network server. Check your connection and try again.");
      }
    };
  }

  private fail(message: string): void {
    this.rejectInvitation(new Error(message));
    this.terminate();
    this.callbacks.disconnected(message);
  }

  postMessage(data: string): void {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message?.timing) this.timing = data;
    else if (!isNetworkRequest(message)) return;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data);
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    clearTimeout(this.retry);
    this.rejectInvitation(new Error("Connection closed."));
    this.socket?.close();
  }

  leaveMatch(): void {
    if (this.host) storeHostedMatch();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send('{"type":"leave"}');
    this.terminate();
  }
}
