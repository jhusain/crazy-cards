import { type Card, type Suit } from "@crazy-eights/protocol";
import type { GameSettings } from "./settings.ts";

export function isVerticalFlick(dx: number, dy: number, elapsed: number): boolean {
  return Math.abs(dy) >= 30 && Math.abs(dx) <= Math.abs(dy) * .65 && elapsed <= 500;
}

export function isUpwardFlick(dx: number, dy: number, elapsed: number): boolean {
  return dy < 0 && isVerticalFlick(dx, dy, elapsed);
}

export function queuedCardFlick(dx: number, dy: number, elapsed: number): "play" | "clear" | undefined {
  const left = dx <= -30 && Math.abs(dy) <= Math.abs(dx) * .65 && elapsed <= 500;
  if (left || isUpwardFlick(dx, dy, elapsed)) return "play";
  if (dy > 0 && isVerticalFlick(dx, dy, elapsed)) return "clear";
}

export function flickPlay(
  card: Card, hand: readonly Card[], legalLeads: readonly number[], settings: GameSettings,
): Card[] | undefined {
  if (!legalLeads.includes(card.id)) return;
  const group = [card, ...hand.filter(other => other.id !== card.id && other.rank === card.rank)];
  if (group.length > 1 && (card.special === "wild" && settings.groupExceptWild || card.rank === 2 && settings.groupExceptTwo)) return;
  return group;
}

export function orderFlickGroup(cards: readonly Card[], lastSuit: Suit): Card[] {
  const ordered = cards.slice();
  const last = ordered.findIndex((card, index) => index > 0 && card.suit === lastSuit);
  if (last >= 0) ordered.push(...ordered.splice(last, 1));
  return ordered;
}


// A whole-hand group of at least three skips cannot leave the opponent a turn.
export function guaranteedSkipFinish(play: readonly Card[], hand: readonly Card[]): boolean {
  return play.length >= 3 && play.length === hand.length &&
    play.every(card => card.rank === 1 || card.rank === 11) &&
    hand.every(card => play.some(member => member.id === card.id));
}
