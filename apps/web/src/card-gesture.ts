import { canFollowInQueue, skipsOpponent, type Card } from "@crazy-eights/protocol";

export function isVerticalFlick(dx: number, dy: number, elapsed: number): boolean {
  return Math.abs(dy) >= 30 && Math.abs(dx) <= Math.abs(dy) * .65 && elapsed <= 500;
}

export function isUpwardFlick(dx: number, dy: number, elapsed: number): boolean {
  return dy < 0 && isVerticalFlick(dx, dy, elapsed);
}

export function shouldPlayFlick(card: Card, hand: readonly Card[], legalLeads: readonly number[], alwaysPlayWild = false): boolean {
  if (!legalLeads.includes(card.id)) return false;
  if (card.special === "wild" && alwaysPlayWild) return true;
  return !hand.some(other => other.id !== card.id &&
    (skipsOpponent(card) ? canFollowInQueue(other, card) : other.rank === card.rank));
}
