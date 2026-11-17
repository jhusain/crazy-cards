import { otherSeat, type Seat, type TableView } from "@crazy-eights/protocol";
import type { GameSettings } from "./settings.ts";

export const PLAY_FLIGHT = 235;
export const PLAY_HOLD = 105;
export const PLAY_SLIDE = 188;
export const PLAY_TIME = PLAY_FLIGHT + PLAY_HOLD + PLAY_SLIDE;
export const STAGE_FLIGHT = 235;
export const HAND_DRAW = 365;
export const OPPONENT_DRAW = 330;
export const HAND_DEAL = 245;
export const OPPONENT_DEAL = 260;
const FRAME_BUFFER = 48;

export interface TableTiming extends GameSettings {
  animate: boolean;
}

export function drawsFor(view: TableView, seat: Seat): number {
  const event = view.event;
  if (event?.kind === "draw" && event.seat === seat) return event.drawCount ?? 0;
  return event?.penalty?.seat === seat ? event.penalty.count : 0;
}

export function drawTimeline(view: TableView, seat: Seat, mode: GameSettings["pickupAnimation"]) {
  const count = drawsFor(view, seat);
  const duration = seat === view.seat ? HAND_DRAW : OPPONENT_DRAW;
  const sequential = count > 1 && mode === "sequential";
  const reflow = sequential ? duration : 0;
  const start = count && view.event?.penalty?.seat === seat ? PLAY_TIME : 0;
  const total = count === 0 ? 0 : start + reflow + (sequential ? count : 1) * duration;
  return { count, duration, sequential, start, reflow, total };
}

export function tableAnimationTime(
  view: TableView, speed: number, animate: boolean, pickup: GameSettings["pickupAnimation"],
): number {
  if (!animate) return 0;
  const event = view.event;
  const humanDraw = drawTimeline(view, view.seat, pickup).total;
  const enemyDraw = drawTimeline(view, otherSeat(view.seat), pickup).total;
  const play = event?.kind === "play" ? PLAY_TIME : 0;
  const duration = !event ? Math.max(HAND_DEAL, OPPONENT_DEAL) :
    Math.max(play, humanDraw, enemyDraw);
  return duration > 0 ? duration / speed + FRAME_BUFFER : 0;
}

export function replaySpeed(settings: GameSettings): number {
  return settings.animationSpeed * .5;
}

export function replayDelay(view: TableView, timing: TableTiming, hasNext: boolean): number {
  return tableAnimationTime(view, replaySpeed(timing), timing.animate, timing.pickupAnimation) +
    (hasNext ? timing.aiPauseMs : 0);
}
