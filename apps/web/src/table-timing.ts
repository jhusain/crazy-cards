import { otherSeat, type Seat, type TableView } from "@crazy-eights/protocol";
import type { GameSettings } from "./settings.ts";
import { chargeDuration } from "./power-charge.ts";

export const PLAY_FLIGHT = 235;
export const PLAY_HOLD = 105;
export const PLAY_SHAKE = 210;
export const shakeDuration = (score: number) => Number.isFinite(score) && score > 0
  ? PLAY_SHAKE + Math.max(0, score - 1) * 75 : 0;
export const PLAY_SLIDE = 188;
export const PLAY_TIME = PLAY_FLIGHT + PLAY_HOLD + PLAY_SLIDE;
export const SHUFFLE_FILL = PLAY_TIME / 3;
export const SHUFFLE_HALF = PLAY_TIME / 2;
export const SHUFFLE_ROLL = PLAY_TIME;
export const SHUFFLE_PAUSE = PLAY_TIME;
export const SHUFFLE_DURATION = SHUFFLE_FILL + 6 * SHUFFLE_HALF + SHUFFLE_ROLL + SHUFFLE_PAUSE;
export const STAGE_FLIGHT = 235;
export const HAND_DRAW = 365;
export const HAND_READY = 235;
const HAND_DRAW_REVEAL = 150;
export const OPPONENT_DRAW = 330;
export const HAND_DEAL = 245;
export const OPPONENT_DEAL = 260;
const FRAME_BUFFER = 48;

export function opponentWildPlay(view: TableView): boolean {
  return view.event?.kind === "play" && view.event.seat !== view.seat &&
    view.event.cards?.at(-1)?.special === "wild";
}

export function playDuration(view: TableView): number {
  const wild = opponentWildPlay(view);
  const burn = view.event?.burnsPreviousPlay === true;
  return playPhases(false, false, wild, burn, view.event?.aggressiveness).total;
}

export function playPhases(queued: boolean, restoring: boolean, wild = false, burn = false, aggressiveness = 0) {
  // Add time only before the original slide; preserve its duration and easing, including staged prefixes.
  const charge = chargeDuration(aggressiveness);
  const impactLead = aggressiveness > 0 ? PLAY_FLIGHT + shakeDuration(aggressiveness) + charge : 0;
  const returnStart = restoring ? PLAY_FLIGHT + PLAY_HOLD : PLAY_TIME;
  const normal = {
    flight: (queued ? 0 : PLAY_FLIGHT) + (impactLead ? PLAY_FLIGHT : 0) + charge,
    collapseStart: (queued ? 0 : PLAY_FLIGHT + (restoring ? 0 : PLAY_HOLD)) + impactLead,
    collapseEnd: returnStart + impactLead,
    returnStart: returnStart + impactLead,
    total: PLAY_TIME + impactLead,
    reelEnd: 0,
    burnStart: null as number | null,
  };
  let phases = normal;
  if (wild) {
    const reelEnd = PLAY_TIME * 5.5 + impactLead;
    const collapseStart = reelEnd + PLAY_TIME / 5;
    const extra = collapseStart - normal.collapseStart;
    phases = { ...normal, collapseStart, collapseEnd: normal.collapseEnd + extra,
      returnStart: normal.returnStart + extra, total: normal.total + extra, reelEnd };
  }
  if (burn) {
    return { ...phases, burnStart: phases.collapseStart,
      collapseStart: phases.collapseStart + PLAY_TIME, collapseEnd: phases.collapseEnd + PLAY_TIME,
      returnStart: phases.returnStart + PLAY_TIME, total: phases.total + PLAY_TIME };
  }
  return phases;
}

export function playReflow(view: TableView) {
  if (view.event?.kind !== "play") return undefined;
  const landing = playDuration(view);
  const pending = view.queuedCards.length > 0;
  // Only the local player's play can leave the piles displaced by staging.
  const returnDuration = !pending && view.event.seat === view.seat ? PLAY_SLIDE : 0;
  const start = landing + returnDuration;
  return { landing, start, end: pending ? start : start + STAGE_FLIGHT };
}

export interface TableTiming extends GameSettings {
  animate: boolean;
}

export function drawsFor(view: TableView, seat: Seat): number {
  const event = view.event;
  if (event?.kind === "draw" && event.seat === seat) return event.drawCount ?? 0;
  return event?.penalty?.seat === seat ? event.penalty.count : 0;
}

export function drawTimeline(view: TableView, seat: Seat) {
  const event = view.event;
  const count = drawsFor(view, seat);
  const player = seat === view.seat;
  const duration = player ? HAND_DRAW : OPPONENT_DRAW;
  const reveal = player ? HAND_DRAW_REVEAL : 0;
  const start = count > 0 && event?.penalty?.seat === seat ? playReflow(view)?.end ?? 0 : 0;
  const step = reveal + duration;
  const shuffles = count || event?.kind === "shuffle" && player ? (event?.reshuffles ?? []).map((shuffle, index) => ({ ...shuffle,
    start: start + shuffle.drawIndex * step + index * SHUFFLE_DURATION, duration: SHUFFLE_DURATION })) : [];
  const cardStarts = Array.from({ length: count }, (_, index) => start + index * step +
    shuffles.filter(shuffle => shuffle.drawIndex <= index).length * SHUFFLE_DURATION);
  return { count, duration, reveal, start, cardStarts, shuffles, total: start + count * step + shuffles.length * SHUFFLE_DURATION };
}

export function handReadinessTimeline(view: TableView) {
  const event = view.event;
  const humanDraw = drawTimeline(view, view.seat).total;
  const enemyDraw = drawTimeline(view, otherSeat(view.seat)).total;
  const play = playReflow(view)?.end ?? 0;
  const emptyDraw = event?.kind === "draw" && !humanDraw && !enemyDraw ? HAND_DRAW : 0;
  const start = !event ? Math.max(HAND_DEAL, OPPONENT_DEAL) : Math.max(play, humanDraw, enemyDraw, emptyDraw);
  const duration = view.turn === view.seat && !view.result && !view.queuedCards.length
    ? HAND_READY : 0;
  return { start, duration };
}

export function tableAnimationTime(view: TableView, speed: number, animate: boolean): number {
  if (!animate) return 0;
  const ready = handReadinessTimeline(view);
  const duration = ready.start + ready.duration;
  return duration > 0 ? duration / speed + FRAME_BUFFER : 0;
}

export function replaySpeed(settings: GameSettings): number {
  return settings.animationSpeed * .5;
}

export function replayDelay(view: TableView, timing: TableTiming, hasNext: boolean): number {
  return tableAnimationTime(view, replaySpeed(timing), timing.animate) +
    (hasNext ? timing.aiPauseMs : 0);
}
