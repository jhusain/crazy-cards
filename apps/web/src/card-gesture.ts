import { PLAY_SLOTS, canFollowInQueue, type Card, type TableView } from "@crazy-eights/protocol";
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

export type FlickSettings = Pick<GameSettings, "groupExceptWild" | "groupExceptTwo">;

function excludedGroup(group: readonly Card[], settings: FlickSettings): boolean {
  return group.length > 1 && group.some(card =>
    card.special === "wild" && settings.groupExceptWild || card.rank === 2 && settings.groupExceptTwo);
}

// Shared by flick gestures and hand shading; excluded groups keep individual eligibility.
export function flickPlayableCards(hand: readonly Card[], legalLeads: readonly number[], settings: FlickSettings): Set<number> {
  const playable = new Set(legalLeads);
  for (const lead of hand.filter(card => playable.has(card.id))) {
    const group = hand.filter(card => card.rank === lead.rank);
    if (!excludedGroup(group, settings)) for (const card of group) playable.add(card.id);
  }
  return playable;
}

export function flickPlay(
  card: Card, hand: readonly Card[], legalLeads: readonly number[], settings: FlickSettings,
  random: () => number = Math.random,
): Card[] | undefined {
  const group = [card, ...hand.filter(other => other.id !== card.id && other.rank === card.rank)];
  if (excludedGroup(group, settings)) return;
  if (!legalLeads.includes(card.id) && !flickPlayableCards(hand, legalLeads, settings).has(card.id)) return;
  // Flicking the sole legal lead plays it alone; every other group flick pins the top card.
  if (legalLeads.includes(card.id) && !group.slice(1).some(other => legalLeads.includes(other.id))) return [card];

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

// Keep the order sampled at drag start, while rejecting a stale or no-longer-legal plan.
export function retainedFlickPlay(
  order: readonly number[], card: Card, hand: readonly Card[], legalLeads: readonly number[], settings: FlickSettings,
): Card[] | undefined {
  const eligible = flickPlay(card, hand, legalLeads, settings, () => 0);
  if (!eligible || order.length !== eligible.length || new Set(order).size !== order.length ||
      order.at(-1) !== card.id || !legalLeads.includes(order[0]!) ||
      !eligible.every(candidate => order.includes(candidate.id))) return;
  return order.map(id => hand.find(candidate => candidate.id === id)!);
}

// Start tracking after a small deliberate vertical movement; staged left swipes also track.
export function isCardDrag(dx: number, dy: number, staged: boolean): boolean {
  return Math.abs(dy) >= 6 || staged && dx <= -6;
}

export interface DropRect { x: number; y: number; width: number; height: number }
export type DropRegion = "discard" | "play";

// Union the visible card coverage, so overlapping cards never count the same area twice.
export function coveredArea(cards: readonly DropRect[], region: DropRect): number {
  const clipped = cards.map(card => ({
    left: Math.max(card.x, region.x), right: Math.min(card.x + card.width, region.x + region.width),
    top: Math.max(card.y, region.y), bottom: Math.min(card.y + card.height, region.y + region.height),
  })).filter(rect => rect.right > rect.left && rect.bottom > rect.top);
  const edges = [...new Set(clipped.flatMap(rect => [rect.left, rect.right]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1]!, right = edges[i]!;
    const intervals = clipped.filter(rect => rect.left < right && rect.right > left).sort((a, b) => a.top - b.top);
    let bottom = -Infinity, height = 0;
    for (const rect of intervals) {
      height += Math.max(0, rect.bottom - Math.max(bottom, rect.top));
      bottom = Math.max(bottom, rect.bottom);
    }
    area += (right - left) * height;
  }
  return area;
}

export function cardDropRegion(cards: readonly DropRect[], discard: DropRect, play: DropRect): DropRegion | undefined {
  const discarded = coveredArea(cards, discard), staged = coveredArea(cards, play);
  if (!discarded && !staged) return;
  return discarded >= staged ? "discard" : "play";
}

// A deck drop moves just the drawn card; it never pulls matching cards out of the hand.
export function eligibleDrawDrop(
  card: Card | undefined, view: TableView, staged: readonly Card[], destination: DropRegion | undefined,
): DropRegion | undefined {
  if (!card || !destination || view.turn !== view.seat || view.result || view.queuedCards.length ||
      !view.hand.some(held => held.id === card.id)) return;
  if (destination === "discard") return view.legalLeads.includes(card.id) ? destination : undefined;
  if (staged.length >= PLAY_SLOTS) return;
  const last = staged.at(-1);
  return (last ? canFollowInQueue(card, last) : view.legalLeads.includes(card.id)) ? destination : undefined;
}
