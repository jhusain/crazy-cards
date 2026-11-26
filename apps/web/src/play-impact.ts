import { artHeight, type CardPosition } from "./table-layout.ts";

const unit = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = unit(n); return t * t * (3 - 2 * t); };
export const impactStrength = (score: number) => Number.isFinite(score) ? Math.max(0, score) : 0;

function slamMotion(elapsed: number, flight: number, score: number) {
  const strength = impactStrength(score);
  const descent = 115 / (1 + strength * .18);
  const raisedAt = Math.max(1, flight - descent);
  const approach = smooth(elapsed / raisedAt);
  const fall = unit((elapsed - raisedAt) / descent) ** 3;
  const lift = Math.sin(approach * Math.PI / 2) * (1 - fall);
  return { strength, approach, lift };
}

export function slamFlight(from: CardPosition, to: CardPosition, elapsed: number, flight: number, score: number): CardPosition {
  const { strength, approach, lift } = slamMotion(elapsed, flight, score);
  const width = from.width + (to.width - from.width) * approach;
  const scale = 1 + lift * (.06 + strength * .018);
  return {
    x: from.x + (to.x - from.x) * approach - width * (scale - 1) / 2,
    y: from.y + (to.y - from.y) * approach - lift * to.width * (.10 + strength * .025) - artHeight(width) * (scale - 1) / 2,
    width: width * scale,
    clipWidth: ((from.clipWidth ?? from.width) + ((to.clipWidth ?? to.width) - (from.clipWidth ?? from.width)) * approach) * scale,
    clipHeight: ((from.clipHeight ?? artHeight(from.width)) + ((to.clipHeight ?? artHeight(to.width)) - (from.clipHeight ?? artHeight(from.width))) * approach) * scale,
  };
}

export function slamShadow(from: CardPosition, to: CardPosition, elapsed: number, flight: number, score: number) {
  const { strength, approach, lift } = slamMotion(elapsed, flight, score);
  const width = from.width + (to.width - from.width) * approach;
  const height = artHeight(width);
  // Project onto the surface beneath the moving card. Height separates and softens the shadow.
  return {
    x: from.x + (to.x - from.x) * approach + width * lift * .045,
    y: from.y + (to.y - from.y) * approach + width * lift * .065,
    width, height, blur: width * lift * (.025 + strength * .004),
    alpha: lift * .24,
  };
}

export function impactEnvelope(elapsed: number, impact: number, slideStart: number, slideEnd: number): number {
  if (elapsed < impact || elapsed >= slideEnd) return 0;
  // A fast outward impulse; the cards stay displaced until the original discard slide starts.
  const outward = 1 - (1 - unit((elapsed - impact) / Math.min(75, Math.max(1, slideStart - impact)))) ** 3;
  return outward * (1 - smooth((elapsed - slideStart) / Math.max(1, slideEnd - slideStart)));
}

export function scatteredCard(home: CardPosition, origin: CardPosition, score: number, index: number, towardPlayer: boolean, amount: number) {
  const force = Math.max(0, impactStrength(score) - 3) * origin.width * .12 * amount;
  if (!force) return { position: home, angle: 0 };
  const dx = home.x + home.width / 2 - origin.x;
  const dy = (towardPlayer ? 1 : -1) * Math.max(origin.width, Math.abs(home.y + artHeight(home.width) / 2 - origin.y));
  const length = Math.hypot(dx, dy);
  const variation = .8 + ((index * 7 + 3) % 11) * .04;
  return {
    position: { ...home, x: home.x + dx / length * force * variation, y: home.y + dy / length * force * variation },
    angle: (dx < 0 ? -1 : 1) * (2 + index % 4) * Math.max(0, score - 3) * amount,
  };
}

export function tableShock(elapsed: number, impact: number, score: number) {
  const t = (elapsed - impact) / 210;
  const amplitude = t >= 0 && t < 1 ? impactStrength(score) * .7 * (1 - t) ** 2 : 0;
  if (!amplitude) return { x: 0, y: 0 };
  return { x: Math.sin(t * Math.PI * 9) * amplitude, y: Math.cos(t * Math.PI * 12) * amplitude };
}
