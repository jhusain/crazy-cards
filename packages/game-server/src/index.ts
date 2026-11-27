import {
  MATCH_ROUNDS, PLAY_SLOTS, SUITS, activeSuit, canFollowInQueue, canLead, otherSeat, skipsOpponent, wildSuitOptions,
  type Card, type DeckReshuffle, type Command, type Move, type PlayMove, type PlayedCard,
  type Request, type Response, type RoundEnd, type MatchEnd, type Seat, type TableView, type TurnEvent,
} from "@crazy-eights/protocol";
import { computerMove, sortPlayerHand } from "./computer.ts";
import { DEFAULT_RULES, randomIndex, shuffled, standardDeck, type RandomIndex } from "./rules.ts";

function isRequest(value: unknown): value is Request {
  if (typeof value !== "object" || value === null) return false;
  const { requestId, revision, command } = value as Partial<Request>;
  if (!Number.isSafeInteger(requestId) || !Number.isSafeInteger(revision) || !command || typeof command !== "object") return false;
  switch (command.type) {
    case "snapshot": case "draw": case "pass": case "next-round": case "restart": case "auto-play": case "debug-reshuffle":
      return true;
    case "debug-aggressiveness":
      return command.opponentCards === undefined || command.opponentCards === 1 || command.opponentCards === 8;
    case "play":
    case "play-queue":
      return Array.isArray(command.cards) && command.cards.length >= 1 &&
        command.cards.length <= (command.type === "play" ? 4 : PLAY_SLOTS) &&
        command.cards.every(card => Number.isInteger(card) && card >= 0 && card < 52) &&
        (command.suit === undefined || SUITS.includes(command.suit));
    default:
      return false;
  }
}

export class GameServer {
  private hands: [Card[], Card[]] = [[], []];
  private stock: Card[] = [];
  private discard: Card[] = [];
  private lastPlay: PlayedCard[] = [];
  private lastPlaySize = 1;
  private lastPlaySeat: Seat | null = null;
  private points: [number, number] = [0, 0];
  private roundsWon: [number, number] = [0, 0];
  private roundStartingPpc = 1;
  private pointsPerCard = 1;
  private matchResult: MatchEnd | null = null;
  private revision = 0;
  private round = 0;
  private turn: Seat = 0;
  private first: Seat = 0;
  private nextFirst: Seat | null = null;
  private drewThisTurn = false;
  private passesWithoutProgress = 0;
  private event: TurnEvent | null = null;
  private result: RoundEnd | null = null;
  private queued: { seat: Seat; moves: PlayMove[] } | null = null;

  private readonly cpuSeat: Seat | null;
  private readonly random: RandomIndex;
  private autoplay: boolean;
  private debug = false;
  private readonly automaticForcedTurns: boolean;

  constructor(cpuSeat: Seat | null = 1, random: RandomIndex = randomIndex, autoplay = false, automaticForcedTurns = cpuSeat !== null) {
    this.cpuSeat = cpuSeat;
    this.automaticForcedTurns = automaticForcedTurns;
    this.random = random;
    this.autoplay = autoplay;
    this.deal();
  }

  setAutoplay(enabled: boolean): void {
    this.autoplay = enabled;
  }

  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  private get top(): PlayedCard {
    return this.lastPlay.at(-1)!;
  }

  get cpuIsUp(): boolean {
    return !this.result && (this.autoplay || this.turn === this.cpuSeat);
  }

  get automaticMove(): "queued" | "computer" | "draw" | "pass" | null {
    if (this.result) return null;
    if (this.queued) return "queued";
    if (this.cpuIsUp) return "computer";
    if (!this.automaticForcedTurns || this.hands[this.turn].some(card => canLead(card, this.top))) return null;
    return this.drewThisTurn ? "pass" : "draw";
  }

  stepAutomatic(): boolean {
    const next = this.automaticMove;
    if (!next) return false;
    if (next === "computer") return this.stepComputer();
    if (next === "queued") {
      const { seat, moves } = this.queued!;
      this.move(seat, moves.shift()!);
      if (!moves.length || this.result || this.turn !== seat) this.queued = null;
    } else {
      this.move(this.turn, { type: next });
    }
    return true;
  }

  view(seat: Seat): TableView {
    const drawSeat = this.event?.kind === "draw" ? this.event.seat : this.event?.penalty?.seat;
    const event = this.event && drawSeat !== seat && this.event.drawnCards
      ? { ...this.event, drawnCards: undefined } : this.event;
    const queuedCards = this.queued?.seat === seat ? this.queued.moves.flatMap(move => move.cards) : [];
    const queuedIds = new Set(queuedCards);
    const hand = this.hands[seat];
    return {
      revision: this.revision, round: this.round, seat, turn: this.result ? null : this.turn,
      points: [...this.points], pointsPerCard: this.pointsPerCard,
      roundsWon: [...this.roundsWon], matchResult: this.matchResult && { ...this.matchResult, roundsWon: [...this.roundsWon] },
      hand: [...sortPlayerHand(hand.filter(card => !queuedIds.has(card.id))), ...hand.filter(card => queuedIds.has(card.id))],
      opponentCount: this.hands[otherSeat(seat)].length,
      stockCount: this.stock.length, lastPlay: this.lastPlay.slice(),
      visibleDiscard: this.lastPlay.slice(-this.lastPlaySize), activeSuit: activeSuit(this.top),
      drewThisTurn: this.drewThisTurn, event, result: this.result,
      queuedCards,
      legalLeads: this.turn === seat && !this.result
        ? this.hands[seat].filter(card => canLead(card, this.top)).map(card => card.id)
        : [],
    };
  }

  handleJSON(seat: Seat, input: string): string {
    let parsed: unknown;
    let requestId: number | undefined;
    try {
      parsed = JSON.parse(input);
      if (!isRequest(parsed)) throw new Error("Invalid game request.");
      requestId = parsed.requestId;
      if (parsed.command.type !== "snapshot") {
        if (seat === this.cpuSeat || this.autoplay && parsed.command.type !== "restart" && parsed.command.type !== "next-round" && parsed.command.type !== "debug-reshuffle" && parsed.command.type !== "debug-aggressiveness") {
          throw new Error("That seat is controlled by the computer.");
        }
        if (parsed.revision !== this.revision) throw new Error("The table has already changed. Try again.");
        this.handleCommand(seat, parsed.command);
      }
      return this.stateJSON(seat, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to apply that move.";
      const response: Response = { type: "error", requestId, message, view: this.view(seat) };
      return JSON.stringify(response);
    }
  }

  stateJSON(seat: Seat, requestId?: number): string {
    const response: Response = { type: "state", requestId, view: this.view(seat) };
    return JSON.stringify(response);
  }

  stepComputer(): boolean {
    if (!this.cpuIsUp) return false;
    const seat = this.turn;
    const { hand, move } = computerMove(this.hands[seat], this.hands[otherSeat(seat)].length, this.top, this.drewThisTurn);
    this.hands[seat] = hand;
    this.move(seat, move);
    return true;
  }

  private deal(): void {
    this.roundStartingPpc = this.result?.winner === "tie" ? this.roundStartingPpc * 2 : 1;
    this.pointsPerCard = this.roundStartingPpc;
    const cards = shuffled(standardDeck(), this.random);
    const opening = cards.pop()!;
    const removed = this.random(DEFAULT_RULES.maxRemovedCards + 1);
    cards.splice(cards.length - removed, removed);
    this.hands = [cards.splice(-DEFAULT_RULES.startingCards).reverse(), cards.splice(-DEFAULT_RULES.startingCards).reverse()];
    this.stock = cards;
    this.discard = [];
    this.lastPlay = [opening];
    this.lastPlaySize = 1;
    this.lastPlaySeat = null;
    this.first = this.nextFirst ?? (this.random(2) as Seat);
    this.turn = this.first;
    this.drewThisTurn = false;
    this.passesWithoutProgress = 0;
    this.event = null;
    this.result = null;
    this.queued = null;
    this.round++;
    this.revision++;
  }

  private handleCommand(seat: Seat, command: Exclude<Command, { type: "snapshot" }>): void {
    if (command.type === "restart") {
      const previousWinner = this.matchResult && this.result?.winner !== "tie" ? this.result?.winner : null;
      this.points = [0, 0];
      this.roundsWon = [0, 0];
      this.matchResult = null;
      this.result = null;
      this.nextFirst = previousWinner ?? null;
      this.round = 0;
      this.deal();
    } else if (command.type === "next-round") {
      if (!this.result) throw new Error("Finish this round first.");
      if (this.matchResult) throw new Error("This match is over. Start a new match.");
      this.deal();
    } else if (command.type === "debug-aggressiveness") {
      if (!this.debug) throw new Error("Enable debug mode to test aggressiveness.");
      this.testAggressiveness(seat, command.opponentCards ?? 1);
    } else if (this.queued) {
      throw new Error("Wait for the queued plays to finish.");
    } else if (command.type === "debug-reshuffle") {
      if (!this.debug) throw new Error("Enable debug mode to reshuffle the deck.");
      if (this.result) throw new Error("Start a new round first.");
      if (!this.discard.length) throw new Error("There are no earlier discards to reshuffle yet.");
      // Debug mode treats the remaining stock as exhausted: only earlier discards refill it.
      const reshuffle = this.recycleDiscard(0);
      this.event = { seat, kind: "shuffle", reshuffles: [reshuffle] };
      this.revision++;
    } else if (command.type === "auto-play") {
      if (this.result || this.turn !== seat) throw new Error("It’s not your turn.");
      const decision = computerMove(this.hands[seat], this.hands[otherSeat(seat)].length, this.top, this.drewThisTurn);
      this.hands[seat] = decision.hand;
      this.move(seat, decision.move);
    } else if (command.type === "play-queue") {
      this.playQueue(seat, command.cards, command.suit);
    } else {
      this.move(seat, command);
    }
  }

  private testAggressiveness(seat: Seat, opponentCards: 1 | 8): void {
    const deck = standardDeck();
    const hand = deck.filter(card => card.rank === 11 || card.rank === 1 || card.rank === 2);
    const lastCard = deck.find(card => card.rank === 3 && card.suit === "clubs")!;
    const top = deck.find(card => card.rank === 3 && card.suit === "hearts")!;
    const used = new Set([...hand, lastCard, top].map(card => card.id));
    // Keep 3♣ the only legal opening move so both tests begin with the same suit change.
    const opponent = [lastCard, ...deck.filter(card => !used.has(card.id) && !canLead(card, top)).slice(0, opponentCards - 1)];
    opponent.forEach(card => used.add(card.id));
    this.hands = seat === 0 ? [hand, opponent] : [opponent, hand];
    this.stock = deck.filter(card => !used.has(card.id));
    this.discard = [];
    this.lastPlay = [top];
    this.lastPlaySize = 1;
    this.lastPlaySeat = null;
    this.points = [0, 0];
    this.roundsWon = [0, 0];
    this.roundStartingPpc = this.pointsPerCard = 1;
    this.matchResult = this.result = null;
    this.round = 1;
    this.turn = this.first = otherSeat(seat);
    this.nextFirst = null;
    this.drewThisTurn = false;
    this.passesWithoutProgress = 0;
    this.event = this.queued = null;
    this.autoplay = false;
    this.revision++;
  }

  private playQueue(seat: Seat, ids: number[], suit?: Card["suit"]): void {
    if (this.result || this.turn !== seat) throw new Error("It’s not your turn.");
    if (new Set(ids).size !== ids.length) throw new Error("Queue each card only once.");

    const moves: PlayMove[] = [];
    let previous: Card | undefined;
    let suitBeforeWild = activeSuit(this.top);
    for (const id of ids) {
      const card = this.hands[seat].find(candidate => candidate.id === id);
      if (!card) throw new Error("Choose cards from your hand.");
      if (!previous && !canLead(card, this.top)) throw new Error("Match the top card’s rank or active suit.");
      if (previous && !canFollowInQueue(card, previous)) {
        throw new Error("Start a new play after an ace or jack, and match its suit.");
      }
      if (card.rank !== previous?.rank) {
        const move: PlayMove = { type: "play", cards: [] };
        if (card.special === "wild") {
          suitBeforeWild = activeSuit(previous ?? this.top);
          move.suit = suit;
        }
        moves.push(move);
      }
      moves.at(-1)!.cards.push(id);
      previous = card;
    }
    const lastMove = moves.at(-1)!;
    if (previous?.special === "wild") {
      this.checkWildSuit(suit, suitBeforeWild, lastMove.cards.length);
    } else if (suit) {
      throw new Error("Only eights can declare a suit.");
    }

    this.move(seat, moves.shift()!);
    if (moves.length && !this.result && this.turn === seat) this.queued = { seat, moves };
  }

  private recycleDiscard(drawIndex: number): DeckReshuffle {
    const reshuffle = { drawIndex, stockCount: this.discard.length,
      pointsBefore: this.pointsPerCard, pointsAfter: this.pointsPerCard * 2 };
    this.pointsPerCard = reshuffle.pointsAfter;
    this.stock = shuffled(this.discard, this.random);
    this.discard = [];
    return reshuffle;
  }

  private drawCards(seat: Seat, count: number): { drawnCards: number[]; reshuffles: DeckReshuffle[] } {
    const drawn: number[] = [];
    const reshuffles: DeckReshuffle[] = [];
    while (drawn.length < count) {
      if (this.stock.length === 0 && this.discard.length > 0) {
        reshuffles.push(this.recycleDiscard(drawn.length));
      }
      const card = this.stock.pop();
      if (!card) break;
      this.hands[seat].push(card);
      drawn.push(card.id);
    }
    return { drawnCards: drawn, reshuffles };
  }

  private move(seat: Seat, move: Move): void {
    if (this.result || this.turn !== seat) throw new Error("It’s not your turn.");
    if (move.type === "play") {
      this.play(seat, move.cards, move.suit);
    } else if (move.type === "draw") {
      if (this.drewThisTurn) throw new Error("You’ve already drawn this turn. Play or pass.");
      const { drawnCards, reshuffles } = this.drawCards(seat, 1);
      this.drewThisTurn = true;
      if (drawnCards.length) this.passesWithoutProgress = 0;
      this.event = { seat, kind: "draw", drawCount: drawnCards.length, drawnCards, ...(reshuffles.length ? { reshuffles } : {}) };
    } else {
      if (!this.drewThisTurn) throw new Error("Draw a card before passing.");
      this.passesWithoutProgress++;
      this.event = { seat, kind: "pass" };
      this.advance(otherSeat(seat));
      if (!this.result && this.passesWithoutProgress >= 2 && this.stock.length === 0 && this.discard.length === 0 &&
        this.hands.every(hand => hand.every(card => !canLead(card, this.top)))) {
        this.finish("tie", 0, this.first);
      }
    }
    this.revision++;
  }

  private play(seat: Seat, ids: number[], suit?: Card["suit"]): void {
    const hand = this.hands[seat];
    const cards = ids.map(id => hand.find(card => card.id === id));
    const lead = cards[0];
    if (!lead || cards.some(card => !card) || new Set(ids).size !== ids.length) throw new Error("Choose cards from your hand.");
    if (!canLead(lead, this.top)) throw new Error("Match the top card’s rank or active suit.");
    if (cards.some(card => card!.rank !== lead.rank)) throw new Error("All cards in a combo must have the same rank.");
    if (lead.special === "wild") this.checkWildSuit(suit, activeSuit(this.top), cards.length);
    if (lead.special !== "wild" && suit !== undefined) throw new Error("Only eights can declare a suit.");

    const played: PlayedCard[] = cards.map((card, index) =>
      suit && index === cards.length - 1 ? { ...card!, calledSuit: suit } : card!);
    const opponent = otherSeat(seat);
    const containsSkip = played.some(skipsOpponent);
    const twos = played.filter(card => card.rank === 2).length;
    const queenOnTop = played.at(-1)!.rank === 12 && played.at(-1)!.suit === "spades";
    let precedingTwos = 0;
    if (twos) {
      // Count the actual trailing discard cards, including earlier plays hidden by the UI.
      const pile = [...this.discard, ...this.lastPlay];
      for (let index = pile.length - 1; index >= 0 && pile[index]!.rank === 2; index--) precedingTwos++;
    }
    const aggressiveness = (queenOnTop ? 4 : 0) + twos + precedingTwos +
      (ids.length === hand.length ? 1 : 0) + (played.length === 4 && !containsSkip ? 1 : 0) +
      ((twos > 0 || queenOnTop) && this.hands[opponent].length === 0 ? 1 : 0);
    // Jacks and aces add no intrinsic aggression or carryover, even as quadruples.
    const burnsPreviousPlay = this.lastPlaySeat === opponent && this.hands[opponent].length > 0 &&
      played.some(card => card.special === "wild") &&
      this.lastPlay.slice(-this.lastPlaySize).some(card => card.special === "wild");
    this.hands[seat] = hand.filter(card => !ids.includes(card.id));
    this.lastPlaySize = played.length;
    this.lastPlaySeat = seat;
    this.passesWithoutProgress = 0;
    if (lead.special === "pickup" && this.top.special === "pickup") {
      this.lastPlay = [...this.lastPlay, ...played];
    } else {
      // Recycling uses printed identities so a called suit can never duplicate or lose an eight.
      this.discard.push(...this.lastPlay.map(({ calledSuit: _calledSuit, ...card }) => card));
      this.lastPlay = played;
    }

    let effects: PlayedCard[] = [];
    for (const card of this.lastPlay) {
      if (card.special === "normal") effects = [];
      else effects.push(card);
    }
    const skips = effects.some(skipsOpponent);
    const pickupCount = effects.filter(card => card.special === "pickup").length * DEFAULT_RULES.pickupCards;
    const penaltyCount = pickupCount || (effects.some(card => card.special === "super-pickup") ? DEFAULT_RULES.superPickupCards : 0);
    const next = skips ? seat : opponent;
    // Default two-seat special ranks do not mix skip effects with draw effects.
    const pickup = penaltyCount ? this.drawCards(opponent, penaltyCount) : undefined;
    const drawnCards = pickup?.drawnCards;
    const penalty = drawnCards ? { seat: opponent, count: drawnCards.length } : undefined;
    this.event = { seat, kind: "play", cards: played, aggressiveness, skips, penalty, drawnCards,
      ...(burnsPreviousPlay ? { burnsPreviousPlay: true } : {}), ...(pickup?.reshuffles.length ? { reshuffles: pickup.reshuffles } : {}) };
    this.advance(next);
  }

  private checkWildSuit(suit: Card["suit"] | undefined, current: Card["suit"], count: number): void {
    if (!suit) throw new Error("Choose a suit for the last eight.");
    if (!wildSuitOptions(current, count).includes(suit)) throw new Error("Choose a different suit for a single eight.");
  }

  private advance(next: Seat): void {
    this.turn = next;
    this.drewThisTurn = false;
    if (this.hands[next].length > 0) return;
    const remaining = this.hands[otherSeat(next)].length;
    this.finish(remaining ? next : "tie", remaining, next);
  }

  private finish(winner: RoundEnd["winner"], points: number, nextFirst: Seat): void {
    points *= this.pointsPerCard;
    this.result = { winner, points };
    this.nextFirst = nextFirst;
    if (winner !== "tie") {
      this.points[winner] += points;
      this.points[otherSeat(winner)] -= points;
      this.roundsWon[winner]++;
      if (this.roundsWon[0] + this.roundsWon[1] >= MATCH_ROUNDS && this.points[0] !== this.points[1]) {
        const matchWinner = this.points[0] > this.points[1] ? 0 : 1;
        this.matchResult = { winner: matchWinner, points: this.points[matchWinner], roundsWon: [...this.roundsWon] };
      }
    }
  }
}
