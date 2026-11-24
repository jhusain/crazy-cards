export const isDebug = (search: string): boolean => new URLSearchParams(search).get("debug") === "true";
