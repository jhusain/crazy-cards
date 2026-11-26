const unit = (value: number) => Math.max(0, Math.min(1, value));

export const chargeDuration = (score: number) => score >= 4 ? 650 + (score - 4) * 65 : 0;

export const slamDescent = (score: number) => 115 / (1 + (Number.isFinite(score) ? Math.max(0, score) : 0) * 3 * .18);

export function powerCharge(elapsed: number, flight: number, descent: number, score: number, hold = 0) {
  const duration = chargeDuration(score);
  const start = flight - descent - duration;
  const progress = duration ? unit((elapsed - start) / duration) : 0;
  const waited = hold > 0 ? unit((elapsed - (start - hold)) / hold) * hold : 0;
  return { start, duration, progress,
    visible: duration > 0 && elapsed >= start && elapsed < flight,
    motionElapsed: elapsed - waited - progress * duration,
    motionFlight: flight - duration - hold,
  };
}

const whiten = (color: number, amount: number) => {
  const channel = (shift: number) => Math.round(((color >> shift) & 255) * (1 - amount) + 255 * amount);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};

export function chargePalette(progress: number) {
  const brightness = unit(progress) ** 1.8;
  return { base: whiten(0x182b26, brightness),
    rays: [0x182b26, 0xefc875].map(color => whiten(color, brightness)) };
}

export function chargePulseThresholds(score: number): number[] {
  if (score < 4) return [];
  const count = 2 * Math.min(12, 6 + Math.floor((score - 4) * .6));
  const intervals = Array.from({ length: count - 1 }, (_, index) => .78 ** (index / 2));
  const total = intervals.reduce((sum, value) => sum + value, 0);
  let position = 0;
  return [0, ...intervals.map(interval => { position += interval; return position / total * .96; })];
}
