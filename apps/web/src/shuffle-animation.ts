import { ART_HEIGHT, type CardPosition } from "./table-layout.ts";
import { SHUFFLE_DURATION, SHUFFLE_FILL, SHUFFLE_HALF, SHUFFLE_ROLL } from "./table-timing.ts";

export const SHUFFLE_LAYERS = 4;
export const BACK_INNER_TOP = 14;
export const BACK_INNER_BOTTOM = ART_HEIGHT - 14;
const unit = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => (1 - Math.cos(Math.PI * unit(t))) / 2;
const between = (a: CardPosition, b: CardPosition, t: number): CardPosition => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, width: a.width,
});

export function pointRollOffsets(progress: number) {
  const distance = BACK_INNER_BOTTOM - BACK_INNER_TOP;
  return { old: distance * unit(progress), next: distance * (unit(progress) - 1) };
}

export function shuffleFrame(elapsed: number, deck: CardPosition, discard: CardPosition, step: number) {
  const slot = (index: number): CardPosition => ({ ...deck, x: deck.x + index * step, y: deck.y + index * step });
  const stage = elapsed < SHUFFLE_FILL ? "fill" : elapsed < SHUFFLE_FILL + 6 * SHUFFLE_HALF
    ? ((elapsed - SHUFFLE_FILL) % (2 * SHUFFLE_HALF) < SHUFFLE_HALF ? "cut" : "return")
    : elapsed < SHUFFLE_FILL + 6 * SHUFFLE_HALF + SHUFFLE_ROLL ? "points"
      : elapsed < SHUFFLE_DURATION ? "pause" : "done";
  const cycle = Math.min(3, Math.max(0, Math.floor((elapsed - SHUFFLE_FILL) / (2 * SHUFFLE_HALF))));
  const order = cycle % 2 ? [2,3,0,1] : [0,1,2,3];
  const cards = Array.from({length:SHUFFLE_LAYERS}, () => ({ position:slot(0), depth:0, visible:true }));
  const phase = ease(((elapsed - SHUFFLE_FILL) % (2 * SHUFFLE_HALF)) / SHUFFLE_HALF - (stage === "return" ? 1 : 0));
  const visible = Math.ceil(unit(elapsed / SHUFFLE_FILL) * SHUFFLE_LAYERS);
  order.forEach((physical, index) => {
    let position = slot(index);
    let depth = 3 - index;
    if (stage === "cut") {
      position = index < 2 ? between(slot(index), slot(index + 2), phase) :
        between(slot(index), { ...deck, x:discard.x+(index-2)*step, y:discard.y+(index-2)*step }, phase);
    } else if (stage === "return") {
      depth = index < 2 ? 1 - index : 5 - index;
      position = index < 2 ? slot(index + 2) : between(
        { ...deck, x:discard.x+(index-2)*step, y:discard.y+(index-2)*step }, slot(index - 2), phase);
    }
    cards[physical] = {position, depth, visible:stage !== "fill" || index >= SHUFFLE_LAYERS - visible};
  });
  return { stage, cycle, cards, pointProgress: ease((elapsed - SHUFFLE_FILL - 6 * SHUFFLE_HALF) / SHUFFLE_ROLL) };
}
