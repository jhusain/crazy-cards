const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
const bytes = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value), char => char.charCodeAt(0));

/** Invitation secrets are random 128-bit values, not human passwords. */
export async function networkKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptPacket(key: CryptoKey, packet: object): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(packet)));
  return JSON.stringify({ iv: base64(iv), data: base64(new Uint8Array(data)) });
}
export async function decryptPacket(key: CryptoKey, wire: string): Promise<unknown> {
  if (wire.length > 150_000) throw new Error("Packet too large");
  const envelope = JSON.parse(wire);
  if (typeof envelope.iv !== "string" || typeof envelope.data !== "string") throw new Error("Invalid envelope");
  const iv = bytes(envelope.iv);
  if (iv.length !== 12) throw new Error("Invalid nonce");
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes(envelope.data));
  return JSON.parse(decoder.decode(data));
}
