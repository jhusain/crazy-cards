import type { Card } from "@crazy-eights/protocol";

export type HandSortingStrategy = "default" | "wizard";

// Ordinary cards ascend from three through king. Keep the action cards
// together at the right: aces, twos, queen of spades, jacks, then eights.
function wizardValue(card: Card): number {
  if (card.rank === 8) return 18;
  if (card.rank === 11) return 17;
  if (card.rank === 12 && card.suit === "spades") return 16;
  if (card.rank === 2) return 15;
  if (card.rank === 1) return 14;
  return card.rank;
}

/** Presentation only: never change the authoritative hand or play order. */
export function sortVisibleHand(cards: readonly Card[], strategy: HandSortingStrategy): Card[] {
  // Stable sorting preserves the existing order among equal ranks. The
  // examples do not establish a consistent suit tie-breaker.
  return strategy === "wizard"
    ? [...cards].sort((a, b) => wizardValue(a) - wizardValue(b))
    : [...cards];
}
