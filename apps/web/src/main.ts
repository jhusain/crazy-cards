import Phaser from "phaser";
import { CountdownFeedback, countdownBeat } from "./feedback.ts";
import { setupPwa } from "./pwa.ts";
import {
  PLAY_SLOTS, canFollowInQueue, otherSeat, wildSuitOptions,
  type Card, type Command, type Request, type Response, type Suit, type TableView,
} from "@crazy-eights/protocol";
import { DECKS, SUIT_SYMBOL, loadCardArt, suitLabel } from "./cards.ts";
import { flickPlay } from "./card-gesture.ts";
import { AutomaticActions, type AutomaticAction } from "./automatic-actions.ts";
import { OpponentReplay } from "./opponent-replay.ts";
import { roundProgress } from "./round-progress.ts";
import { isDebug } from "./play-mode.ts";
import { debugPlayMessage } from "./debug-play.ts";
import { ANIMATION_SPEEDS, DEFAULT_SETTINGS, readSettings, type GameSettings } from "./settings.ts";
import { CardTable } from "./table.ts";
import { replayDelay, replaySpeed, STAGE_FLIGHT, tableAnimationTime, type TableTiming } from "./table-timing.ts";
import { NetworkConnection, type GameConnection } from "./network.ts";
import { invitationFromHash, invitationUrl, type Invitation } from "./network-protocol.ts";
import LocalServer from "./game.worker.ts?worker&inline";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "./style.css";

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const parent = element("board");
const table = element("table");
const status = element("table-status");
const notice = element("table-notice");
const noticeText = element("notice-text");
const nextRound = element<HTMLButtonElement>("next-round");
const automaticPanel = element("automatic-action");
const stockPile = element<HTMLButtonElement>("stock-pile");
const discardPile = element<HTMLButtonElement>("discard-pile");
const opponentHand = element<HTMLButtonElement>("opponent-hand");
const autoplayCheck = element<HTMLInputElement>("debug-autoplay");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const suitDialog = element<HTMLDialogElement>("suit-dialog");
suitDialog.addEventListener("close", () => {
  if (busy === undefined) scene?.returnDraggedCards();
});
const roundDialog = element<HTMLDialogElement>("round-dialog");
const rulesDialog = element<HTMLDialogElement>("rules-dialog");
const settingsDialog = element<HTMLDialogElement>("settings-dialog");
const restartDialog = element<HTMLDialogElement>("restart-dialog");
const replayButton = element<HTMLButtonElement>("replay-button");
const restartButton = element<HTMLButtonElement>("restart-button");
const menu = element("game-menu");
const menuShield = element<HTMLButtonElement>("menu-shield");
const replayShield = element<HTMLButtonElement>("replay-shield");
const history = new OpponentReplay();
const automaticActions = new AutomaticActions();
function showDebugToast(message: string): void {
  const toast = element("debug-toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}
const feedback = new CountdownFeedback(message => {
  if (debug) showDebugToast(message);
});
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const settingsKey = "crazy-eights-settings";
let debug = isDebug(window.location.search);
let autoplay = false;
let settings: GameSettings = { ...DEFAULT_SETTINGS };
let replaying = false;
let replayController: AbortController | undefined;
let animationTimer: ReturnType<typeof setTimeout> | undefined;
let view: TableView | undefined;
let staged: Card[] = [];
let playCapacity = 0;
let deckBack = 0;
let busy: number | undefined;
let pendingCommand: Command | undefined;
let automaticFrame: number | undefined;
let automaticSession: { revision: number; action: AutomaticAction } | undefined;
let canceledAutomaticRevision: number | undefined;
let requestId = 0;
let message: string | undefined;
let worker: GameConnection | undefined;
let network: NetworkConnection | undefined;
let networkReady = false;
let networkGeneration = 0;
const networkDialog = element<HTMLDialogElement>("network-dialog");
let scene: CardTable | undefined;
let announcedResultRevision: number | undefined;
let paintedRevision: number | undefined;
let deckTapTimer: ReturnType<typeof setTimeout> | undefined;
let lastDeckTap = { time: -Infinity, x: 0, y: 0 };

function cancelDeckTap(): void {
  clearTimeout(deckTapTimer);
  deckTapTimer = undefined;
  lastDeckTap.time = -Infinity;
}

function send(command: Command): number | undefined {
  if (busy !== undefined || !worker || replaying || network && !networkReady) return;
  cancelDeckTap();
  cancelAutomaticAction();
  pendingCommand = command;
  const request: Request = { requestId: ++requestId, revision: view?.revision ?? 0, command };
  busy = request.requestId;
  message = undefined;
  worker.postMessage(JSON.stringify(request));
  updateControls();
  return request.requestId;
}

const isMyTurn = () => view !== undefined && view.turn === view.seat;
const isQueued = () => !!view?.queuedCards.length;
const shuffleLocked = () => !replaying && animationTimer !== undefined && !!view?.event?.reshuffles?.length;
const inputReady = () => (!network || networkReady) && !replaying && busy === undefined && animationTimer === undefined;
const canUseStock = () => !autoplay && inputReady() && isMyTurn() && !isQueued();
const canDebugShuffle = () => !network && debug && !!view && !view.result && inputReady() && !isQueued();
const canUseDiscard = () => !autoplay && inputReady() && (!!view?.result || isMyTurn() && !isQueued() && (staged.length > 0 || !!view?.drewThisTurn || debug));
const canReplay = () => canUseStock() && !!view?.legalLeads.length && !!history.last;

function validQueue(cards: Card[], snapshot: TableView): Card[] {
  const hand = new Set(snapshot.hand.map(card => card.id));
  const queue: Card[] = [];
  for (const card of cards) {
    const previous = queue.at(-1);
    if (!hand.has(card.id) || (previous ? !canFollowInQueue(card, previous) : !snapshot.legalLeads.includes(card.id))) continue;
    queue.push(card);
  }
  return queue;
}

function tapCard(id: number): void {
  if (!view || !canUseStock()) return;
  cancelAutomaticAction();
  const index = staged.findIndex(card => card.id === id);
  message = undefined;
  if (index !== -1) {
    staged.splice(index, 1);
    staged = validQueue(staged, view);
  } else {
    const card = view.hand.find(candidate => candidate.id === id);
    if (!card) return;
    const previous = staged.at(-1);
    if (staged.length === PLAY_SLOTS) {
      message = "All 12 play slots are filled.";
    } else if (previous && !canFollowInQueue(card, previous)) {
      message = "Match the rank, or start a new play after an ace or jack.";
    } else if (!previous && !view.legalLeads.includes(card.id)) {
      message = "Lead with a matching rank or suit, or play an eight.";
    } else {
      staged.push(card);
    }
  }
  playCapacity = staged.length ? Math.max(playCapacity, view.visibleDiscard.length + staged.length) : 0;
  render(true);
}

function flickCard(id: number): void {
  if (!view || !canUseStock()) return;
  const card = view.hand.find(candidate => candidate.id === id);
  if (!card) return;
  const remaining = view.hand.filter(card => !staged.some(queued => queued.id === card.id));
  const previous = staged.at(-1);
  const legal = previous ? remaining.filter(card => canFollowInQueue(card, previous)).map(card => card.id) : view.legalLeads;
  const play = flickPlay(card, remaining, legal, settings);
  if (!play) { tapCard(id); return; }
  const commit = (cards: Card[]) => {
    if (!staged.length) { choosePlay(cards, true); return; }
    const combined = [...staged, ...cards];
    if (combined.length > PLAY_SLOTS) { message = "All 12 play slots are filled."; render(false); return; }
    if (!view || validQueue(combined, view).length !== combined.length) return;
    cancelAutomaticAction();
    staged = combined;
    playCapacity = Math.max(playCapacity, view.visibleDiscard.length + staged.length);
    render(true);
  };
  commit(play);
}

function clearPlay(): void {
  if (!canUseStock() || !staged.length) return;
  cancelAutomaticAction();
  staged = [];
  playCapacity = 0;
  message = undefined;
  render(true);
}

function drawOrPass(): void {
  if (!view || !canUseStock()) return;
  if (staged.length) {
    clearPlay();
    return;
  }
  send({ type: view.drewThisTurn ? "pass" : "draw" });
}

function choosePlay(cards: Card[], direct = false): void {
  if (!view || !canUseStock() || !cards.length) return;
  cancelAutomaticAction();
  const submit = (suit?: Suit) => {
    const command: Command = { type: direct ? "play" : "play-queue", cards: cards.map(card => card.id), ...(suit ? { suit } : {}) };
    send(command);
  };
  const wild = cards.findIndex(card => card.special === "wild");
  if (wild === -1) {
    submit();
    return;
  }
  const currentSuit = cards[wild - 1]?.suit ?? view.activeSuit;
  const count = cards.length - wild;
  const suits = wildSuitOptions(currentSuit, count);
  if (!view.opponentCount) {
    submit(suits[0]);
    return;
  }
  chooseSuit(suits, submit);
}

function chooseSuit(suits: readonly Suit[], submit: (suit: Suit) => void, title = "Call a suit"): void {
  cancelAutomaticAction();
  element("suit-title").textContent = title;
  const buttons = suits.map(suit => {
    const button = document.createElement("button");
    button.className = "suit-choice";
    if (suit === "hearts" || suit === "diamonds") button.dataset.red = "";
    const symbol = document.createElement("b");
    symbol.textContent = SUIT_SYMBOL[suit];
    symbol.setAttribute("aria-hidden", "true");
    button.append(symbol);
    button.setAttribute("aria-label", suitLabel(suit));
    button.onclick = () => {
      suitDialog.close();
      submit(suit);
    };
    return button;
  });
  element("suit-buttons").replaceChildren(...buttons);
  suitDialog.showModal();
  const titleElement = element("suit-title");
  titleElement.style.fontSize = "";
  let size = parseFloat(getComputedStyle(titleElement).fontSize);
  while (titleElement.scrollWidth > titleElement.clientWidth && size > 12) titleElement.style.fontSize = --size + "px";
}

function confirmPlay(): void {
  if (!view || !canUseDiscard()) return;
  if (view.result) {
    roundDialog.close();
    send({ type: view.matchResult ? "restart" : "next-round" });
  }
  else if (!staged.length && debug) send({ type: "auto-play" });
  else if (!staged.length) send({ type: "pass" });
  else choosePlay(staged.slice());
}

function cancelAutomaticAction(suppress = true): void {
  if (automaticFrame !== undefined) cancelAnimationFrame(automaticFrame);
  automaticFrame = undefined;
  automaticPanel.hidden = true;
  automaticSession = undefined;
  if (suppress) canceledAutomaticRevision = view?.revision;
}

function pauseAutomaticAction(): void {
  if (automaticFrame !== undefined) cancelAnimationFrame(automaticFrame);
  automaticFrame = undefined;
  automaticPanel.hidden = true;
}

function automaticCandidate(): AutomaticAction | undefined {
  const planned = automaticSession?.action.type === "play" ? automaticSession.action.cards : [];
  const hasManualPlay = staged.length > 0 && (automaticSession?.revision !== view?.revision ||
    staged.length !== planned.length || staged.some((card, index) => card.id !== planned[index]?.id));
  if (autoplay || !view || !canUseStock() || hasManualPlay || menu.matches(":popover-open") ||
      document.querySelector("dialog[open]") || canceledAutomaticRevision === view.revision) return;
  return automaticActions.next(view, settings);
}

function startAutomaticAction(): void {
  if (automaticFrame !== undefined) return;
  const action = automaticCandidate();
  if (!action || !view) return;
  const revision = view.revision;
  automaticSession = { revision, action };
  if (action.type === "play" && !staged.length) {
    staged = action.cards.slice();
    playCapacity = view.visibleDiscard.length + staged.length;
    render(true);
  }
  const verb = action.type === "pass" ? "PASS" : action.type === "draw" ? "DRAW" : "PLAY";
  element("automatic-title").textContent = verb;
  element("automatic-progress").style.strokeDashoffset = "1";
  element("automatic-message").textContent = `${verb === "DRAW" ? "Drawing" : verb === "PASS" ? "Passing" : "Playing"} in ${settings.automaticDelayMs / 1000} seconds`;
  automaticPanel.hidden = false;
  // Start on the first painted frame, after the table and deck have settled.
  let started: number | undefined;
  let lastBeat = -1;
  const update = (now: number) => {
    const candidate = automaticCandidate();
    if (revision !== view?.revision || candidate?.type !== action.type ||
        action.type === "play" && (candidate.type !== "play" ||
          candidate.cards.length !== action.cards.length || candidate.cards.some((card, index) => card.id !== action.cards[index]?.id))) { cancelAutomaticAction(false); return; }
    started ??= now;
    const elapsed = now - started;
    const beat = countdownBeat(elapsed);
    if (elapsed < settings.automaticDelayMs && beat !== lastBeat) { feedback.tick(); lastBeat = beat; }
    const progress = Math.min(1, elapsed / settings.automaticDelayMs);
    element("automatic-progress").style.strokeDashoffset = String(1 - progress);
    const text = `${verb === "DRAW" ? "Drawing" : verb === "PASS" ? "Passing" : "Playing"} in ${Math.ceil((1 - progress) * settings.automaticDelayMs / 1000)} seconds`;
    if (element("automatic-message").textContent !== text) element("automatic-message").textContent = text;
    if (progress < 1) { automaticFrame = requestAnimationFrame(update); return; }
    cancelAutomaticAction();
    if (action.type === "play") choosePlay(action.cards);
    else send({ type: action.type });
  };
  automaticFrame = requestAnimationFrame(update);
}

function showNotice(text: string): void {
  noticeText.textContent = text;
  notice.hidden = !text;
}

function announce(): void {
  if (!view) return;
  const rival = network ? "Opponent" : "Computer";
  if (!view.result && roundDialog.open) roundDialog.close();
  if (message) {
    showNotice(message);
    status.textContent = message;
    return;
  }
  if (view.result) {
    const result = view.matchResult ?? view.result;
    const match = !!view.matchResult;
    const title = result.winner === "tie" ? match ? "Match tied" : "Round tied" :
      result.winner === view.seat ? match ? "You win the match" : "You win" : match ? `${rival} wins the match` : `${rival} wins`;
    const points = result.winner === "tie" ? match ? "0 points" : "No points awarded" :
      `${match ? "" : "+"}${result.points} ${result.points === 1 ? "point" : "points"}`;
    element("round-title").textContent = title;
    element("round-points").textContent = points;
    const wins = element("match-rounds");
    wins.hidden = !match;
    wins.textContent = `Rounds won\nYou ${view.roundsWon[view.seat]} · ${rival} ${view.roundsWon[otherSeat(view.seat)]}`;
    showNotice("");
    status.textContent = `${title}. ${points}`;
    if (!animationTimer && announcedResultRevision !== view.revision) {
      announcedResultRevision = view.revision;
      for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
      if (menu.matches(":popover-open")) menu.hidePopover();
      roundDialog.showModal();
    }
    return;
  }
  showNotice("");
  const turn = isMyTurn() ? autoplay ? "Player AI’s turn" : "Your turn" : `${rival}’s turn`;
  const penalty = view.event?.penalty;
  if (isQueued()) {
    status.textContent = "Playing your queue";
  } else if (penalty?.count) {
    status.textContent = `${penalty.seat === view.seat ? autoplay ? "Player AI draws" : "You draw" : `${rival} draws`} ${penalty.count}. ${turn}`;
  } else if (!autoplay && isMyTurn() && !view.legalLeads.length) {
    status.textContent = view.drewThisTurn ? "No playable cards. Tap either pile to pass." : "No playable cards. Drawing.";
  } else {
    status.textContent = turn;
  }
}

function updateControls(): void {
  const drew = view?.drewThisTurn && isMyTurn();
  stockPile.disabled = !canUseStock() && !canDebugShuffle();
  discardPile.disabled = !canUseDiscard();
  stockPile.setAttribute("aria-label", staged.length ? "Clear the queued cards"
    : drew ? "Pass your turn using the deck" : "Draw from the deck");
  stockPile.title = debug ? "Double-tap to reshuffle earlier discards" : "";
  discardPile.setAttribute("aria-label", view?.result ? "Deal the next round" :
    staged.length ? `Play ${staged.length} queued ${staged.length === 1 ? "card" : "cards"}`
      : debug && !autoplay ? "Play this turn using the AI" : drew ? "Pass your turn using the discard pile" : "Discard pile");
  element("debug-controls").hidden = !debug || !!network;
  element("debug-settings").hidden = !debug || !!network;
  element<HTMLButtonElement>("test-aggressiveness").disabled = !debug || !view || !inputReady();
  element<HTMLButtonElement>("test-aggressiveness-eight").disabled = !debug || !view || !inputReady();
  autoplayCheck.disabled = !view || !!view.matchResult || shuffleLocked();
  autoplayCheck.checked = autoplay;
  element("opponent-name").textContent = network ? "Opponent" : "Computer";
  element("player-name").textContent = autoplay ? "Player AI" : "You";
  nextRound.textContent = view?.matchResult ? "New match" : "Next round";
  nextRound.disabled = !inputReady();
  restartButton.disabled = replaying || shuffleLocked();
  element<HTMLButtonElement>("open-rules").disabled = shuffleLocked();
  opponentHand.disabled = shuffleLocked();
  replayButton.disabled = !replaying && !canReplay();
  replayButton.toggleAttribute("data-replaying", replaying);
  const replayLabel = replaying ? "Skip to end of instant replay" : "Instant Replay";
  replayButton.setAttribute("aria-label", replayLabel);
  replayButton.title = replayLabel;
}

function showDanger(snapshot: TableView): void {
  table.toggleAttribute("data-danger", settings.dangerWarning && !snapshot.result &&
    snapshot.opponentCount <= settings.dangerThreshold);
}

function showTable(snapshot: TableView, queue: Card[], animate: boolean, speed = settings.animationSpeed): void {
  // Settings stay usable without repainting an in-flight shuffle or changing its speed.
  if (!replaying && animationTimer !== undefined && snapshot.event?.reshuffles?.length && paintedRevision === snapshot.revision) return;
  const opponent = otherSeat(snapshot.seat);
  const rounds = roundProgress(snapshot);
  element("round-number").textContent = `${rounds.current}/${rounds.total}`;
  element("round-number").setAttribute("aria-label", `Round ${rounds.current} of ${rounds.total}`);
  element("your-score").textContent = String(snapshot.points[snapshot.seat]);
  element("cpu-score").textContent = String(snapshot.points[opponent]);
  element("deck-value").textContent = `${snapshot.pointsPerCard} ${snapshot.pointsPerCard === 1 ? "point" : "points"} per card`;
  table.dataset.turnSide = snapshot.result ? "" : snapshot.turn === snapshot.seat ? "player" : "opponent";
  showDanger(snapshot);
  scene?.show({
    view: snapshot, staged: queue, back: deckBack, locked: autoplay || !inputReady(),
    keepGroupsTogether: settings.keepGroupsTogether,
    targetCardWidth: settings.targetCardWidth,
    dimUnplayable: settings.dimUnplayable,
    flickSettings: { ...settings },
    replaying,
    playCapacity: queue.length ? Math.max(playCapacity, snapshot.visibleDiscard.length + queue.length) : 0,
  }, animate && !reducedMotion.matches, speed);
  paintedRevision = snapshot.revision;
  table.dataset.revision = String(snapshot.revision);
  table.dataset.turn = String(snapshot.turn ?? "finished");
}

function render(animate: boolean): void {
  if (!view || replaying) return;
  announce();
  updateControls();
  showTable(view, staged.slice(), animate);
}

function replayWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}
const tableTiming = (): TableTiming => ({ ...settings, animate: !reducedMotion.matches });

function sendTiming(): void {
  worker?.postMessage(JSON.stringify({ timing: tableTiming() }));
}

async function replayOpponent(): Promise<void> {
  const replay = history.last;
  const live = view;
  if (!live || !replay || !canReplay() || !worker) return;
  cancelAutomaticAction();
  const connection = worker;
  const queue = staged.slice();
  const timing = tableTiming();
  const speed = replaySpeed(timing);
  const controller = new AbortController();
  const { signal } = controller;
  replayController = controller;
  replaying = true;
  replayShield.hidden = false;
  replayShield.focus({ preventScroll: true });
  updateControls();
  worker.postMessage(JSON.stringify({ replay: true }));
  showNotice("");
  status.textContent = "Replaying the last sequence at half speed";
  try {
    showTable(replay.before, [], false);
    await replayWait(300, signal);
    for (const [index, frame] of replay.frames.entries()) {
      if (signal.aborted) return;
      showTable(frame, [], timing.animate, speed);
      await replayWait(replayDelay(frame, timing, index < replay.frames.length - 1), signal);
    }
    if (signal.aborted) return;
    const lastFrame = replay.frames.at(-1)!;
    if (lastFrame.revision !== live.revision) showTable(live, [], false);
    if (!signal.aborted && queue.length) {
      showTable(live, queue, timing.animate, speed);
      await replayWait(timing.animate ? STAGE_FLIGHT / speed + 48 : 0, signal);
    }
  } finally {
    if (worker !== connection) return;
    replayController = undefined;
    replaying = false;
    replayShield.hidden = true;
    worker.postMessage(JSON.stringify({ replay: false }));
    render(false);
    if (canReplay()) replayButton.focus({ preventScroll: true });
  }
}

function receive(response: Response): void {
  const acknowledged = response.requestId !== undefined && response.requestId === busy;
  const command = acknowledged ? pendingCommand : undefined;
  if (acknowledged) {
    busy = undefined;
    pendingCommand = undefined;
  }
  const changed = view?.revision !== response.view.revision;
  if (changed) {
    cancelDeckTap();
    cancelAutomaticAction(false);
    canceledAutomaticRevision = undefined;
  }
  automaticActions.record(view, response.view, command);
  history.record(view, response.view);
  const playMessage = debugPlayMessage(view, response.view, debug);
  view = response.view;
  if (playMessage) showDebugToast(playMessage);
  if (view.queuedCards.length) {
    staged = view.queuedCards.flatMap(id => view!.hand.filter(card => card.id === id));
  } else if (changed && view.event?.kind !== "shuffle" && (!view.event || view.event.kind !== "draw" || view.event.seat !== view.seat || view.result)) {
    staged = [];
  }
  if (!staged.length) playCapacity = 0;
  if (changed && !replaying) {
    clearTimeout(animationTimer);
    animationTimer = undefined;
    const duration = tableAnimationTime(view, settings.animationSpeed, !reducedMotion.matches);
    if (duration) animationTimer = setTimeout(() => {
      animationTimer = undefined;
      scene?.setLocked(autoplay || !inputReady());
      render(false);
      startAutomaticAction();
    }, duration);
  }
  message = response.type === "error" ? response.message : undefined;
  render(changed);
  if (!animationTimer) startAutomaticAction();
}

function setupSettings(): void {
  try {
    settings = readSettings(JSON.parse(localStorage.getItem(settingsKey) ?? "null"));
  } catch {
    // The defaults also work when an offline browser disables storage.
  }
  const animation = element<HTMLInputElement>("animation-speed");
  const pause = element<HTMLInputElement>("ai-pause");
  const danger = element<HTMLInputElement>("danger-warning");
  const targetCardWidth = element<HTMLInputElement>("target-card-width");
  const keepGroups = element<HTMLInputElement>("keep-groups-together");
  const threshold = element<HTMLInputElement>("danger-threshold");
  const groupWild = element<HTMLInputElement>("group-except-wild");
  const groupTwo = element<HTMLInputElement>("group-except-two");
  const automaticDelay = element<HTMLInputElement>("automatic-delay");
  const checks = {
    autoPass: "auto-pass", autoPickup: "auto-pickup", autoSingle: "auto-single",
    autoSingleExcludeWild: "auto-single-exclude-wild", autoSingleExcludeTwo: "auto-single-exclude-two",
    autoSingleExcludeQueen: "auto-single-exclude-queen",
    autoSingleIgnoreExclusionsWhenOpponentEmpty: "auto-single-ignore-exclusions-when-opponent-empty",
    autoSingleSkips: "auto-single-skips", dimUnplayable: "dim-unplayable",
  } as const;
  for (const [key, id] of Object.entries(checks)) element<HTMLInputElement>(id).checked = settings[key as keyof typeof checks];
  animation.valueAsNumber = ANIMATION_SPEEDS.indexOf(settings.animationSpeed);
  pause.valueAsNumber = settings.aiPauseMs / 1000;
  danger.checked = settings.dangerWarning;
  targetCardWidth.valueAsNumber = settings.targetCardWidth;
  keepGroups.checked = settings.keepGroupsTogether;
  threshold.valueAsNumber = settings.dangerThreshold;
  groupWild.checked = settings.groupExceptWild;
  groupTwo.checked = settings.groupExceptTwo;
  automaticDelay.valueAsNumber = settings.automaticDelayMs / 1000;
  const updateLabels = () => {
    const seconds = settings.aiPauseMs / 1000;
    element("animation-speed-value").textContent = `${settings.animationSpeed}×`;
    element("ai-pause-value").textContent = `${seconds} s`;
    animation.setAttribute("aria-valuetext", `${settings.animationSpeed} times normal speed`);
    pause.setAttribute("aria-valuetext", `${seconds} ${seconds === 1 ? "second" : "seconds"}`);
    const cards = `${settings.dangerThreshold} ${settings.dangerThreshold === 1 ? "card" : "cards"}`;
    element("danger-threshold-value").textContent = cards;
    threshold.setAttribute("aria-valuetext", cards);
    threshold.disabled = !settings.dangerWarning;
    element("danger-threshold-setting").hidden = !settings.dangerWarning;
    element("target-card-width-value").textContent = `${settings.targetCardWidth} dpi`;
    targetCardWidth.setAttribute("aria-valuetext", `${settings.targetCardWidth} dpi`);
    element("auto-single-options").hidden = !settings.autoSingle;
    const cancelSeconds = settings.automaticDelayMs / 1000;
    element("automatic-delay-value").textContent = `${cancelSeconds} s`;
    automaticDelay.setAttribute("aria-valuetext", `${cancelSeconds} ${cancelSeconds === 1 ? "second" : "seconds"}`);
  };
  const updateSettings = () => {
    settings = readSettings({
      animationSpeed: ANIMATION_SPEEDS[animation.valueAsNumber],
      aiPauseMs: pause.valueAsNumber * 1000,
      dangerWarning: danger.checked,
      targetCardWidth: targetCardWidth.valueAsNumber,
      keepGroupsTogether: keepGroups.checked,
      dangerThreshold: threshold.valueAsNumber,
      groupExceptWild: groupWild.checked,
      groupExceptTwo: groupTwo.checked,
      ...Object.fromEntries(Object.entries(checks).map(([key, id]) => [key, element<HTMLInputElement>(id).checked])),
      automaticDelayMs: automaticDelay.valueAsNumber * 1000,
    });
    updateLabels();
    cancelAutomaticAction(false);
    canceledAutomaticRevision = undefined;
    sendTiming();
    if (view && !replaying) { showDanger(view); render(true); }
    try {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    } catch {
      // Changes remain available for the current game.
    }
  };
  updateLabels();
  animation.oninput = pause.oninput = threshold.oninput = automaticDelay.oninput = updateSettings;
  for (const input of [danger, groupWild, groupTwo, ...Object.values(checks).map(id => element<HTMLInputElement>(id))]) {
    input.onchange = updateSettings;
  }
  keepGroups.onchange = targetCardWidth.oninput = () => {
    updateSettings();
    render(true);
  };
  reducedMotion.addEventListener("change", sendTiming);
}

function setupDialogs(): void {
  const changed = () => {
    syncAutoplayPause();
    if (menu.matches(":popover-open") || document.querySelector("dialog[open]")) pauseAutomaticAction();
    else startAutomaticAction();
  };
  const observer = new MutationObserver(changed);
  for (const dialog of document.querySelectorAll("dialog")) observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
  menu.addEventListener("beforetoggle", event => {
    if ((event as ToggleEvent).newState === "open") {
      pauseAutomaticAction();
      if (autoplay) worker?.postMessage(JSON.stringify({ paused: true }));
    }
  });
  menu.addEventListener("toggle", changed);
  roundDialog.addEventListener("cancel", event => event.preventDefault());
  roundDialog.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
  });
  roundDialog.addEventListener("close", () => {
    if (!roundDialog.open && view?.result && busy === undefined && (networkReady || !network)) roundDialog.showModal();
  });
  element("open-rules").onclick = () => {
    menu.hidePopover();
    rulesDialog.showModal();
  };
  element("open-settings").onclick = () => {
    menu.hidePopover();
    settingsDialog.showModal();
  };
  element("network-button").onclick = () => { menu.hidePopover(); void startNetwork(); };
  element("cancel-network").onclick = () => startLocal();
  element("network-offline").onclick = () => startLocal();
  networkDialog.addEventListener("cancel", event => { event.preventDefault(); startLocal(); });
  element("copy-network").onclick = async () => {
    const input = element<HTMLInputElement>("network-link");
    try { await navigator.clipboard.writeText(input.value); element("copy-network").textContent = "Copied"; }
    catch { input.focus(); input.select(); element("network-status").textContent = "Select and copy the invitation link."; }
  };
  element("share-network").hidden = !navigator.share;
  element("share-network").onclick = async () => {
    try { await navigator.share({ title: "Crazy Eights", url: element<HTMLInputElement>("network-link").value }); } catch { /* Share can be cancelled. */ }
  };
  restartButton.onclick = () => {
    menu.hidePopover();
    cancelAutomaticAction();
    restartDialog.showModal();
  };
  element("confirm-restart").onclick = () => {
    restartDialog.close();
    send({ type: "restart" });
  };
  const testAggressiveness = (opponentCards: 1 | 8) => {
    if (network || !debug || !view || !inputReady()) return;
    if (autoplay) setAutoplay(false);
    staged = [];
    playCapacity = 0;
    settingsDialog.close();
    send({ type: "debug-aggressiveness", opponentCards });
  };
  element("test-aggressiveness").onclick = () => testAggressiveness(1);
  element("test-aggressiveness-eight").onclick = () => testAggressiveness(8);
  element("test-vibration").onclick = () => {
    if (!debug) return;
    const result = element("vibration-test-result");
    result.textContent = feedback.testVibration();
    result.hidden = false;
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>("dialog [data-close]")) {
    button.onclick = () => button.closest("dialog")?.close();
  }

  try {
    const saved = Number(localStorage.getItem("crazy-eights-back") ?? 0);
    if (Number.isInteger(saved) && DECKS[saved]) deckBack = saved;
  } catch {
    // An offline file can still be played when the browser disables storage.
  }
}

function autoplayPaused(): boolean {
  return autoplay && (menu.matches(":popover-open") || !!document.querySelector("dialog[open]"));
}

function syncAutoplayPause(): void {
  worker?.postMessage(JSON.stringify({ paused: autoplayPaused() }));
}

function setAutoplay(enabled: boolean): void {
  autoplay = enabled && debug;
  cancelAutomaticAction();
  const clear = autoplay && staged.length > 0 && !isQueued();
  const holdMs = clear && !reducedMotion.matches ? STAGE_FLIGHT / settings.animationSpeed + 48 : 0;
  if (clear) { staged = []; playCapacity = 0; }
  worker?.postMessage(JSON.stringify({ autoplay, paused: autoplayPaused(), holdMs }));
  if (clear) render(true);
  else { announce(); updateControls(); scene?.setLocked(autoplay || !inputReady()); }
}

function toggleDebug(): void {
  if (network) return;
  if (replaying || shuffleLocked()) return;
  cancelDeckTap();
  debug = !debug;
  worker?.postMessage(JSON.stringify({ debug }));
  if (!debug && autoplay) setAutoplay(false);
  updateControls();
  showDebugStatus();
}

function showDebugStatus(): void {
  showDebugToast(`Debug mode ${debug ? "on" : "off"}`);
}

function setupDebug(): void {
  let lastTouch = { time: -Infinity, x: 0, y: 0 };
  let toggledAt = -Infinity;
  opponentHand.onpointerup = event => {
    if (event.pointerType === "mouse") return;
    const now = performance.now();
    if (now - lastTouch.time <= 450 && Math.hypot(event.clientX - lastTouch.x, event.clientY - lastTouch.y) <= 30) {
      toggledAt = now;
      lastTouch.time = -Infinity;
      toggleDebug();
    } else lastTouch = { time: now, x: event.clientX, y: event.clientY };
  };
  opponentHand.ondblclick = () => {
    if (performance.now() - toggledAt > 500) toggleDebug();
  };
  const reshuffle = () => {
    cancelDeckTap();
    if (canDebugShuffle()) send({ type: "debug-reshuffle" });
  };
  // Defer debug single taps so the first half of a double tap never draws or clears a play.
  stockPile.onpointerup = event => {
    if (!canDebugShuffle()) return;
    const now = performance.now();
    const twice = now - lastDeckTap.time <= 450 &&
      Math.hypot(event.clientX - lastDeckTap.x, event.clientY - lastDeckTap.y) <= 30;
    cancelAutomaticAction();
    if (twice) { reshuffle(); return; }
    cancelDeckTap();
    lastDeckTap = { time: now, x: event.clientX, y: event.clientY };
    const revision = view?.revision;
    worker?.postMessage(JSON.stringify({ holdMs: 450 }));
    deckTapTimer = setTimeout(() => {
      cancelDeckTap();
      if (revision === view?.revision && !menu.matches(":popover-open") && !document.querySelector("dialog[open]")) drawOrPass();
    }, 450);
  };
  stockPile.ondblclick = reshuffle;
  stockPile.onclick = event => {
    if (!debug || event.detail === 0) drawOrPass();
  };
  autoplayCheck.onchange = () => setAutoplay(autoplayCheck.checked);
}

async function start(): Promise<void> {
  setupDialogs();
  setupSettings();
  feedback.setup();
  setupPwa();
  setupDebug();
  if (debug) showDebugStatus();
  discardPile.onclick = confirmPlay;
  nextRound.onclick = () => {
    if (!view?.result || !inputReady()) return;
    roundDialog.close();
    send({ type: view.matchResult ? "restart" : "next-round" });
  };

  element("cancel-automatic").onclick = () => cancelAutomaticAction();
  table.addEventListener("contextmenu", event => event.preventDefault());
  table.addEventListener("selectstart", event => event.preventDefault());
  menuShield.onpointerup = menuShield.onclick = () => {
    if (menu.matches(":popover-open")) menu.hidePopover();
  };
  replayShield.onpointerdown = replayShield.onclick = () => replayController?.abort();
  replayShield.onkeydown = event => {
    if (event.key === "Escape") replayController?.abort();
  };
  replayButton.onclick = () => {
    if (replaying) replayController?.abort();
    else void replayOpponent();
  };
  const [images] = await Promise.all([loadCardArt(), document.fonts.load("700 14px Barlow Condensed")]);
  const incomingInvitation = invitationFromHash(location.hash);
  startLocal(false);

  const density = Math.min(window.devicePixelRatio || 1, 3);
  scene = new CardTable(table, element("card-targets"), stockPile, discardPile, replayButton, automaticPanel, opponentHand, {
    tapCard, flickCard, playQueue: confirmPlay, clearPlay, suitTick: sound => feedback.suitTick(sound),
    fireRumble: duration => feedback.fireRumble(duration), stopFireRumble: () => feedback.stopFireRumble(),
    tableSlam: (score, shakeMs) => feedback.tableSlam(score, shakeMs),
    stopImpactVibration: () => feedback.stopImpactVibration(),
    powerPulse: (score, intensity) => feedback.powerPulse(score, intensity),
    stopPowerSounds: () => feedback.stopPowerSounds(),
    ready: () => {
      if (incomingInvitation) void startNetwork(incomingInvitation);
      else send({ type: "snapshot" });
    },
  }, images, density);
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    transparent: true,
    scale: { mode: Phaser.Scale.NONE, width: parent.clientWidth, height: parent.clientHeight, autoRound: true },
    input: { mouse: false, touch: false, keyboard: false },
    scene,
  });
}

function resetSession(): void {
  replayController?.abort();
  replayController = undefined;
  replaying = false;
  replayShield.hidden = true;
  cancelDeckTap();
  cancelAutomaticAction();
  clearTimeout(animationTimer);
  animationTimer = undefined;
  worker?.terminate();
  worker = undefined;
  network = undefined;
  networkReady = false;
  view = undefined;
  busy = pendingCommand = undefined;
  staged = [];
  playCapacity = 0;
  autoplay = false;
  history.reset();
  announcedResultRevision = paintedRevision = undefined;
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
}

function startLocal(snapshot = true): void {
  ++networkGeneration;
  resetSession();
  history.network = false;
  window.history.replaceState(null, "", location.pathname + location.search);
  worker = new LocalServer();
  bindConnection();
  worker.postMessage(JSON.stringify({ debug }));
  sendTiming();
  if (snapshot) send({ type: "snapshot" });
}

async function startNetwork(invite?: Invitation): Promise<void> {
  const generation = ++networkGeneration;
  resetSession();
  debug = false;
  history.network = true;
  element("network-invitation").hidden = true;
  element("network-diagnostics").textContent = "";
  element("network-offline").hidden = true;
  element("cancel-network").hidden = false;
  element("copy-network").textContent = "Copy link";
  element("network-status").textContent = invite ? "Connecting to the host…" : "Creating invitation…";
  networkDialog.showModal();
  const invitation = invite ?? { room: crypto.randomUUID(), password: crypto.randomUUID(), host: "" };
  try {
    const connection = new NetworkConnection(invite ? undefined : new LocalServer(), invitation, {
      connected: () => {
        if (generation !== networkGeneration) return;
        networkReady = true;
        networkDialog.close();
        sendTiming();
      },
      disconnected: text => {
        if (generation !== networkGeneration) return;
        networkReady = false;
        replayController?.abort();
        cancelAutomaticAction();
        busy = pendingCommand = undefined;
        for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
        element("network-status").textContent = text;
        element("network-invitation").hidden = true;
        element("cancel-network").hidden = true;
        element("network-offline").hidden = false;
        networkDialog.showModal();
        updateControls();
        scene?.setLocked(true);
      },
      problem: text => { if (generation === networkGeneration) element("network-status").textContent = text; },
      diagnostics: text => { if (generation === networkGeneration) element("network-diagnostics").textContent = text; },
    });
    network = connection;
    worker = connection;
    bindConnection();
    sendTiming();
    if (!invite) {
      const created = await connection.getInvitation();
      if (generation !== networkGeneration) return;
      element<HTMLInputElement>("network-link").value = invitationUrl(location.href, created);
      element("network-invitation").hidden = false;
      element("network-status").textContent = "Waiting for your opponent…";
    }
    updateControls();
  } catch (error) {
    if (generation !== networkGeneration) return;
    worker?.terminate();
    element("network-status").textContent = "Couldn’t start the connection. Check your internet connection and try again.";
    console.error(error);
  }
}

function bindConnection(): void {
  const connection = worker!;
  connection.onmessage = ({ data }) => {
    if (worker !== connection) return;
    if (replaying) replayController?.abort();
    receive(JSON.parse(data) as Response);
  };
  connection.onerror = () => {
    if (worker !== connection) return;
    cancelAutomaticAction();
    stockPile.disabled = true;
    discardPile.disabled = true;
    const error = "The game couldn’t continue. Reload to try again.";
    showNotice(error);
    status.textContent = error;
  };

}

void start().catch(error => {
  const message = "The table couldn’t load. Reload to try again.";
  showNotice(message);
  status.textContent = message;
  console.error(error);
});
