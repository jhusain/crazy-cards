import type { Request } from "@crazy-eights/protocol";

export const NETWORK_PROTOCOL = "crazy-eights-1";
const commands = new Set(["snapshot", "draw", "pass", "play", "play-queue", "next-round", "restart"]);

/** The host's GameServer validates cards, turns, revisions, and command payloads. */
export function isNetworkRequest(value: unknown): value is Request {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<Request>;
  return Number.isSafeInteger(request.requestId) && Number.isSafeInteger(request.revision) &&
    !!request.command && typeof request.command === "object" && commands.has(request.command.type);
}

export interface Invitation { room: string; password: string; host: string }
export function invitationFromHash(hash: string): Invitation | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const room = params.get("match"), password = params.get("key"), host = params.get("host");
  if (!room || !password || !host || room.length > 100 || password.length > 100 || host.length > 200) return;
  return { room, password, host };
}
export function invitationUrl(base: string, invite: Invitation): string {
  const url = new URL(base);
  url.hash = new URLSearchParams({ match: invite.room, key: invite.password, host: invite.host }).toString();
  return url.href;
}
