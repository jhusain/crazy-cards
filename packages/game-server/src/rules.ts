import { SUITS, type Card, type Special } from "@crazy-eights/protocol";

export const DEFAULT_RULES = {
  startingCards: 8,
  pickupCards: 2,
  superPickupCards: 5,
} as const;

function specialFor(rank: number, suit: Card["suit"]): Special {
  if (rank === 1) return "reverse";
  if (rank === 2) return "pickup";
  if (rank === 8) return "wild";
  if (rank === 11) return "skip";
  if (rank === 12 && suit === "spades") return "super-pickup";
  return "normal";
}

export function standardDeck(): Card[] {
  return SUITS.flatMap((suit, index) => Array.from({ length: 13 }, (_, offset) => {
    const rank = offset + 1;
    return { id: index * 13 + offset, rank, suit, special: specialFor(rank, suit) };
  }));
}

export type RandomIndex = (limit: number) => number;

export function randomIndex(limit: number): number {
  const range = 2 ** 32;
  const ceiling = range - range % limit;
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0]! >= ceiling);
  return value[0]! % limit;
}

export function shuffled<T>(items: T[], random: RandomIndex): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const next = random(i + 1);
    [result[i], result[next]] = [result[next]!, result[i]!];
  }
  return result;
}
