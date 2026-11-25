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

export type FlickSettings = Pick<GameSettings, "groupExceptWild" | "groupExceptTwo" | "flickNonEligibleGroup">;

function excludedGroup(group: readonly Card[], settings: FlickSettings): boolean {
  return group.length > 1 && group.some(card =>
    card.special === "wild" && settings.groupExceptWild || card.rank === 2 && settings.groupExceptTwo);
}

// Shared by flick gestures and hand shading; excluded groups keep individual eligibility.
export function flickPlayableCards(hand: readonly Card[], legalLeads: readonly number[], settings: FlickSettings): Set<number> {
  const playable = new Set(legalLeads);
  if (!settings.flickNonEligibleGroup) return playable;
  for (const lead of hand.filter(card => playable.has(card.id))) {
    const group = hand.filter(card => card.rank === lead.rank);
    if (!excludedGroup(group, settings)) for (const card of group) playable.add(card.id);
  }
  return playable;
}

export function flickPinsTopCard(card: Card, hand: readonly Card[], legalLeads: readonly number[], settings: FlickSettings): boolean {
  const group = hand.filter(other => other.rank === card.rank);
  return settings.flickNonEligibleGroup && group.length > 1 && !excludedGroup(group, settings) &&
    group.some(other => legalLeads.includes(other.id)) &&
    (!legalLeads.includes(card.id) || group.every(other => legalLeads.includes(other.id)));
}

export function flickPlay(
  card: Card, hand: readonly Card[], legalLeads: readonly number[], settings: FlickSettings,
  random: () => number = Math.random,
): Card[] | undefined {
  const group = [card, ...hand.filter(other => other.id !== card.id && other.rank === card.rank)];
  if (excludedGroup(group, settings)) return;
  if (!legalLeads.includes(card.id) && !flickPlayableCards(hand, legalLeads, settings).has(card.id)) return;
  if (!flickPinsTopCard(card, hand, legalLeads, settings)) return group;

  const others = group.slice(1);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [others[i], others[j]] = [others[j]!, others[i]!];
  }
  // A suit-matched lead must land first; the touched card always lands last.
  const lead = others.findIndex(other => legalLeads.includes(other.id));
  others.unshift(...others.splice(lead, 1));
  return [...others, card];
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
