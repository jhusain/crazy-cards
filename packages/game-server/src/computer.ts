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
  const ordered = sortHand(hand);
  const rankCounts = new Map<number, number>();
  for (const card of ordered) rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);

  // A complete ordinary rank can precede a lone wild; multiple wilds stay first.
  if (ordered.filter(card => card.special === "wild").length === 1) {
    const quads = ordered.filter(card => rankCounts.get(card.rank) === 4 &&
      ordered.filter(member => member.rank === card.rank).every(member => member.special === "normal"));
    ordered.splice(0, ordered.length, ...quads, ...ordered.filter(card => !quads.includes(card)));
  }
  const singleSkips = new Set(ordered.filter(card => rankCounts.get(card.rank) === 1 && skipsOpponent(card)));
  for (const skip of [...singleSkips].reverse()) {
    if (!singleSkips.has(skip)) continue;
    // Prefer joining the tail of the other skip rank before ordinary hugging.
    const skipGroup = ordered.findLast(card => skipsOpponent(card) && card.rank !== skip.rank &&
      card.suit === skip.suit && rankCounts.get(card.rank)! > 1);
    if (skipGroup) {
      ordered.splice(ordered.indexOf(skipGroup), 1);
      ordered.splice(ordered.findLastIndex(card => card.rank === skipGroup.rank) + 1, 0, skipGroup);
      ordered.splice(ordered.indexOf(skip), 1);
      ordered.splice(ordered.indexOf(skipGroup) + 1, 0, skip);
      singleSkips.delete(skip);
      continue;
    }
    const matchesSuit = (card: Card) => card.suit === skip.suit && card.special !== "wild" && !skipsOpponent(card);
    const adjacentSkip = (card: Card | undefined) => !!card && card.suit === skip.suit && singleSkips.has(card);
    let first = ordered.indexOf(skip);
    let end = first + 1;
    while (adjacentSkip(ordered[first - 1])) first--;
    while (adjacentSkip(ordered[end])) end++;
    for (const card of ordered.slice(first, end)) singleSkips.delete(card);

    let target = -1;
    for (let size = 1; size <= 4 && target < 0; size++) {
      target = ordered.findLastIndex(card => matchesSuit(card) && rankCounts.get(card.rank) === size);
    }
    if (target < 0) continue;

    while (target + 1 < ordered.length && matchesSuit(ordered[target + 1]!)) target++;

    const anchor = ordered[target]!;
    while (ordered[target - 1]?.rank === anchor.rank) {
      ordered[target] = ordered[target - 1]!;
      ordered[target - 1] = anchor;
      target--;
    }

    const run = ordered.splice(first, end - first);
    ordered.splice(ordered.indexOf(anchor), 0, ...run);
  }
  return ordered;
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
