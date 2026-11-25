import { SUITS, type Suit } from "@crazy-eights/protocol";

const channels = (suit: Suit) => suit === "hearts" || suit === "diamonds" ? [166, 41, 61] : [32, 44, 51];
const color = (values: number[]) => "#" + values.map(value => Math.round(value).toString(16).padStart(2, "0")).join("");
export const suitInk = (suit: Suit) => color(channels(suit));

export interface WildReel {
  suits: readonly Suit[];
  snap: "forward" | "back";
}

// The spin uses 76% of the time, balances on the detent for 6%, then settles.
export const WILD_BALANCE = .76;
export const WILD_RELEASE = .82;

export function wildReel(first: Suit, last: Suit, random = Math.random, eligible: readonly Suit[] = SUITS): WildReel {
  const pick = (choices: readonly Suit[]) => choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
  const snap = random() < .5 ? "back" : "forward";
  const suits = [eligible.includes(first) ? first : pick(eligible)];
  for (let i = 0; i < 7; i++) {
    const choices = eligible.filter(suit => suit !== suits.at(-1) && (i !== 6 || suit !== last));
    suits.push(pick(choices));
  }
  suits.push(last);
  // Recoil travels half a slot beyond the call; forward travel stops half a
  // slot before it. Both candidates are legal and distinct in either case.
  if (snap === "back") suits.push(pick(eligible.filter(suit => suit !== last)));
  return { suits, snap };
}

export function wildReelPosition(reel: WildReel, progress: number): number {
  const time = Math.max(0, Math.min(1, progress));
  const target = reel.suits.length - (reel.snap === "back" ? 2 : 1);
  const balance = target + (reel.snap === "back" ? .5 : -.5);
  if (time < WILD_BALANCE) {
    // Cubic ease-out: fast initial travel, monotonically decreasing speed,
    // and zero velocity exactly halfway between the final two candidates.
    return balance * (1 - (1 - time / WILD_BALANCE) ** 3);
  }
  if (time <= WILD_RELEASE) return balance;
  const settle = (time - WILD_RELEASE) / (1 - WILD_RELEASE);
  // Accelerate away from resistance, then ease into the centered suit.
  const eased = settle * settle * (3 - 2 * settle);
  return balance + (target - balance) * eased;
}

export function wildReelFrame(reel: WildReel, progress: number) {
  const position = wildReelPosition(reel, progress);
  const index = Math.floor(position);
  return { current: reel.suits[index]!, next: reel.suits[index + 1], offset: position - index };
}

export function wildReelInk(reel: WildReel, progress: number): string {
  const frame = wildReelFrame(reel, progress);
  const from = channels(frame.current), to = channels(frame.next ?? frame.current);
  return color(from.map((value, index) => value + (to[index]! - value) * frame.offset));
}

// Derive sound from actual travel, including reversal. Splitting at the balance
// and release also preserves crossings when a rendered frame spans the pause.
export function wildReelSounds(reel: WildReel, from: number, to: number): ("tick" | "click")[] {
  if (to <= from) return [];
  const times = [from, WILD_BALANCE, WILD_RELEASE, to].filter(time => time >= from && time <= to);
  const sounds: ("tick" | "click")[] = [];
  for (let i = 1; i < times.length; i++) {
    const start = wildReelPosition(reel, times[i - 1]!);
    const end = wildReelPosition(reel, times[i]!);
    if (start === end) continue;
    const forward = end > start;
    const crossings: { position: number; sound: "tick" | "click" }[] = [];
    for (let slot = 0; slot < reel.suits.length; slot++) {
      // Tick when a centered symbol starts moving down. Recoil does not
      // depart another center before reaching its final resting point.
      if (forward && start <= slot && end > slot) crossings.push({ position: slot, sound: "tick" });
      const resistance = slot + .5;
      if (forward ? start <= resistance && end > resistance : start >= resistance && end < resistance)
        crossings.push({ position: resistance, sound: "click" });
    }
    crossings.sort((a, b) => forward ? a.position - b.position : b.position - a.position);
    sounds.push(...crossings.map(crossing => crossing.sound));
  }
  return sounds;
}
