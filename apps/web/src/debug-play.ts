import type { TableView } from "@crazy-eights/protocol";

export function debugPlayMessage(previous: TableView | undefined, next: TableView, debug: boolean): string | undefined {
  if (!debug || previous?.revision === next.revision || next.event?.kind !== "play" ||
    next.event.aggressiveness === undefined) return;
  const player = next.event.seat === next.seat ? "Your play" : "Opponent’s play";
  return `${player}: aggressiveness ${next.event.aggressiveness}`;
}
