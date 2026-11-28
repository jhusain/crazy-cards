import type { HandSortingStrategy } from "./hand-sorting.ts";

export const ANIMATION_SPEEDS = [.05, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

export interface GameSettings {
  handSortingStrategy: HandSortingStrategy;
  animationSpeed: number;
  aiPauseMs: number;
  dangerWarning: boolean;
  dangerThreshold: number;
  targetCardWidth: number;
  keepGroupsTogether: boolean;
  // Retain the saved key: enabled wild flicks now play a single eight immediately.
  groupExceptWild: boolean;
  groupExceptTwo: boolean;
  autoStaged: boolean;
  autoPass: boolean;
  automaticDelayMs: number;
  autoPickupNoEligible: boolean;
  autoPickupSameEligible: boolean;
  autoSingle: boolean;
  autoSingleExcludeWild: boolean;
  autoSingleExcludeTwo: boolean;
  autoSingleExcludeQueen: boolean;
  autoSingleIgnoreExclusionsWhenOpponentEmpty: boolean;
  autoSingleSkips: boolean;
  dimUnplayable: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  handSortingStrategy: "default",
  animationSpeed: .7, aiPauseMs: 1500, dangerWarning: true, dangerThreshold: 1, targetCardWidth: 240, keepGroupsTogether: true,
  groupExceptWild: true, groupExceptTwo: true, autoStaged: false, autoPass: false, automaticDelayMs: 3000,
  autoPickupNoEligible: false, autoPickupSameEligible: false, autoSingle: false, autoSingleExcludeWild: false, autoSingleExcludeTwo: false,
  autoSingleExcludeQueen: false, autoSingleIgnoreExclusionsWhenOpponentEmpty: false, autoSingleSkips: false, dimUnplayable: false,
};

export function readSettings(value: unknown): GameSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const {
    handSortingStrategy,
    animationSpeed, aiPauseMs, dangerWarning, dangerThreshold, targetCardWidth, keepGroupsTogether,
    groupExceptWild, groupExceptTwo, autoStaged, autoPass,
    autoPickupNoEligible, autoPickupSameEligible, autoSingle, autoSingleExcludeWild, autoSingleExcludeTwo, autoSingleExcludeQueen, autoSingleIgnoreExclusionsWhenOpponentEmpty, autoSingleSkips, dimUnplayable,
  } = value as Partial<GameSettings>;
  const saved = value as Partial<GameSettings> & { autoPassDelayMs?: number; autoPickup?: boolean };
  const delay = saved.automaticDelayMs ?? saved.autoPassDelayMs;
  return {
    handSortingStrategy: handSortingStrategy === "wizard" || handSortingStrategy === "anupa" ? handSortingStrategy : "default",
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
    autoStaged: autoStaged === true,
    autoPass: typeof autoPass === "boolean" ? autoPass : DEFAULT_SETTINGS.autoPass,
    automaticDelayMs: typeof delay === "number" && delay >= 1000 && delay <= 10000 && delay % 1000 === 0
      ? delay : DEFAULT_SETTINGS.automaticDelayMs,
    autoPickupNoEligible: typeof autoPickupNoEligible === "boolean" ? autoPickupNoEligible : saved.autoPickup === true,
    autoPickupSameEligible: typeof autoPickupSameEligible === "boolean" ? autoPickupSameEligible : saved.autoPickup === true,
    autoSingle: typeof autoSingle === "boolean" ? autoSingle : false,
    autoSingleExcludeWild: typeof autoSingleExcludeWild === "boolean" ? autoSingleExcludeWild : false,
    autoSingleExcludeTwo: typeof autoSingleExcludeTwo === "boolean" ? autoSingleExcludeTwo : false,
    autoSingleExcludeQueen: typeof autoSingleExcludeQueen === "boolean" ? autoSingleExcludeQueen : false,
    autoSingleIgnoreExclusionsWhenOpponentEmpty: autoSingleIgnoreExclusionsWhenOpponentEmpty === true,
    autoSingleSkips: typeof autoSingleSkips === "boolean" ? autoSingleSkips : false,
    dimUnplayable: typeof dimUnplayable === "boolean" ? dimUnplayable : false,
  };
}
