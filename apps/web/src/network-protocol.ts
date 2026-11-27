import { isMatchToken, NETWORK_PROTOCOL } from "@crazy-eights/protocol/network";
export { isNetworkRequest } from "@crazy-eights/protocol/network";

export interface Invitation { room: string; password: string }
export function invitationFromHash(hash: string): Invitation | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const room = params.get("match"), password = params.get("key");
  if (params.get("network") !== NETWORK_PROTOCOL || !isMatchToken(room) || !isMatchToken(password)) return;
  return { room, password };
}
export function invitationUrl(base: string, invite: Invitation): string {
  const url = new URL(base);
  url.hash = new URLSearchParams({ network: NETWORK_PROTOCOL, match: invite.room, key: invite.password }).toString();
  return url.href;
}
