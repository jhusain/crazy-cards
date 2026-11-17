import { SUITS, activeSuit, canLead, skipsOpponent, type Card, type Move, type PlayedCard, type Special, type Suit } from "@crazy-eights/protocol";

const specialOrder: Special[] = ["normal", "reverse", "skip", "pickup", "super-pickup", "wild"];
const specialValue = (card: Card) => specialOrder.indexOf(card.special);
const suitValue = (card: Card) => SUITS.indexOf(card.suit);

export function sortHand(hand: Card[]): Card[] {
  const result: Card[] = [];
  for (const special of specialOrder.slice().reverse()) {
    const ranks = new Set(hand.filter(card => card.special === special).map(card => card.rank));
    const group = hand.filter(card => ranks.has(card.rank));
    const sizes = new Map<number, number>();
    for (const card of group) sizes.set(card.rank, (sizes.get(card.rank) ?? 0) + 1);
    group.sort((a, b) => {
      const sizeDifference = sizes.get(b.rank)! - sizes.get(a.rank)!;
      if (sizeDifference) return sizeDifference;
      if (special === "normal" && sizes.get(a.rank) === 1) {
        return suitValue(b) - suitValue(a) || b.rank - a.rank;
      }
      return b.rank - a.rank || specialValue(b) - specialValue(a) || suitValue(b) - suitValue(a);
    });
    for (const card of group) if (!result.includes(card)) result.push(card);
  }
  return result;
}

export function sortPlayerHand(hand: Card[]): Card[] {
  const groups = new Map<number, Card[]>();
  for (const card of sortHand(hand)) {
    const group = groups.get(card.rank);
    if (group) group.push(card);
    else groups.set(card.rank, [card]);
  }

  const ordered = [...groups.values()];
  const singleSkips = ordered.filter(group => group.length === 1 && skipsOpponent(group[0]!));
  for (const single of singleSkips) {
    const suit = single[0]!.suit;
    let target: Card[] | undefined;
    for (let size = 1; size <= 4 && !target; size++) {
      target = ordered.find(group => group.length === size &&
        !group.some(skipsOpponent) && group.some(card => card.suit === suit));
    }
    if (!target) continue;
    const index = target.findIndex(card => card.suit === suit);
    target.unshift(...target.splice(index, 1));
    ordered.splice(ordered.indexOf(single), 1);
    ordered.splice(ordered.indexOf(target), 0, single);
  }
  return ordered.flat();
}

function preferredSuit(hand: Card[], excluded: Suit): Suit {
  const remaining = SUITS.filter(suit => suit !== excluded);
  const counts = remaining.map(suit => hand.filter(card => card.suit === suit && card.special !== "wild").length);
  return remaining[counts.indexOf(Math.max(...counts))]!;
}

export function computerMove(
  hand: Card[],
  opponentCount: number,
  top: PlayedCard,
  drewThisTurn: boolean,
): { hand: Card[]; move: Move } {
  let ordered = sortHand(hand);
  const suit = activeSuit(top);
  if (opponentCount <= 4) {
    const eights = ordered.filter(card => card.special === "wild");
    ordered = [...ordered.filter(card => card.special !== "wild"), ...eights].reverse();
  }

  const singleton = (card: Card) => ordered.filter(other => other.rank === card.rank).length === 1;
  const matchingSkips = ordered.filter(card => card.special === "skip" && card.suit === suit && singleton(card));
  const matchingReverses = ordered.filter(card => card.special === "reverse" && card.suit === suit && singleton(card));
  const promoted = [...matchingSkips, ...matchingReverses];
  ordered = [...ordered.filter(card => !promoted.includes(card)), ...promoted];

  let candidates = ordered.filter(card => canLead(card, top) && !(card.special === "wild" && card.suit === suit));
  if (top.special === "pickup" && candidates.some(card => card.special === "pickup")) {
    candidates = candidates.filter(card => card.special === "pickup");
  }
  const selected = candidates.at(-1);
  if (!selected) return { hand: ordered, move: { type: drewThisTurn ? "pass" : "draw" } };

  const single = opponentCount > 0 && ["wild", "pickup", "super-pickup"].includes(selected.special);
  let play = single ? [selected] : ordered.filter(card => card.rank === selected.rank);
  if (!single && selected.rank === top.rank) {
    play = play.slice().reverse().sort((a, b) => specialValue(a) - specialValue(b));
  } else {
    const index = play.indexOf(selected);
    [play[0], play[index]] = [play[index]!, play[0]!];
  }
  return {
    hand: ordered,
    move: { type: "play", cards: play.map(card => card.id), ...(selected.special === "wild"
      ? { suit: preferredSuit(ordered, suit) }
      : {}) },
  };
}
