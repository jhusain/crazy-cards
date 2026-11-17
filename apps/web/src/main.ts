import Phaser from "phaser";
import {
  PLAY_SLOTS, canFollowInQueue, otherSeat, skipsOpponent, wildSuitOptions,
  type Card, type Command, type Request, type Response, type Suit, type TableView,
} from "@crazy-eights/protocol";
import { DECKS, SUIT_SYMBOL, loadCardArt, suitLabel } from "./cards.ts";
import { shouldPlayFlick } from "./card-gesture.ts";
import { OpponentReplay } from "./opponent-replay.ts";
import { ANIMATION_SPEEDS, DEFAULT_SETTINGS, readSettings, type GameSettings } from "./settings.ts";
import { CardTable } from "./table.ts";
import { replayDelay, replaySpeed, STAGE_FLIGHT, tableAnimationTime, type TableTiming } from "./table-timing.ts";
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
const stockPile = element<HTMLButtonElement>("stock-pile");
const tableBackground = element<HTMLButtonElement>("table-background");
const discardPile = element<HTMLButtonElement>("discard-pile");
const suitDialog = element<HTMLDialogElement>("suit-dialog");
const rulesDialog = element<HTMLDialogElement>("rules-dialog");
const deckDialog = element<HTMLDialogElement>("deck-dialog");
const settingsDialog = element<HTMLDialogElement>("settings-dialog");
const restartDialog = element<HTMLDialogElement>("restart-dialog");
const replayButton = element<HTMLButtonElement>("replay-button");
const restartButton = element<HTMLButtonElement>("restart-button");
const menu = element("game-menu");
const menuShield = element<HTMLButtonElement>("menu-shield");
const replayShield = element<HTMLButtonElement>("replay-shield");
const history = new OpponentReplay();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const settingsKey = "crazy-eights-settings";
let settings: GameSettings = { ...DEFAULT_SETTINGS };
let replaying = false;
let replayController: AbortController | undefined;
let animationTimer: ReturnType<typeof setTimeout> | undefined;
let view: TableView | undefined;
let staged: Card[] = [];
let deckBack = 0;
let busy: number | undefined;
let requestId = 0;
let message: string | undefined;
let worker: Worker | undefined;
let scene: CardTable | undefined;

function send(command: Command): number | undefined {
  if (busy !== undefined || !worker || replaying) return;
  const request: Request = { requestId: ++requestId, revision: view?.revision ?? 0, command };
  busy = request.requestId;
  message = undefined;
  worker.postMessage(JSON.stringify(request));
  updateControls();
  return request.requestId;
}

const isMyTurn = () => view !== undefined && view.turn === view.seat;
const isQueued = () => !!view?.queuedCards.length;
const inputReady = () => !replaying && busy === undefined && animationTimer === undefined;
const canUseStock = () => inputReady() && isMyTurn() && !isQueued();
const canUseDiscard = () => inputReady() && (!!view?.result || isMyTurn() && !isQueued() && (staged.length > 0 || !!view?.drewThisTurn));
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
  render(true);
}

function flickCard(id: number): void {
  if (!view || !canUseStock()) return;
  const card = view.hand.find(candidate => candidate.id === id);
  if (!card) return;
  const direct = !staged.length && shouldPlayFlick(card, view.hand, view.legalLeads, settings.alwaysPlayWild);
  if (direct && (view.opponentCount > 0 || skipsOpponent(card))) {
    choosePlay([card], true);
    return;
  }
  if (view.opponentCount === 0 && card.special !== "pickup" && card.special !== "super-pickup") {
    const companions = view.hand.filter(other => other.rank === card.rank && other.id !== card.id &&
      !staged.some(queued => queued.id === other.id));
    const queue = validQueue([...staged, card], view);
    if (queue.includes(card) && staged.length < PLAY_SLOTS) {
      staged = [...queue, ...companions].slice(0, PLAY_SLOTS);
      message = undefined;
      render(true);
    } else tapCard(id);
  } else if (direct) choosePlay([card], true);
  else tapCard(id);
}

function clearPlay(): void {
  if (!canUseStock() || !staged.length) return;
  staged = [];
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
  const buttons = suits.map(suit => {
    const button = document.createElement("button");
    button.className = "suit-choice";
    if (suit === "hearts" || suit === "diamonds") button.dataset.red = "";
    const symbol = document.createElement("b");
    symbol.textContent = SUIT_SYMBOL[suit];
    symbol.setAttribute("aria-hidden", "true");
    button.append(symbol, suitLabel(suit));
    button.onclick = () => {
      suitDialog.close();
      submit(suit);
    };
    return button;
  });
  element("suit-buttons").replaceChildren(...buttons);
  suitDialog.showModal();
}

function confirmPlay(): void {
  if (!view || !canUseDiscard()) return;
  if (view.result) send({ type: "next-round" });
  else if (!staged.length) send({ type: "pass" });
  else choosePlay(staged.slice());
}

function showNotice(text: string, result = false): void {
  noticeText.textContent = text;
  notice.hidden = !text;
  notice.toggleAttribute("data-result", result);
  nextRound.hidden = !result;
}

function announce(): void {
  if (!view) return;
  if (message) {
    showNotice(message);
    status.textContent = message;
    return;
  }
  if (view.result) {
    const result = view.result.winner === "tie" ? "Round tied" :
      `${view.result.winner === view.seat ? "You win" : "Computer wins"} · +${view.result.points} points`;
    showNotice(result, true);
    status.textContent = result;
    return;
  }
  showNotice("");
  const turn = isMyTurn() ? "Your turn" : "Computer’s turn";
  const penalty = view.event?.penalty;
  if (isQueued()) {
    status.textContent = "Playing your queue";
  } else if (penalty?.count) {
    status.textContent = `${penalty.seat === view.seat ? "You draw" : "Computer draws"} ${penalty.count}. ${turn}`;
  } else if (isMyTurn() && !view.legalLeads.length) {
    status.textContent = view.drewThisTurn ? "No playable cards. Passing." : "No playable cards. Drawing.";
  } else {
    status.textContent = turn;
  }
}

function updateControls(): void {
  const drew = view?.drewThisTurn && isMyTurn();
  stockPile.disabled = !canUseStock();
  tableBackground.disabled = stockPile.disabled;
  discardPile.disabled = !canUseDiscard();
  stockPile.setAttribute("aria-label", staged.length ? "Clear the queued cards"
    : drew ? "Pass your turn using the deck" : "Draw from the deck");
  tableBackground.setAttribute("aria-label", staged.length ? "Clear play" : drew ? "Pass turn" : "Draw a card");
  discardPile.setAttribute("aria-label", view?.result ? "Deal the next round" :
    staged.length ? `Play ${staged.length} queued ${staged.length === 1 ? "card" : "cards"}`
      : drew ? "Pass your turn using the discard pile" : "Discard pile");
  nextRound.disabled = !inputReady();
  restartButton.disabled = replaying;
  replayButton.disabled = !canReplay();
}

function showDanger(snapshot: TableView): void {
  table.toggleAttribute("data-danger", settings.dangerWarning && !snapshot.result &&
    snapshot.opponentCount <= settings.dangerThreshold);
}

function showTable(snapshot: TableView, queue: Card[], animate: boolean, speed = settings.animationSpeed): void {
  const opponent = otherSeat(snapshot.seat);
  element("round-number").textContent = `Round ${snapshot.round}`;
  element("your-score").textContent = String(snapshot.points[snapshot.seat]);
  element("cpu-score").textContent = String(snapshot.points[opponent]);
  table.dataset.turnSide = snapshot.result ? "" : snapshot.turn === snapshot.seat ? "player" : "opponent";
  showDanger(snapshot);
  scene?.show({
    view: snapshot, staged: queue, back: deckBack, locked: !inputReady(), pickup: settings.pickupAnimation,
  }, animate && !reducedMotion.matches, speed);
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
  const queue = staged.slice();
  const draw = history.voluntaryDraw?.after.revision === live.revision ? history.voluntaryDraw : undefined;
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
    if (draw) {
      if (lastFrame.revision !== draw.before.revision) showTable(draw.before, [], false);
      showTable(draw.after, [], timing.animate, speed);
      await replayWait(replayDelay(draw.after, timing, false), signal);
    } else if (lastFrame.revision !== live.revision) {
      showTable(live, [], false);
    }
    if (!signal.aborted && queue.length) {
      showTable(live, queue, timing.animate, speed);
      await replayWait(timing.animate ? STAGE_FLIGHT / speed + 48 : 0, signal);
    }
  } finally {
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
  if (acknowledged) busy = undefined;
  const changed = view?.revision !== response.view.revision;
  history.record(view, response.view);
  view = response.view;
  if (view.queuedCards.length) {
    staged = view.queuedCards.flatMap(id => view!.hand.filter(card => card.id === id));
  } else if (changed && (!view.event || view.event.kind !== "draw" || view.event.seat !== view.seat || view.result)) {
    staged = [];
  }
  if (changed && !replaying) {
    clearTimeout(animationTimer);
    animationTimer = undefined;
    const duration = tableAnimationTime(view, settings.animationSpeed, !reducedMotion.matches, settings.pickupAnimation);
    if (duration) animationTimer = setTimeout(() => {
      animationTimer = undefined;
      scene?.setLocked(!inputReady());
      updateControls();
    }, duration);
  }
  message = response.type === "error" ? response.message : undefined;
  render(changed);
}

function setupSettings(): void {
  try {
    settings = readSettings(JSON.parse(localStorage.getItem(settingsKey) ?? "null"));
  } catch {
    // The defaults also work when an offline browser disables storage.
  }
  const animation = element<HTMLInputElement>("animation-speed");
  const pause = element<HTMLInputElement>("ai-pause");
  const pickup = element<HTMLSelectElement>("pickup-animation");
  const danger = element<HTMLInputElement>("danger-warning");
  const threshold = element<HTMLInputElement>("danger-threshold");
  const alwaysWild = element<HTMLInputElement>("always-play-wild");
  animation.valueAsNumber = ANIMATION_SPEEDS.indexOf(settings.animationSpeed);
  pause.valueAsNumber = settings.aiPauseMs / 1000;
  pickup.value = settings.pickupAnimation;
  danger.checked = settings.dangerWarning;
  threshold.valueAsNumber = settings.dangerThreshold;
  alwaysWild.checked = settings.alwaysPlayWild;
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
  };
  const updateSettings = () => {
    settings = readSettings({
      animationSpeed: ANIMATION_SPEEDS[animation.valueAsNumber],
      aiPauseMs: pause.valueAsNumber * 1000,
      pickupAnimation: pickup.value,
      dangerWarning: danger.checked,
      dangerThreshold: threshold.valueAsNumber,
      alwaysPlayWild: alwaysWild.checked,
    });
    updateLabels();
    sendTiming();
    if (view && !replaying) showDanger(view);
    try {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    } catch {
      // Changes remain available for the current game.
    }
  };
  updateLabels();
  animation.oninput = pause.oninput = threshold.oninput = updateSettings;
  pickup.onchange = danger.onchange = alwaysWild.onchange = updateSettings;
  reducedMotion.addEventListener("change", sendTiming);
}

function setupDialogs(): void {
  element("open-rules").onclick = () => {
    menu.hidePopover();
    rulesDialog.showModal();
  };
  element("open-deck").onclick = () => {
    menu.hidePopover();
    deckDialog.showModal();
  };
  element("open-settings").onclick = () => {
    menu.hidePopover();
    settingsDialog.showModal();
  };
  restartButton.onclick = () => restartDialog.showModal();
  element("confirm-restart").onclick = () => {
    restartDialog.close();
    send({ type: "restart" });
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
  const backOptions = DECKS.map((option, index) => {
    const button = document.createElement("button");
    button.className = "back-choice";
    button.setAttribute("aria-pressed", String(index === deckBack));
    const picture = option.art ? document.createElement("img") : document.createElement("span");
    if (picture instanceof HTMLImageElement) {
      picture.src = option.art!;
      picture.alt = "";
    } else picture.className = "back-pattern";
    button.append(picture, option.name);
    button.onclick = () => {
      deckBack = index;
      try {
        localStorage.setItem("crazy-eights-back", String(index));
      } catch {
        // The selected art is still available for the current page.
      }
      backOptions.forEach((choice, i) => choice.setAttribute("aria-pressed", String(i === index)));
      render(false);
    };
    return button;
  });
  element("deck-options").replaceChildren(...backOptions);
}

async function start(): Promise<void> {
  setupDialogs();
  setupSettings();
  discardPile.onclick = confirmPlay;
  stockPile.onclick = drawOrPass;
  tableBackground.onclick = drawOrPass;
  nextRound.onclick = confirmPlay;
  table.addEventListener("contextmenu", event => event.preventDefault());
  table.addEventListener("selectstart", event => event.preventDefault());
  menuShield.onpointerup = menuShield.onclick = () => {
    if (menu.matches(":popover-open")) menu.hidePopover();
  };
  replayShield.onpointerdown = replayShield.onclick = () => replayController?.abort();
  replayShield.onkeydown = event => {
    if (event.key === "Escape") replayController?.abort();
  };
  replayButton.onclick = () => { void replayOpponent(); };
  const [images] = await Promise.all([loadCardArt(), document.fonts.load("700 14px Barlow Condensed")]);
  worker = new LocalServer();
  sendTiming();
  worker.onmessage = ({ data }: MessageEvent<string>) => receive(JSON.parse(data) as Response);
  worker.onerror = () => {
    stockPile.disabled = true;
    tableBackground.disabled = true;
    discardPile.disabled = true;
    const error = "The game couldn’t continue. Reload to try again.";
    showNotice(error);
    status.textContent = error;
  };

  const density = Math.min(window.devicePixelRatio || 1, 3);
  scene = new CardTable(table, element("card-targets"), stockPile, discardPile, {
    tapCard, flickCard, playQueue: confirmPlay, clearPlay,
    ready: () => send({ type: "snapshot" }),
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

void start().catch(error => {
  const message = "The table couldn’t load. Reload to try again.";
  showNotice(message);
  status.textContent = message;
  console.error(error);
});
