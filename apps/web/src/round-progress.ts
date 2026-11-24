import { MATCH_ROUNDS, type TableView } from "@crazy-eights/protocol";

export function roundProgress(view: Pick<TableView, "round" | "roundsWon" | "result" | "points">) {
  const wins = view.roundsWon[0] + view.roundsWon[1];
  const extra = view.result && wins >= MATCH_ROUNDS && view.points[0] === view.points[1] ? 1 : 0;
  return { current: view.round, total: view.round + Math.max(0, extra, MATCH_ROUNDS - wins - (view.result ? 0 : 1)) };
}
