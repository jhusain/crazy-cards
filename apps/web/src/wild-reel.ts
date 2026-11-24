import { SUITS, type Suit } from "@crazy-eights/protocol";

const channels = (suit: Suit) => suit === "hearts" || suit === "diamonds" ? [166, 41, 61] : [32, 44, 51];
const color = (values: number[]) => "#" + values.map(value => Math.round(value).toString(16).padStart(2, "0")).join("");
export const suitInk = (suit: Suit) => color(channels(suit));

export function wildReel(first: Suit, last: Suit, random = Math.random, eligible: readonly Suit[] = SUITS): Suit[] {
  const pick = (choices: readonly Suit[]) => choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
  const suits = [eligible.includes(first) ? first : pick(eligible)];
  for (let i = 0; i < 7; i++) {
    const choices = eligible.filter(suit => suit !== suits.at(-1) && (i !== 6 || suit !== last));
    suits.push(pick(choices));
  }
  return [...suits, last];
}

export function wildReelFrame(suits: readonly Suit[], progress: number) {
  const time = Math.max(0, Math.min(1, progress));
  const last = suits.length - 1;
  const overshoot = 1 / 3;
  // An undamped spring carries the incoming velocity through a third-slot
  // overshoot, then accelerates back to center, where a mechanical catch stops it.
  // Reserve exactly one half-period for that motion, preserving total duration.
  const velocity = last + Math.PI * overshoot;
  const arrival = last / velocity;
  const frequency = velocity / overshoot;
  const phase = frequency * Math.max(0, time - arrival);
  const offset = time >= 1 ? 0 : overshoot * Math.sin(Math.min(Math.PI, phase));
  const position = time < arrival ? velocity * time : last + offset;
  const index = time < arrival ? Math.min(last, Math.floor(position)) : last;
  return { current: suits[index]!, next: suits[index + 1], offset: position - index };
}

export function wildReelInk(suits: readonly Suit[], progress: number): string {
  const frame = wildReelFrame(suits, progress);
  const from = channels(frame.current), to = channels(frame.next ?? frame.current);
  // Follow the actual symbol travel; keep the final ink throughout its overshoot and recoil.
  return color(from.map((value, index) => value + (to[index]! - value) * frame.offset));
}


// Each newly centered suit gets one chime; overshoot and recoil keep the same
// stop index, so the final suit cannot chime twice.
export function wildReelStop(suits: readonly Suit[], progress: number): number {
  const last = suits.length - 1;
  return Math.min(last, Math.floor(Math.max(0,Math.min(1,progress)) * (last + Math.PI/3) + 1e-9));
}
