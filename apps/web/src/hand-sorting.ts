import type { Card } from "@crazy-eights/protocol";

export type HandSortingStrategy = "default" | "wizard" | "anupa";

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

function anupaValue(card: Card): number {
  if (card.rank === 8) return 0;
  if (card.rank === 12 && card.suit === "spades") return 1;
  if (card.rank === 2) return 2;
  // Aces and jacks share the same skip-card priority.
  if (card.rank === 1 || card.rank === 11) return 3;
  return 4;
}

const anupaSuits: Record<Card["suit"], number> = { spades: 0, clubs: 1, hearts: 2, diamonds: 3 };

/** Presentation only: never change the authoritative hand or play order. */
export function sortVisibleHand(cards: readonly Card[], strategy: HandSortingStrategy): Card[] {
  if (strategy === "anupa") return [...cards].sort((a, b) => {
    const priority = anupaValue(a) - anupaValue(b);
    if (priority) return priority;
    // Equal-priority action cards retain their existing order. Ordinary cards
    // are sorted by suit, then descending rank, without collecting rank groups.
    return anupaValue(a) < 4 ? 0 : anupaSuits[a.suit] - anupaSuits[b.suit] || b.rank - a.rank;
  });
  // Stable sorting preserves the existing order among equal ranks. The
  // examples do not establish a consistent suit tie-breaker.
  return strategy === "wizard"
    ? [...cards].sort((a, b) => wizardValue(a) - wizardValue(b))
    : [...cards];
}
