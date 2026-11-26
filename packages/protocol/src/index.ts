export const SUITS = ["hearts", "diamonds", "clubs", "spades"] as const;
export type Suit = typeof SUITS[number];
export type Seat = 0 | 1;
export type Special = "normal" | "reverse" | "skip" | "pickup" | "super-pickup" | "wild";

export interface Card {
  id: number;
  rank: number;
  suit: Suit;
  special: Special;
}

export interface PlayedCard extends Card {
  calledSuit?: Suit;
}

export type RoundEnd = { winner: Seat | "tie"; points: number };
export type MatchEnd = RoundEnd & { roundsWon: [number, number] };
export const MATCH_ROUNDS = 3;
export const PLAY_SLOTS = 12;
export type PlayMove = { type: "play"; cards: number[]; suit?: Suit };
export type Move = PlayMove | { type: "draw" } | { type: "pass" };
export type Command = Move | { type: "play-queue"; cards: number[]; suit?: Suit }
  | { type: "snapshot" } | { type: "next-round" } | { type: "restart" } | { type: "auto-play" } | { type: "debug-reshuffle" };

export interface Request {
  requestId: number;
  revision: number;
  command: Command;
}

export interface DeckReshuffle {
  drawIndex: number;
  stockCount: number;
  pointsBefore: number;
  pointsAfter: number;
}

export interface TurnEvent {
  seat: Seat;
  kind: "play" | "draw" | "pass" | "shuffle";
  cards?: PlayedCard[];
  burnsPreviousPlay?: boolean;
  /** Score of this actual play, calculated before cards and pickup penalties change hands. */
  aggressiveness?: number;
  drawCount?: number;
  drawnCards?: number[];
  skips?: boolean;
  reshuffles?: DeckReshuffle[];
  penalty?: { seat: Seat; count: number };
}

export interface TableView {
  revision: number;
  round: number;
  seat: Seat;
  turn: Seat | null;
  points: [number, number];
  pointsPerCard: number;
  roundsWon: [number, number];
  matchResult: MatchEnd | null;
  hand: Card[];
  opponentCount: number;
  stockCount: number;
  lastPlay: PlayedCard[];
  visibleDiscard: PlayedCard[];
  activeSuit: Suit;
  drewThisTurn: boolean;
  legalLeads: number[];
  queuedCards: number[];
  event: TurnEvent | null;
  result: RoundEnd | null;
}

export type Response =
  | { type: "state"; requestId?: number; view: TableView }
  | { type: "error"; requestId?: number; message: string; view: TableView };

export const otherSeat = (seat: Seat): Seat => seat === 0 ? 1 : 0;

export function activeSuit(card: PlayedCard): Suit {
  return card.calledSuit ?? card.suit;
}

export function canLead(card: Card, top: PlayedCard): boolean {
  return card.special === "wild" || card.rank === top.rank || card.suit === activeSuit(top);
}

export const skipsOpponent = (card: Card) => card.special === "skip" || card.special === "reverse";

export function canFollowInQueue(card: Card, previous: Card): boolean {
  return card.rank === previous.rank || (skipsOpponent(previous) && canLead(card, previous));
}

export function wildSuitOptions(current: Suit, count: number): readonly Suit[] {
  return count === 1 ? SUITS.filter(suit => suit !== current) : SUITS;
}
