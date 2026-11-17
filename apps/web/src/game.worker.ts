import { GameServer } from "@crazy-eights/game-server";
import type { Response } from "@crazy-eights/protocol";
import { DEFAULT_SETTINGS, readSettings } from "./settings.ts";
import { tableAnimationTime, type TableTiming } from "./table-timing.ts";

const game = new GameServer();
let pending: ReturnType<typeof setTimeout> | undefined;
let suspended = false;
let timing: TableTiming = { ...DEFAULT_SETTINGS, animate: true };
let revision: number | undefined;
let changedAt = 0;
let animationEndsAt = 0;

function publish(response: string): void {
  const { view } = JSON.parse(response) as Response;
  if (revision !== view.revision) {
    revision = view.revision;
    changedAt = performance.now();
    animationEndsAt = changedAt + tableAnimationTime(view, timing.animationSpeed, timing.animate, timing.pickupAnimation);
  }
  self.postMessage(response);
}

function scheduleTurn(): void {
  clearTimeout(pending);
  if (suspended || revision === undefined) return;
  const move = game.automaticMove;
  if (!move) return;
  const nextAt = move === "computer" ? animationEndsAt + timing.aiPauseMs :
    move === "queued" ? animationEndsAt + 80 :
      Math.max(animationEndsAt, changedAt + (move === "draw" ? 850 : 900));
  pending = setTimeout(() => {
    if (game.stepAutomatic()) publish(game.stateJSON(0));
    scheduleTurn();
  }, Math.max(0, nextAt - performance.now()));
}

self.onmessage = ({ data }: MessageEvent<string>) => {
  let message: { replay?: boolean; timing?: Partial<TableTiming> } | null = null;
  try {
    message = JSON.parse(data);
  } catch {
    // The game server reports malformed requests over the same JSON interface.
  }
  if (typeof message?.replay === "boolean") {
    suspended = message.replay;
  } else if (message?.timing) {
    timing = { ...readSettings(message.timing), animate: message.timing.animate !== false };
  } else {
    publish(game.handleJSON(0, data));
  }
  scheduleTurn();
};
