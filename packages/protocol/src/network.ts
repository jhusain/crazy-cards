import type { Request } from "./index.ts";

export const NETWORK_PROTOCOL = "crazy-eights-v3";

// Random UUIDs are used as unguessable room identifiers and independent credentials.
export const isMatchToken = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
const commands = new Set(["snapshot", "draw", "pass", "play", "play-queue", "next-round", "restart"]);

/** The room's GameServer validates cards, turns, revisions, and command payloads. */
export function isNetworkRequest(value: unknown): value is Request {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<Request>;
  return Number.isSafeInteger(request.requestId) && Number.isSafeInteger(request.revision) &&
    !!request.command && typeof request.command === "object" && commands.has(request.command.type);
}
