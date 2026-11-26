import { ART_WIDTH, CORNER_WIDTH, artHeight, type CardPosition } from "./table-layout.ts";
import { shakeDuration } from "./table-timing.ts";
import { powerCharge } from "./power-charge.ts";

const unit = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = unit(n); return t * t * (3 - 2 * t); };
export const impactStrength = (score: number) => Number.isFinite(score) ? Math.max(0, score) : 0;
// Intensity scales the impact, independently of lift geometry and the scattering threshold.
export const slamIntensity = (score: number) => impactStrength(score) * 3;
export const slamDescent = (score: number) => 115 / (1 + slamIntensity(score) * .18);

// Cubic ease-out: direct movement that progressively slows to a complete stop.
export const arrivalProgress = (elapsed: number, flight: number) =>
  1 - (1 - unit(elapsed / flight)) ** 3;

function slamMotion(elapsed: number, flight: number, score: number) {
  const strength = impactStrength(score);
  const descent = slamDescent(score);
  const charge = powerCharge(elapsed, flight, descent, score);
  const raisedAt = Math.max(1, charge.motionFlight - descent);
  const approach = smooth(charge.motionElapsed / raisedAt);
  const fall = unit((charge.motionElapsed - raisedAt) / descent) ** 3;
  const lift = Math.sin(approach * Math.PI / 2) * (1 - fall);
  return { strength, approach, lift };
}

export function slamFlight(from: CardPosition, to: CardPosition, elapsed: number, flight: number, score: number): CardPosition {
  const { strength, approach, lift } = slamMotion(elapsed, flight, score);
  const width = from.width + (to.width - from.width) * approach;
  const scale = 1 + lift * (.08 + strength * .045);
  return {
    x: from.x + (to.x - from.x) * approach - width * (scale - 1) / 2,
    y: from.y + (to.y - from.y) * approach - lift * to.width * (.12 + strength * .085) - artHeight(width) * (scale - 1) / 2,
    width: width * scale,
    clipWidth: ((from.clipWidth ?? from.width) + ((to.clipWidth ?? to.width) - (from.clipWidth ?? from.width)) * approach) * scale,
    clipHeight: ((from.clipHeight ?? artHeight(from.width)) + ((to.clipHeight ?? artHeight(to.width)) - (from.clipHeight ?? artHeight(from.width))) * approach) * scale,
  };
}

export function slamPlayFlight(from: CardPosition[], to: CardPosition[], elapsed: number, flight: number, score: number, boardWidth: number, inset: number): CardPosition[] {
  const { lift } = slamMotion(elapsed, flight, score);
  const positions = from.map((source, index) => slamFlight(source, to[index]!, elapsed, flight, score));
  if (!positions.length || lift < 1e-8) return positions;
  const corner = CORNER_WIDTH / ART_WIDTH;
  // Spread the raised group enough to keep every identifying corner readable.
  for (let index = 1; index < positions.length; index++) {
    const previous = positions[index - 1]!;
    const position = positions[index]!;
    position.x += Math.max(0, previous.x + previous.width * corner - position.x) * lift;
  }
  const left = Math.min(...positions.map(position => position.x));
  const right = Math.max(...positions.map(position => position.x + position.width * corner));
  const available = boardWidth - 2 * inset;
  const fit = Math.min(1, available / Math.max(1, right - left));
  const scale = 1 + (fit - 1) * lift;
  const shift = (Math.max(inset, Math.min(left, boardWidth - inset - (right - left) * scale)) - left) * lift;
  return positions.map(position => ({ ...position,
    x: left + (position.x - left) * scale + shift,
    y: position.y + Math.max(0, inset - position.y) * lift,
    width: position.width * scale,
    clipWidth: position.clipWidth === undefined ? undefined : position.clipWidth * scale,
    clipHeight: position.clipHeight === undefined ? undefined : position.clipHeight * scale,
  }));
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
  const duration = shakeDuration(score);
  if (!duration) return { x: 0, y: 0 };
  const t = (elapsed - impact) / duration;
  const amplitude = t >= 0 && t < 1 ? slamIntensity(score) * .7 * (1 - t) ** 2 : 0;
  if (!amplitude) return { x: 0, y: 0 };
  return { x: Math.sin(t * Math.PI * 9) * amplitude, y: Math.cos(t * Math.PI * 12) * amplitude };
}

export function impactVibration(score: number, durationMs = shakeDuration(score)): number[] {
  if (!impactStrength(score) || !Number.isFinite(durationMs) || durationMs <= 0) return [];
  const duration = Math.round(durationMs);
  // The browser exposes pulse timing, not motor amplitude. Duty cycle follows the shake envelope.
  // Keep within the standard's ten-entry pattern limit, including slow-motion replay.
  const cell = Math.max(50, Math.ceil(duration / 5));
  const pattern: number[] = [];
  for (let elapsed = 0; elapsed < duration; elapsed += cell) {
    const span = Math.min(cell, duration - elapsed);
    const envelope = (1 - elapsed / duration) ** 2;
    const on = Math.min(span, Math.max(1, Math.round(span * Math.min(.85, (.2 + score * .05) * envelope))));
    pattern.push(on, span - on);
  }
  return pattern;
}
