export const ANIMATION_SPEEDS = [.05, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

export interface GameSettings {
  animationSpeed: number;
  aiPauseMs: number;
  dangerWarning: boolean;
  dangerThreshold: number;
  targetCardWidth: number;
  keepGroupsTogether: boolean;
  groupExceptWild: boolean;
  groupExceptTwo: boolean;
  autoPass: boolean;
  automaticDelayMs: number;
  autoPickup: boolean;
  autoSingle: boolean;
  autoSingleExcludeWild: boolean;
  autoSingleExcludeTwo: boolean;
  autoSingleExcludeQueen: boolean;
  autoSingleSkips: boolean;
  dimUnplayable: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  animationSpeed: .7, aiPauseMs: 1500, dangerWarning: true, dangerThreshold: 1, targetCardWidth: 240, keepGroupsTogether: true,
  groupExceptWild: true, groupExceptTwo: true, autoPass: false, automaticDelayMs: 3000,
  autoPickup: false, autoSingle: false, autoSingleExcludeWild: false, autoSingleExcludeTwo: false,
  autoSingleExcludeQueen: false, autoSingleSkips: false, dimUnplayable: false,
};

export function readSettings(value: unknown): GameSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const {
    animationSpeed, aiPauseMs, dangerWarning, dangerThreshold, targetCardWidth, keepGroupsTogether,
    groupExceptWild, groupExceptTwo, autoPass,
    autoPickup, autoSingle, autoSingleExcludeWild, autoSingleExcludeTwo, autoSingleExcludeQueen, autoSingleSkips, dimUnplayable,
  } = value as Partial<GameSettings>;
  const saved = value as Partial<GameSettings> & { autoPassDelayMs?: number };
  const delay = saved.automaticDelayMs ?? saved.autoPassDelayMs;
  return {
    animationSpeed: animationSpeed !== undefined && ANIMATION_SPEEDS.includes(animationSpeed)
      ? animationSpeed : DEFAULT_SETTINGS.animationSpeed,
    aiPauseMs: typeof aiPauseMs === "number" && aiPauseMs >= 1000 && aiPauseMs <= 3000 && aiPauseMs % 250 === 0
      ? aiPauseMs : DEFAULT_SETTINGS.aiPauseMs,
    dangerWarning: typeof dangerWarning === "boolean" ? dangerWarning : DEFAULT_SETTINGS.dangerWarning,
    targetCardWidth: typeof targetCardWidth === "number" && Number.isInteger(targetCardWidth) && targetCardWidth >= 40 && targetCardWidth <= 1000 && targetCardWidth % 10 === 0
      ? targetCardWidth : DEFAULT_SETTINGS.targetCardWidth,
    dangerThreshold: dangerThreshold !== undefined && Number.isInteger(dangerThreshold) && dangerThreshold >= 0 && dangerThreshold <= 5
      ? dangerThreshold : DEFAULT_SETTINGS.dangerThreshold,
    keepGroupsTogether: typeof keepGroupsTogether === "boolean" ? keepGroupsTogether : DEFAULT_SETTINGS.keepGroupsTogether,
    groupExceptWild: typeof groupExceptWild === "boolean" ? groupExceptWild : DEFAULT_SETTINGS.groupExceptWild,
    groupExceptTwo: typeof groupExceptTwo === "boolean" ? groupExceptTwo : DEFAULT_SETTINGS.groupExceptTwo,
    autoPass: typeof autoPass === "boolean" ? autoPass : DEFAULT_SETTINGS.autoPass,
    automaticDelayMs: typeof delay === "number" && delay >= 1000 && delay <= 10000 && delay % 1000 === 0
      ? delay : DEFAULT_SETTINGS.automaticDelayMs,
    autoPickup: typeof autoPickup === "boolean" ? autoPickup : false,
    autoSingle: typeof autoSingle === "boolean" ? autoSingle : false,
    autoSingleExcludeWild: typeof autoSingleExcludeWild === "boolean" ? autoSingleExcludeWild : false,
    autoSingleExcludeTwo: typeof autoSingleExcludeTwo === "boolean" ? autoSingleExcludeTwo : false,
    autoSingleExcludeQueen: typeof autoSingleExcludeQueen === "boolean" ? autoSingleExcludeQueen : false,
    autoSingleSkips: typeof autoSingleSkips === "boolean" ? autoSingleSkips : false,
    dimUnplayable: typeof dimUnplayable === "boolean" ? dimUnplayable : false,
  };
}
