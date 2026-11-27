import { GameServer } from "@crazy-eights/game-server";
import type { Command, Response } from "@crazy-eights/protocol";
import { DEFAULT_SETTINGS, readSettings } from "./settings.ts";
import { tableAnimationTime, type TableTiming } from "./table-timing.ts";

let game: GameServer | undefined;
let autoplay = false;
let debug = false;
let pending: ReturnType<typeof setTimeout> | undefined;
let suspended = false;
let paused = false;
let timing: TableTiming = { ...DEFAULT_SETTINGS, animate: true };
let revision: number | undefined;
let manualDrawRevision: number | undefined;
let changedAt = 0;
let animationEndsAt = 0;

function publish(response: string, manualDraw = false): void {
  const message = JSON.parse(response) as Response;
  const { view } = message;
  if (revision !== view.revision) {
    manualDrawRevision = manualDraw && message.type === "state" && view.event?.kind === "draw" ? view.revision : undefined;
    revision = view.revision;
    changedAt = performance.now();
    animationEndsAt = changedAt + tableAnimationTime(view, timing.animationSpeed, timing.animate);
  }
  self.postMessage(response);
}

function scheduleTurn(): void {
  clearTimeout(pending);
  const server = game;
  if (suspended || paused || revision === undefined || !server) return;
  const move = server.automaticMove;
  // A voluntary draw leaves the decision to the client, including after its countdown is cancelled.
  if (!move || move === "pass" && revision === manualDrawRevision) return;
  const nextAt = move === "computer" ? animationEndsAt + timing.aiPauseMs :
    move === "queued" ? animationEndsAt + 80 :
      Math.max(animationEndsAt, changedAt + (move === "draw" ? 850 : 900));
  pending = setTimeout(() => {
    if (server.stepAutomatic()) publish(server.stateJSON(0));
    scheduleTurn();
  }, Math.max(0, nextAt - performance.now()));
}

self.onmessage = ({ data }: MessageEvent<string>) => {
  let message: { debug?: boolean; autoplay?: boolean; paused?: boolean; replay?: boolean; timing?: Partial<TableTiming>; holdMs?: number; command?: Command } | null = null;
  try {
    message = JSON.parse(data);
  } catch {
    // The game server reports malformed requests over the same JSON interface.
  }
  if (typeof message?.debug === "boolean") {
    debug = message.debug;
    game?.setDebug(debug);
  } else if (typeof message?.autoplay === "boolean") {
    autoplay = message.autoplay;
    if (typeof message.paused === "boolean") paused = message.paused;
    game?.setAutoplay(autoplay);
    if (typeof message.holdMs === "number") animationEndsAt = Math.max(animationEndsAt, performance.now() + Math.max(0, message.holdMs));
  } else if (typeof message?.paused === "boolean") {
    paused = message.paused;
  } else if (typeof message?.replay === "boolean") {
    suspended = message.replay;
  } else if (message?.timing) {
    timing = { ...readSettings(message.timing), animate: message.timing.animate !== false };
  } else if (typeof message?.holdMs === "number") {
    animationEndsAt = Math.max(animationEndsAt, performance.now() + Math.max(0, message.holdMs));
  } else {
    game ??= new GameServer(1, undefined, autoplay);
    game.setDebug(debug);
    publish(game.handleJSON(0, data), message?.command?.type === "draw");
  }
  scheduleTurn();
};
