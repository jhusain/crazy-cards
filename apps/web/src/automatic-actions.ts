import { skipsOpponent, type Card, type Command, type TableView } from "@crazy-eights/protocol";
import type { GameSettings } from "./settings.ts";

export type AutomaticAction = { type: "draw" | "pass" } | { type: "play"; cards: Card[] };

export function automaticPlay(view: TableView, settings: GameSettings): Card[] | undefined {
  if (!settings.autoSingle) return;
  const counts = new Map<number, number>();
  for (const card of view.hand) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  const ignoreExclusions = view.hand.length === 1 ||
    (settings.autoSingleIgnoreExclusionsWhenOpponentEmpty && view.opponentCount === 0);
  const topIsTwo = view.visibleDiscard.at(-1)?.rank === 2;
  const eligible = view.hand.filter(card => view.legalLeads.includes(card.id) && (ignoreExclusions || (
    !(settings.autoSingleExcludeWild && card.special === "wild") &&
    !(settings.autoSingleExcludeTwo && card.rank === 2 && !topIsTwo) &&
    !(settings.autoSingleExcludeQueen && card.special === "super-pickup"))));
  const singleton = (card: Card) => counts.get(card.rank) === 1;
  if (settings.autoSingleSkips) {
    // Every eligible card must be accounted for: grouped skips, rank-matched
    // skips of another suit, and ordinary groups all remain competing choices.
    const skips = eligible.filter(card => skipsOpponent(card) && singleton(card) && card.suit === view.activeSuit);
    const remaining = eligible.filter(card => !skips.includes(card));
    const card = remaining[0];
    if (skips.length && remaining.length === 1 && card && !skipsOpponent(card) &&
        singleton(card) && card.suit === view.activeSuit) return [...skips, card];
  }
  const card = eligible[0];
  // Exclusions affect play eligibility, never membership in a face group.
  if (eligible.length === 1 && card && singleton(card)) return [card];
}

// Remember actual opportunities, independently of the instant replay history.
export class AutomaticActions {
  private passedLeads?: Set<number>;
  private passRevision?: number;

  record(before: TableView | undefined, after: TableView, command?: Command): void {
    if (before?.revision === after.revision) return;
    this.passRevision = undefined;
    if (!before || before.round !== after.round || !after.event || after.event.kind === "shuffle") {
      this.passedLeads = undefined;
      return;
    }
    const event = after.event;
    if (event.penalty?.seat === after.seat && event.penalty.count > 0) this.passedLeads = undefined;
    if (event.seat !== after.seat) return;
    if (event.kind === "play") this.passedLeads = undefined;
    if (event.kind === "pass") this.passedLeads = before.drewThisTurn ? new Set(before.legalLeads) : undefined;
    if (event.kind === "draw" && command?.type === "draw" && after.drewThisTurn &&
        event.drawnCards?.length && event.drawnCards.every(id => !after.legalLeads.includes(id))) {
      this.passRevision = after.revision;
    }
  }

  next(view: TableView, settings: GameSettings): AutomaticAction | undefined {
    if (view.result || view.turn !== view.seat || view.queuedCards.length) return;
    const cards = automaticPlay(view, settings);
    if (cards) return { type: "play", cards };
    if (settings.autoPass && view.opponentCount > 0 && view.drewThisTurn && this.passRevision === view.revision) {
      return { type: "pass" };
    }
    if (settings.autoPickup && !view.drewThisTurn && this.passedLeads && view.legalLeads.length > 0 &&
        view.legalLeads.every(id => this.passedLeads!.has(id))) return { type: "draw" };
  }
}
