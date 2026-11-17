export const ANIMATION_SPEEDS = [.05, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

export interface GameSettings {
  animationSpeed: number;
  aiPauseMs: number;
  pickupAnimation: "sequential" | "concurrent";
  dangerWarning: boolean;
  dangerThreshold: number;
  alwaysPlayWild: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  animationSpeed: 1, aiPauseMs: 1000, pickupAnimation: "sequential", dangerWarning: true, dangerThreshold: 1, alwaysPlayWild: false,
};

export function readSettings(value: unknown): GameSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const { animationSpeed, aiPauseMs, pickupAnimation, dangerWarning, dangerThreshold, alwaysPlayWild } = value as Partial<GameSettings>;
  return {
    animationSpeed: animationSpeed !== undefined && ANIMATION_SPEEDS.includes(animationSpeed)
      ? animationSpeed : DEFAULT_SETTINGS.animationSpeed,
    aiPauseMs: typeof aiPauseMs === "number" && aiPauseMs >= 1000 && aiPauseMs <= 3000 && aiPauseMs % 250 === 0
      ? aiPauseMs : DEFAULT_SETTINGS.aiPauseMs,
    pickupAnimation: pickupAnimation === "concurrent" ? pickupAnimation : DEFAULT_SETTINGS.pickupAnimation,
    dangerWarning: typeof dangerWarning === "boolean" ? dangerWarning : DEFAULT_SETTINGS.dangerWarning,
    dangerThreshold: dangerThreshold !== undefined && Number.isInteger(dangerThreshold) && dangerThreshold >= 0 && dangerThreshold <= 5
      ? dangerThreshold : DEFAULT_SETTINGS.dangerThreshold,
    alwaysPlayWild: alwaysPlayWild === true,
  };
}
