import Phaser from "phaser";
import { PLAY_SLOTS, canFollowInQueue, otherSeat, wildSuitOptions, type Card, type TableView } from "@crazy-eights/protocol";
import { CardTextures, describeCard, loadCardArt, type FaceTexture } from "./cards.ts";
import { shuffleFrame } from "./shuffle-animation.ts";
import { wildReel, wildReelSounds } from "./wild-reel.ts";
import { arrivalProgress, slamDescent, slamFlight, slamPlayFlight, slamShadow, impactEnvelope, scatteredCard, tableShock } from "./play-impact.ts";
import { chargePalette, chargePulseThresholds, powerCharge } from "./power-charge.ts";
import { cardDropRegion, flickPlay, flickPlayableCards, isCardDrag, isUpwardFlick, queuedCardFlick, type FlickSettings } from "./card-gesture.ts";
import { CardClicks } from "./card-click.ts";
import { sortVisibleHand, type HandSortingStrategy } from "./hand-sorting.ts";
import {
  ART_HEIGHT, ART_WIDTH, CARD_DEPTH, HAND_FADE_WIDTH, PILE_STEP, artHeight, planTableLayout, opponentPositions, playLandingPositions,
  committedFromPlay, collapsePlayPositions, automaticActionPosition, replayPosition, stockLayerCount, tableLayout, type CardPosition, type QueuedPileSlots,
} from "./table-layout.ts";
import {
  HAND_DEAL, HAND_DRAW, OPPONENT_DEAL, PLAY_FLIGHT, PLAY_TIME, STAGE_FLIGHT, drawTimeline, handReadinessTimeline, playPhases, playReflow, opponentWildPlay, shakeDuration,
} from "./table-timing.ts";

type Layout = ReturnType<typeof tableLayout>;
type PlayPhases = ReturnType<typeof playPhases>;
// A card owns its layers, so its paper and ink always move and overlap as one unit.
class CardImage extends Phaser.GameObjects.Container {
  private readonly layers: Phaser.GameObjects.Image[];
  private readonly grayPaper?: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, texture: string | FaceTexture) {
    const keys = typeof texture === "string" ? [texture] : [texture.paper, texture.grayPaper, texture.ink];
    const layers = keys.map(key => scene.add.image(0, 0, key).setOrigin(0));
    super(scene, 0, 0, layers);
    this.layers = layers;
    if (typeof texture !== "string") this.grayPaper = layers[1]!.setAlpha(0);
    scene.add.existing(this);
  }

  setPaperShade(value: number): void {
    this.grayPaper?.setAlpha(value);
  }

  setCrop(x: number, y: number, width: number, height: number): void {
    for (const layer of this.layers) layer.setCrop(x, y, width, height);
  }
}
type BoardState = {
  handSortingStrategy: HandSortingStrategy;
  flickSettings: FlickSettings;
  view: TableView; staged: Card[]; back: number; locked: boolean; targetCardWidth: number; keepGroupsTogether: boolean; dimUnplayable: boolean; replaying: boolean; playCapacity?: number;
};
type Controls = {
  tapCard: (id: number) => void; flickCard: (id: number) => void;
  dropCards: (ids: number[], destination: "discard" | "play") => void;
  beginDeckDraw: () => boolean; releaseDeckDraw: (destination?: "discard" | "play") => void; deckClick: () => void;
  playQueue: () => void; clearPlay: () => void; ready: () => void; suitTick?: (sound: "tick" | "click") => void;
  fireRumble?: (durationMs: number) => void; stopFireRumble?: () => void;
  tableSlam?: (score: number, shakeMs: number) => void; stopImpactVibration?: () => void;
  powerPulse?: (score: number, intensity: number) => void; stopPowerSounds?: () => void;
};
type CardTarget = { card: Card; position: CardPosition; dimmed: boolean; staged: boolean; depth: number };
type Arrival = { image: CardImage; position: CardPosition; id?: number };
type DrawTimeline = ReturnType<typeof drawTimeline>;
type ReflowFrame = (progress: number) => void;
type RegisterReflow = (frame: ReflowFrame) => void;

const at = (x: number, y: number, width: number): CardPosition => ({ x, y, width });
const lerp = Phaser.Math.Linear;
const ease = Phaser.Math.Easing.Sine.InOut;
const unit = (value: number) => Phaser.Math.Clamp(value, 0, 1);
const samePosition = (a: CardPosition | undefined, b: CardPosition) =>
  a?.x === b.x && a.y === b.y && a.width === b.width;

function between(from: CardPosition, to: CardPosition, t: number, lift = 0): CardPosition {
  return {
    x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) - Math.sin(Math.PI * t) * lift,
    width: lerp(from.width, to.width, t),
    clipWidth: lerp(from.clipWidth ?? from.width, to.clipWidth ?? to.width, t),
    clipHeight: lerp(from.clipHeight ?? artHeight(from.width), to.clipHeight ?? artHeight(to.width), t),
  };
}

export class CardTable extends Phaser.Scene {
  private art!: CardTextures;
  private state?: BoardState;
  private cardClicks = new CardClicks();
  private stockDrag?: { pointer: number; x: number; y: number; home: CardPosition; position: CardPosition; image: CardImage; card?: Card; released: boolean };
  private stockDrawOrigin?: { id: number; position: CardPosition };
  private cardImages = new Map<number, CardImage>();
  private dragged = new Map<number, { image: CardImage; home: CardPosition; depth: number }>();
  private dragReturn?: Phaser.Tweens.Tween;
  private cancelPointer?: () => void;
  private priorCardPositions = new Map<number, CardPosition>();
  private priorCardShades = new Map<number, number>();
  private priorHandDepths = new Map<number, number>();
  private priorStockPosition?: CardPosition;
  private stagingFlights = new Set<number>();
  private queuedSlots?: Omit<QueuedPileSlots, "playedCount"> & { round: number; ids: number[] };
  private painting = false;
  private deferResize = false;
  private resizePending = false;
  private speed = 1;
  private textureDensity: number;
  private priorLayout?: Layout;
  private layoutWidth = 0;
  private layoutHeight = 0;
  private handEdge = Infinity;
  private handBottom = Infinity;
  private impactCards: { image: CardImage; home: CardPosition; id?: number }[] = [];
  private impact?: { origin: CardPosition; timing: PlayPhases; score: number };

  constructor(
    private readonly board: HTMLElement,
    private readonly cardTargets: HTMLElement,
    private readonly stockButton: HTMLButtonElement,
    private readonly discardButton: HTMLButtonElement,
    private readonly replayButton: HTMLButtonElement,
    private readonly automaticPanel: HTMLElement,
    private readonly opponentButton: HTMLButtonElement,
    private readonly controls: Controls,
    private readonly images: Awaited<ReturnType<typeof loadCardArt>>,
    private readonly density: number,
  ) {
    super("card-table");
    this.textureDensity = Math.ceil(density);
  }

  create(): void {
    this.art = new CardTextures(this.textures, this.images, this.textureDensity);
    this.bindStockGesture();
    this.cameras.main.setOrigin(0);
    const resize = () => {
      if (this.deferResize || this.stockDrag) { this.resizePending = true; return; }
      this.paint();
    };
    const observer = new ResizeObserver(() => {
      if (this.board.clientWidth !== this.layoutWidth || this.board.clientHeight !== this.layoutHeight) resize();
    });
    observer.observe(this.board);
    window.addEventListener("resize", resize);
    this.events.once("shutdown", () => {
      this.controls.stopFireRumble?.();
      this.controls.stopImpactVibration?.();
      this.controls.stopPowerSounds?.();
      this.board.style.removeProperty("transform");
      this.cardClicks.cancel();
      this.controls.releaseDeckDraw();
      observer.disconnect();
      window.removeEventListener("resize", resize);
    });
    this.paint();
    this.controls.ready();
  }

  show(state: BoardState, animate: boolean, speed: number): void {
    const previous = this.state;
    this.state = state;
    this.speed = speed;
    if (this.art) { this.deferResize = false; this.resizePending = false; this.paint(previous, animate); }
  }

  setLocked(locked: boolean): void {
    if (!this.state) return;
    this.state.locked = locked;
    if (locked) this.cardClicks.cancel();
    const enabled = this.cardsEnabled(this.state.view);
    for (const button of this.cardTargets.querySelectorAll("button")) button.disabled = !enabled;
  }

  private paint(previous?: BoardState, animate = false): void {
    if (this.painting) return;
    this.painting = true;
    try {
      this.controls.stopFireRumble?.();
      this.controls.stopImpactVibration?.();
      this.controls.stopPowerSounds?.();
      this.cardClicks.cancel();
      this.cancelPointer?.();
      this.cancelPointer = undefined;
      this.dragged.clear();
      this.dragReturn = undefined;
      this.cardImages.clear();
      this.tweens.killAll();
      this.board.style.removeProperty("transform");
      this.impactCards = [];
      this.impact = undefined;
      delete this.board.dataset.wildReel;
      delete this.board.dataset.wildPhase;
      this.children.removeAll(true);
      this.stockDrag = undefined;
      const { view, staged = [], back = 0 } = this.state ?? {};
      const stagedIds = new Set(staged.map(card => card.id));
      const committedIds = new Set(view?.queuedCards);
      const cards = sortVisibleHand(
        (view?.hand ?? []).filter(card => !committedIds.has(card.id)),
        this.state?.handSortingStrategy ?? "default",
      );
      const width = this.board.clientWidth;
      // Reserve the original slots while editing a play. Once committed, reserve
      // the final hand slots even when the server is still executing later groups.
      const targetCardWidth = this.state?.targetCardWidth ?? 240;
      const height = this.board.clientHeight;
      if (!width || !height) return;
      const queued = view?.queuedCards ?? [];
      const held = this.queuedSlots;
      if (!queued.length) {
        this.queuedSlots = undefined;
      } else if (!held || held.round !== view!.round ||
          !queued.every((id, index) => held.ids[held.ids.length - queued.length + index] === id)) {
        const source = previous?.view.round === view!.round && queued.every((id, index) =>
          previous.staged[previous.staged.length - queued.length + index]?.id === id) ? previous : this.state!;
        this.queuedSlots = {
          round: view!.round, ids: source.staged.map(card => card.id),
          discardCount: source.view.visibleDiscard.length, playCount: source.staged.length,
          playCapacity: source.playCapacity ?? source.view.visibleDiscard.length + source.staged.length,
        };
      }
      this.layoutWidth = width;
      this.layoutHeight = height;
      const density = Math.min(this.density, 4096 / Math.max(width, height));
      const pixelWidth = Math.round(width * density);
      const pixelHeight = Math.round(height * density);
      if (pixelWidth !== this.scale.gameSize.width || pixelHeight !== this.scale.gameSize.height) {
        this.scale.resize(pixelWidth, pixelHeight);
      }
      this.cameras.main.setZoom(pixelWidth / width, pixelHeight / height);
      const { layout: plannedLayout, hand: plan } = planTableLayout(width, height, {
        cards, target: targetCardWidth, keepGroups: this.state?.keepGroupsTogether ?? true,
        stockCount: view?.stockCount, discardCount: view?.visibleDiscard.length,
        playCount: staged.length, playCapacity: this.state?.playCapacity,
        queuedSlots: this.queuedSlots && { ...this.queuedSlots, playedCount: this.queuedSlots.ids.length - queued.length },
        heldLayout: this.priorLayout,
      });
      const priorLayout = this.priorLayout;
      const frozen = queued.length && priorLayout?.tableWidth === width && priorLayout.tableHeight === height
        ? priorLayout : undefined;
      // A queue prefix changes the discard's contents, but the remaining
      // staged cards and both hands retain their actual on-screen slots.
      const layout = frozen ? {
        ...frozen,
        piles: {
          stock: frozen.piles.stock,
          discard: collapsePlayPositions(frozen.piles.discard[0]!, view!.visibleDiscard.length),
          play: staged.map((card, index) => this.priorCardPositions.get(card.id) ?? plannedLayout.piles.play[index]!),
        },
      } : plannedLayout;
      this.priorLayout = layout;
      const motion = animate && previous?.view.revision !== view?.revision;
      const priorRound = previous?.view.round === view?.round && view?.event !== null ? previous?.view : undefined;
      const reflow = motion && priorRound && priorLayout && view ? playReflow(view) : undefined;
      const reflowFrames: ReflowFrame[] = [];
      const registerReflow: RegisterReflow | undefined = reflow ? frame => {
        frame(0);
        reflowFrames.push(frame);
      } : undefined;
      const returnFrames: ReflowFrame[] = [];
      const registerReturn: RegisterReflow | undefined = reflow && reflow.start > reflow.landing
        ? frame => returnFrames.push(frame) : undefined;
      const handSlots = frozen ? cards.map((card, index) =>
        this.priorCardPositions.get(card.id) ?? plan.positions[index]!) : plan.positions;
      const largestCard = Math.max(layout.pileWidth, ...handSlots.map(position => position.width));
      const textureDensity = Math.min(Math.floor(4096 / ART_HEIGHT),
        Math.ceil(this.density * Math.max(1, largestCard / ART_WIDTH)));
      if (textureDensity !== this.textureDensity) {
        this.art.destroy();
        this.textureDensity = textureDensity;
        this.art = new CardTextures(this.textures, this.images, textureDensity);
      }
      const stock = layout.piles.stock;
      const felt = this.add.graphics().setDepth(-1);
      const bounds = this.board.getBoundingClientRect();
      const original = reflow && priorLayout ? priorLayout : layout;
      const placeTable = (progress: number) => {
        const pileY = lerp(original.pileY, layout.pileY, progress);
        const pileHeight = lerp(original.pileHeight, layout.pileHeight, progress);
        const stockHeight = lerp(original.stockHeight, layout.stockHeight, progress);
        const handY = lerp(original.handY, layout.handY, progress);
        this.drawFelt(felt, width, pileY, pileHeight);
        this.updateHandMask(layout, handY, pixelHeight);
        this.board.style.setProperty("--turn-split", pileY + pileHeight * .53 + "px");
        this.board.style.setProperty("--notice-y", lerp(original.noticeY, layout.noticeY, progress) + "px");
        this.board.style.setProperty("--pile-center-x", bounds.left + width / 2 + "px");
        this.board.style.setProperty("--pile-center-y", bounds.top + pileY + stockHeight / 2 + "px");
        this.board.style.setProperty("--pile-row-height", stockHeight + "px");
        this.board.style.setProperty("--pile-row-width", width + "px");
        this.positionButton(this.replayButton, between(replayPosition(original), replayPosition(layout), progress));
        const panel = between(automaticActionPosition(original), automaticActionPosition(layout), progress);
        this.positionButton(this.automaticPanel, panel);
        this.automaticPanel.style.setProperty("--automatic-card-width", panel.width + "px");
      };
      if (registerReflow) registerReflow(placeTable);
      else placeTable(1);
      if (!view) return;

      this.replayButton.hidden = staged.length > 0 && !this.state?.replaying;
      const reshuffling = animate && !!previous && previous.view.round === view.round &&
        previous.view.revision !== view.revision && !!view.event?.reshuffles?.length;
      const oldPpc = view.event?.reshuffles?.[0]?.pointsBefore ?? view.pointsPerCard;
      const backTexture = reshuffling ? this.art.rollBack(back, oldPpc, oldPpc, 1) : this.art.back(back, view.pointsPerCard);
      if (this.stockDrawOrigin) {
        this.priorCardPositions.set(this.stockDrawOrigin.id, this.stockDrawOrigin.position);
      }
      const priorPositions = this.priorCardPositions;
      const priorShades = this.priorCardShades;
      const priorFlights = this.stagingFlights;
      this.priorCardPositions = new Map();
      this.priorCardShades = new Map();
      this.stagingFlights = new Set();
      const stagingChanged = animate && !!previous &&
        (staged.length !== previous.staged.length || staged.some((card, index) => card.id !== previous.staged[index]?.id));
      const adjusting = stagingChanged || animate && (previous?.targetCardWidth !== targetCardWidth ||
        previous?.handSortingStrategy !== this.state?.handSortingStrategy ||
        previous?.keepGroupsTogether !== this.state?.keepGroupsTogether ||
        previous?.dimUnplayable !== this.state?.dimUnplayable ||
        previous?.flickSettings.groupExceptWild !== this.state?.flickSettings.groupExceptWild ||
        previous?.flickSettings.groupExceptTwo !== this.state?.flickSettings.groupExceptTwo);
      const initialDeal = motion && !view.event;
      const enemy = opponentPositions(layout, width, view.opponentCount);
      const oldEnemy = motion && priorRound ? opponentPositions(original, width, priorRound.opponentCount) : undefined;
      const opponentPlayed = motion && view.event?.kind === "play" && view.event.seat !== view.seat;
      const stagedCommit = !!(reflow && view.event?.seat === view.seat && committedFromPlay(view.visibleDiscard, previous));
      const phases = reflow ? playPhases(stagedCommit, false, opponentWildPlay(view), view.event?.burnsPreviousPlay, view.event?.aggressiveness) : undefined;
      const draw = drawTimeline(view, view.seat);
      const opponentDraw = drawTimeline(view, otherSeat(view.seat));
      const stockDraw = reshuffling || (reflow && draw.count + opponentDraw.count > 0)
        ? (opponentDraw.count ? opponentDraw : draw) : undefined;
      this.drawStock(stock, view.stockCount, backTexture, layout, adjusting,
        stockDraw, view.event?.kind === "shuffle" ? 0 : previous?.view.stockCount, back, registerReflow, original, registerReturn);
      this.drawDiscard(view, layout, stock, priorPositions, oldEnemy, adjusting, phases,
        motion && priorRound ? previous : undefined, registerReflow, registerReturn);
      this.drawOpponent(enemy, backTexture, stock, opponentDraw, initialDeal, opponentPlayed, oldEnemy, registerReflow);

      const stagedTargets = layout.piles.play.map((position, index) => {
        const card = staged[index]!;
        // Preserve the original queue order while its committed prefix slides away.
        const depth = CARD_DEPTH.play + (stagedCommit ? view.visibleDiscard.length : 0) + index;
        return { card, position, dimmed: false, staged: true, depth };
      });
      const last = staged.at(-1);
      const remaining = cards.filter(card => !stagedIds.has(card.id));
      const leads = last ? remaining.filter(card => canFollowInQueue(card, last)).map(card => card.id) : view.legalLeads;
      const legal = flickPlayableCards(remaining, leads, this.state!.flickSettings);
      const handActive = view.turn === view.seat && !view.result && !view.queuedCards.length;
      const canStage = handActive && staged.length < PLAY_SLOTS;
      const handTargets = handSlots.map((position, index) => {
        const card = cards[index]!;
        const playable = canStage && legal.has(card.id);
        return { card, position, dimmed: !!this.state?.dimUnplayable && handActive && !playable, staged: false, depth: CARD_DEPTH.hand + index };
      }).filter(({ card }) => !stagedIds.has(card.id));
      const buttons = this.placeTargets(stagedTargets, handTargets, view);
      for (const { card, position, depth } of stagedTargets) {
        const from = priorPositions.get(card.id);
        const image = this.drawImage(this.art.face(card), position, depth);
        this.cardImages.set(card.id, image);
        const button = buttons.get(card.id)!;
        this.priorCardPositions.set(card.id, position);
        if (registerReflow && from) {
          registerReflow(t => this.positionButton(button, this.moveCard(image, from, position, t, card.id)));
        } else if (adjusting && from) {
          const inFlight = priorFlights.has(card.id) || !previous?.staged.some(item => item.id === card.id);
          if (inFlight) { image.setDepth(CARD_DEPTH.staging + depth - CARD_DEPTH.play); this.stagingFlights.add(card.id); }
          const move = (t: number) => this.positionButton(button,
            this.moveCard(image, from, position, t, card.id, inFlight ? 16 : 0));
          move(0);
          this.tween(STAGE_FLIGHT, move, () => { image.setDepth(depth); this.stagingFlights.delete(card.id); });
        }
      }
      const movingDraw = motion && !!priorRound && draw.count > 0;
      this.drawHand(handTargets, buttons, view, stock, priorPositions, priorShades, motion, adjusting, initialDeal,
        movingDraw ? draw : undefined, registerReflow);
      this.stockDrawOrigin = undefined;
      if (reflow && returnFrames.length) {
        this.tween(reflow.start - reflow.landing, t => returnFrames.forEach(frame => frame(t)), undefined, reflow.landing);
      }
      if (reflow && reflow.end > reflow.start) {
        this.tween(reflow.end - reflow.start, t => reflowFrames.forEach(frame => frame(t)), undefined, reflow.start);
      }
      this.animateImpact();
      if (reshuffling || reflow) {
        this.deferResize = true;
        const ready = handReadinessTimeline(view);
        this.tween(ready.start + ready.duration, () => {}, () => {
          this.deferResize = false;
          if (this.resizePending) {
            this.resizePending = false;
            queueMicrotask(() => this.paint());
          }
        });
      }
    } finally {
      this.painting = false;
    }
  }

  private drawFelt(felt: Phaser.GameObjects.Graphics, width: number, pileY: number, pileHeight: number): void {
    felt.clear();
    const middle = pileY + pileHeight / 2;
    felt.lineStyle(1, 0xf4db9c, .12);
    felt.strokeEllipse(width / 2, middle, width * .88, pileHeight + 41);
    felt.lineStyle(1, 0xf4db9c, .055);
    felt.strokeEllipse(width / 2, middle, width * .94, pileHeight + 58);
  }

  private updateHandMask(layout: Layout, handY: number, pixelHeight: number): void {
    this.handEdge = layout.tableWidth - layout.inset;
    this.handBottom = layout.tableHeight - layout.inset;
    const scale = pixelHeight / layout.tableHeight;
    const maskTop = Math.max(0, Math.floor((handY - 2) * scale) / scale);
    const canvas = this.game.canvas;
    // The opaque region above the hand bypasses the right fade. The bottom
    // fade applies to both regions. CSS lets the boundary follow the reflow.
    canvas.style.maskImage = [
      `linear-gradient(to bottom, #000 ${this.handBottom - HAND_FADE_WIDTH}px, transparent ${this.handBottom}px)`,
      `linear-gradient(to bottom, #000 ${maskTop}px, transparent ${maskTop}px)`,
      `linear-gradient(to right, #000 ${this.handEdge - HAND_FADE_WIDTH}px, transparent ${this.handEdge}px)`,
    ].join(", ");
    canvas.style.maskComposite = "intersect, add";
  }

  private drawStock(
    deck: CardPosition, count: number, texture: string, layout: Layout, adjusting: boolean,
    draw: DrawTimeline | undefined, beforeCount = count, back = 0,
    reflow?: RegisterReflow, original = layout, returnPiles?: RegisterReflow,
  ): void {
    const visible = draw || reflow ? 4 : stockLayerCount(count);
    const images: CardImage[] = [];
    for (let index = visible - 1; index >= 0; index--) {
      images[index] = this.drawImage(texture, deck, CARD_DEPTH.stock + visible - index - 1);
    }
    const place = (position: CardPosition, stockCount = draw ? beforeCount : count,
      step = 2 * position.width / layout.basePileWidth) => {
      const layers = stockLayerCount(stockCount);
      images.forEach((image, index) => {
        this.placeImage(image, { ...position, x: position.x + index * step, y: position.y + index * step });
        image.setDepth(CARD_DEPTH.stock + visible - index - 1).setVisible(index < layers).setAlpha(stockCount ? 1 : .62);
      });
      this.positionButton(this.stockButton, { ...position, clipWidth: position.width + (layers - 1) * step,
        clipHeight: artHeight(position.width) + (layers - 1) * step });
      this.priorStockPosition = position;
    };
    const from = this.priorStockPosition;
    if (from && reflow) {
      const home = returnPiles ? { ...from, x: deck.x } : from;
      returnPiles?.(t => place(between(from, home, t), beforeCount, original.stockLayerStep));
      reflow(t => place(t === 0 ? from : between(home, deck, t), draw || t === 0 ? beforeCount : count,
        lerp(original.stockLayerStep, layout.stockLayerStep, t)));
    } else {
      place(from && adjusting ? from : deck);
      if (from && adjusting && !samePosition(from, deck)) {
        this.tween(STAGE_FLIGHT, t => place(between(from, deck, t)));
      }
    }
    if (!draw) return;
    let stamp = "";
    const points = (old: number, next: number, progress = 1) => {
      const nextStamp = `${old}:${next}:${progress}`;
      if (stamp !== nextStamp) { this.art.rollBack(back, old, next, progress); stamp = nextStamp; }
    };
    const span = draw.total - draw.start;
    this.tween(span, progress => {
      const elapsed = draw.start + progress * span;
      const current = draw.shuffles.find(shuffle => elapsed >= shuffle.start && elapsed < shuffle.start + shuffle.duration);
      if (current) {
        const frame = shuffleFrame(elapsed - current.start, deck, layout.piles.discard[0]!, 2 * deck.width / layout.basePileWidth);
        this.board.dataset.shuffleStage = frame.stage;
        this.board.dataset.shuffleCycle = String(frame.cycle);
        place(deck, 52);
        frame.cards.forEach(({position, depth, visible}, index) => {
          this.placeImage(images[index]!, position);
          images[index]!.setDepth(CARD_DEPTH.stock + depth).setVisible(visible).setAlpha(1);
        });
        if (frame.stage === "points" || frame.stage === "pause") points(current.pointsBefore, current.pointsAfter, frame.pointProgress);
        else points(current.pointsBefore, current.pointsBefore);
      } else {
        const completed = draw.shuffles.filter(shuffle => elapsed >= shuffle.start + shuffle.duration);
        const drawn = draw.cardStarts.filter(start => elapsed >= start + draw.duration + draw.reveal).length;
        place(deck, beforeCount + completed.reduce((sum, shuffle) => sum + shuffle.stockCount, 0) - drawn);
        const value = completed.at(-1)?.pointsAfter ?? draw.shuffles[0]?.pointsBefore;
        if (value !== undefined) points(value, value);
        delete this.board.dataset.shuffleStage;
        delete this.board.dataset.shuffleCycle;
      }
    }, () => {
      place(deck, count);
      delete this.board.dataset.shuffleStage;
      delete this.board.dataset.shuffleCycle;
    }, draw.start, "Linear");
  }

  private drawOpponent(
    enemy: CardPosition[], texture: string, stock: CardPosition,
    draw: DrawTimeline, initialDeal: boolean, played: boolean, previous?: CardPosition[], reflow?: RegisterReflow,
  ): void {
    const arrivals: Arrival[] = [];
    const surviving = enemy.length - (previous ? draw.count : 0);
    const placeTarget = (first?: CardPosition, last?: CardPosition) => {
      this.opponentButton.hidden = !first || !last;
      if (first && last) this.positionButton(this.opponentButton, {
        x: first.x, y: Math.max(0, first.y), width: last.x + last.width - first.x,
        clipHeight: artHeight(first.width) + Math.min(0, first.y),
      });
    };
    if (reflow) {
      const first = previous?.[0], last = previous?.[surviving - 1];
      const firstTarget = enemy[0], lastTarget = enemy[surviving - 1];
      reflow(t => placeTarget(first && firstTarget && between(first, firstTarget, t),
        last && lastTarget && between(last, lastTarget, t)));
      if (draw.count) this.tween(draw.total - draw.start, () => {}, () => placeTarget(enemy[0], enemy.at(-1)), draw.start);
    } else placeTarget(enemy[0], enemy.at(-1));
    enemy.forEach((position, index) => {
      const image = this.drawImage(texture, position, CARD_DEPTH.opponent + index);
      const from = previous?.[index];
      if (this.impact && this.state?.view.event?.seat === this.state?.view.seat && index < surviving) {
        this.impactCards.push({ image, home: from ?? position });
      }
      if (initialDeal) {
        this.deal(image, stock, position, OPPONENT_DEAL);
      } else if (previous && draw.count > 0 && index >= enemy.length - draw.count) {
        arrivals.push({ image, position });
      } else if (from && reflow) {
        reflow(t => this.moveCard(image, from, position, t));
      } else if (from && (draw.count > 0 || played) && !samePosition(from, position)) {
        this.placeImage(image, from);
        this.tween(played ? PLAY_FLIGHT : draw.duration,
          t => this.moveCard(image, from, position, t), undefined, draw.cardStarts[0] ?? draw.start);
      }
    });
    this.animateDraws(arrivals, stock, draw);
  }

  private drawDiscard(
    view: TableView, layout: Layout, stock: CardPosition,
    previousPositions: Map<number, CardPosition>, opponent: CardPosition[] | undefined,
    adjusting: boolean, phases: PlayPhases | undefined, previous?: BoardState, reflow?: RegisterReflow,
    returnPiles?: RegisterReflow,
  ): void {
    const width = layout.tableWidth;
    const last = view.visibleDiscard;
    const targets = layout.piles.discard;
    const old = view.event?.kind === "play" ? previous?.view.visibleDiscard ?? [] : [];
    const firstTarget = targets[0]!;
    const lastTarget = targets.at(-1)!;
    const placeTarget = (first: CardPosition, last: CardPosition) => this.positionButton(this.discardButton, {
      ...first, clipWidth: last.x - first.x + last.width,
    });
    if (!reflow) placeTarget(firstTarget, lastTarget);
    if (!old.length) {
      last.forEach((card, index) => {
        const target = targets[index]!;
        const from = previousPositions.get(card.id);
        const image = this.drawImage(this.art.face(card), target, CARD_DEPTH.discard + index);
        this.priorCardPositions.set(card.id, target);
        if (adjusting && from && !samePosition(from, target)) {
          this.moveCard(image, from, target, 0, card.id);
          this.tween(STAGE_FLIGHT, t => this.moveCard(image, from, target, t, card.id));
        }
      });
      return;
    }

    const fallback = collapsePlayPositions(targets[0]!, old.length);
    const prior = old.map((card, index) => previousPositions.get(card.id) ?? fallback[index]!);
    const landing = playLandingPositions(prior, last.length);
    const outgoing = old.map((card, index) =>
      this.drawImage(this.art.face(card), prior[index]!, CARD_DEPTH.discard + index));
    const playerPlayed = view.event!.seat === view.seat;
    const alreadyQueued = playerPlayed && committedFromPlay(last, previous);
    const outgoingTargets = prior;
    const timing = phases ?? playPhases(alreadyQueued, false, opponentWildPlay(view), view.event!.burnsPreviousPlay, view.event!.aggressiveness);
    const score = view.event!.aggressiveness ?? 0;
    const baseDepth = alreadyQueued ? CARD_DEPTH.play : CARD_DEPTH.staging + PLAY_SLOTS;
    const heroDepth = CARD_DEPTH.staging + PLAY_SLOTS * 2 + 52;
    const shadow = score > 0 ? this.add.graphics().setDepth(baseDepth - .5) : undefined;
    const chargeBackground = score >= 4 ? this.add.graphics().setDepth(heroDepth - 1) : undefined;
    const ordinaryMask = this.game.canvas.style.maskImage;
    const ordinaryReplayHidden = this.replayButton.hidden;
    const pulses = chargePulseThresholds(score);
    let nextPulse = 0;
    let chargeColorPhase = 0;
    const fire = timing.burnStart !== null ? this.add.graphics().setDepth(CARD_DEPTH.discard + old.length - .5) : undefined;
    const anchor = outgoingTargets[0]!;
    const collapsedPositions = collapsePlayPositions(anchor, last.length);
    if (reflow) placeTarget(prior[0]!, prior.at(-1)!);
    const incoming = last.map((card, index) => {
      const enemyIndex = Math.max(0, (opponent?.length ?? 0) - last.length + index);
      const from = playerPlayed ? previousPositions.get(card.id) ?? at((width - layout.handWidth) / 2, layout.handY, layout.handWidth)
        : opponent?.[enemyIndex] ?? stock;
      // A committed prefix retains its staged depth below the remaining queue.
      // Direct plays stay above the table throughout the flight and collapse.
      const depth = (alreadyQueued ? CARD_DEPTH.play : CARD_DEPTH.staging + PLAY_SLOTS) + index;
      const reel = !playerPlayed && index === last.length - 1 && card.special === "wild"
        ? wildReel(card.suit, card.calledSuit ?? card.suit, Math.random, wildSuitOptions(previous!.view.activeSuit, last.length)) : undefined;
      const image = this.drawImage(this.art.face(card, reel ? { reel, progress: 0 } : undefined), from, depth);
      this.priorCardPositions.set(card.id, from);
      const collapsed = collapsedPositions[index]!;
      // Aggressive plays leave their staged slots and strike just after the old discard,
      // then share the old play's collapse timeline. Only quiet staged plays stay in place.
      return { image, from, appended: alreadyQueued && score === 0 ? from : landing[index]!, collapsed, target: targets[index]!, id: card.id, card, reel };
    });
    if (score > 0) {
      const first = incoming[0]!.appended, last = incoming.at(-1)!.appended;
      this.impact = { score, timing, origin: {
        x: (first.x + last.x + last.width) / 2, y: first.y + artHeight(first.width) / 2, width: first.width,
      } };
    }

    let soundedProgress = 0;
    let fireSoundStarted = false;
    if (incoming.some(card => card.reel)) this.board.dataset.wildReel = String(last.at(-1)!.id);
    this.tween(timing.total, progress => {
      const elapsed = progress * timing.total;
      const charge = powerCharge(elapsed, timing.flight, slamDescent(score), score, timing.wildHold);
      const raised = score > 0 && elapsed < timing.flight ? slamPlayFlight(
        incoming.map(card => card.from), incoming.map(card => card.appended),
        elapsed, timing.flight, score, width, layout.inset + HAND_FADE_WIDTH, timing.wildHold) : undefined;
      if (chargeBackground) {
        chargeBackground.clear();
        this.game.canvas.style.maskImage = charge.visible ? "none" : ordinaryMask;
        this.replayButton.hidden = charge.visible || ordinaryReplayHidden;
        incoming.forEach(({ image }, index) => image.setDepth((charge.visible ? heroDepth : baseDepth) + index));
        shadow?.setDepth((charge.visible ? heroDepth : baseDepth) - .5);
        if (charge.visible) {
          const positions = raised!;
          const center = {
            x: (Math.min(...positions.map(p => p.x)) + Math.max(...positions.map(p => p.x + p.width))) / 2,
            y: (Math.min(...positions.map(p => p.y)) + Math.max(...positions.map(p => p.y + artHeight(p.width)))) / 2,
          };
          // At most one pulse per rendered frame; skipped frames never release a burst of sounds.
          if (nextPulse < pulses.length && charge.progress >= pulses[nextPulse]!) {
            while (nextPulse < pulses.length && charge.progress >= pulses[nextPulse]!) nextPulse++;
            chargeColorPhase = 1 - chargeColorPhase;
            this.controls.powerPulse?.(score, charge.progress);
          }
          this.drawPowerCharge(chargeBackground, width, layout.tableHeight, center, charge.progress, chargeColorPhase);
        }
      }
      for (const { card, reel } of incoming) if (reel) {
        const progress = unit(elapsed / timing.reelEnd);
        this.art.face(card, { reel, progress });
        for (const sound of wildReelSounds(reel, soundedProgress, progress)) this.controls.suitTick?.(sound);
        soundedProgress = progress;
      }
      if (incoming.some(card => card.reel)) this.board.dataset.wildPhase = elapsed < timing.flight ? "flight" : elapsed < timing.reelEnd ? "hold" : "slide";
      if (elapsed < timing.flight) {
        const flight = ease(elapsed / timing.flight);
        const spread = unit(flight * 2);
        outgoing.forEach((image, index) => this.moveCard(image, prior[index]!, outgoingTargets[index]!, spread));
        incoming.forEach(({ image, from, appended, id }, index) => {
          if (score > 0) {
            const position = raised![index]!;
            this.placeImage(image, position);
            this.priorCardPositions.set(id, position);
          } else this.moveCard(image, from, appended, arrivalProgress(elapsed, timing.flight), id);
        });
        shadow?.clear();
        if (shadow) incoming.forEach(({ from, appended }, index) => {
          const cast = slamShadow(from, appended, elapsed, timing.flight, score, timing.wildHold);
          if (raised) {
            const raw = slamFlight(from, appended, elapsed, timing.flight, score, timing.wildHold);
            const fitted = raised[index]!;
            const scale = fitted.width / raw.width;
            cast.x = fitted.x + (cast.x - raw.x) * scale;
            cast.y = fitted.y + (cast.y - raw.y) * scale;
            cast.width *= scale;
            cast.height *= scale;
            cast.blur *= scale;
          }
          // Feathered card silhouettes sit above the board/old cards and below the raised play.
          for (let layer = 5; layer >= 0; layer--) {
            const spread = cast.blur * layer / 5;
            shadow?.fillStyle(0x000000, cast.alpha / 6);
            shadow?.fillRoundedRect(cast.x - spread, cast.y - spread,
              cast.width + spread * 2, cast.height + spread * 2, cast.width * .045 + spread);
          }
        });
        return;
      }
      shadow?.clear();

      const slide = ease(unit((elapsed - timing.collapseStart) / (timing.collapseEnd - timing.collapseStart)));
      const restore = ease(unit((elapsed - timing.returnStart) / Math.max(1, timing.total - timing.returnStart)));
      if (fire && timing.burnStart !== null) {
        const burn = unit((elapsed - timing.burnStart) / PLAY_TIME);
        if (elapsed >= timing.burnStart) {
          if (!fireSoundStarted && burn < 1) {
            fireSoundStarted = true;
            this.controls.fireRumble?.((1 - burn) * PLAY_TIME / this.speed);
          } else if (fireSoundStarted && burn === 1) {
            this.controls.stopFireRumble?.();
            fireSoundStarted = false;
          }
          // The old play stays in place as its cards disappear into the flame and smoke.
          outgoing.forEach(image => {
            image.setPaperShade(unit(burn * 3));
            image.setAlpha(1 - ease(unit((burn - .12) / .62)));
          });
          this.drawWildBurn(fire, prior, burn);
        }
      } else {
        outgoing.forEach((image, index) => {
          const start = outgoingTargets[index]!;
          const collapsed = { ...start, x: anchor.x };
          this.placeImage(image, elapsed < timing.returnStart ? { ...start, x: lerp(start.x, anchor.x, slide) }
            : between(collapsed, reflow ? anchor : targets[0]!, restore));
        });
      }
      incoming.forEach(({ image, appended, collapsed, target, id }) =>
        elapsed < timing.returnStart ? this.moveCard(image, appended, collapsed, slide, id) :
          this.moveCard(image, collapsed, reflow ? collapsed : target, restore, id));
    }, () => {
      delete this.board.dataset.wildReel;
      delete this.board.dataset.wildPhase;
      fire?.destroy();
      shadow?.destroy();
      chargeBackground?.destroy();
      if (chargeBackground) {
        this.game.canvas.style.maskImage = ordinaryMask;
        this.replayButton.hidden = ordinaryReplayHidden;
      }
      outgoing.forEach(image => image.destroy());
      incoming.forEach(({ image }, index) => image.setDepth(CARD_DEPTH.discard + index));
      if (reflow) placeTarget(collapsedPositions[0]!, collapsedPositions.at(-1)!);
    }, 0, "Linear");
    const home = returnPiles ? collapsePlayPositions({ ...anchor, x: firstTarget.x }, last.length) : collapsedPositions;
    const movePile = (from: CardPosition[], to: CardPosition[], progress: number) => {
      if (progress === 0) return;
      incoming.forEach(({ image, id }, index) => this.moveCard(image, from[index]!, to[index]!, progress, id));
      placeTarget(between(from[0]!, to[0]!, progress), between(from.at(-1)!, to.at(-1)!, progress));
    };
    returnPiles?.(t => movePile(collapsedPositions, home, t));
    reflow?.(t => movePile(home, targets, t));
  }

  private drawPowerCharge(graphics: Phaser.GameObjects.Graphics, width: number, height: number,
    center: { x: number; y: number }, progress: number, colorPhase: number): void {
    const palette = chargePalette(progress);
    graphics.fillStyle(palette.base, 1);
    graphics.fillRect(0, 0, width, height);
    // Each audible charge pulse swaps the stationary green and gold wedges.
    const radius = Math.max(...[0, width].flatMap(x => [0, height].map(y => Math.hypot(x - center.x, y - center.y)))) * 2;
    const count = 24;
    for (let ray = 0; ray < count; ray++) {
      const start = ray * Math.PI * 2 / count;
      const end = (ray + 1) * Math.PI * 2 / count;
      graphics.fillStyle(palette.rays[(ray + colorPhase) % palette.rays.length]!, 1);
      graphics.fillTriangle(center.x, center.y,
        center.x + Math.cos(start) * radius, center.y + Math.sin(start) * radius,
        center.x + Math.cos(end) * radius, center.y + Math.sin(end) * radius);
    }
  }

  private animateImpact(): void {
    const impact = this.impact;
    if (!impact) return;
    const { origin, timing, score } = impact;
    const towardPlayer = this.state!.view.event!.seat !== this.state!.view.seat;
    let sounded = false;
    this.tween(timing.total, progress => {
      const elapsed = progress * timing.total;
      if (!sounded && elapsed >= timing.flight) {
        sounded = true;
        this.controls.tableSlam?.(score, shakeDuration(score) / this.speed);
      }
      const shake = tableShock(elapsed, timing.flight, score);
      this.board.style.transform = `translate(${shake.x}px, ${shake.y}px)`;
      if (score < 4) return;
      const amount = impactEnvelope(elapsed, timing.flight, timing.collapseStart, timing.collapseEnd);
      this.impactCards.forEach(({ image, home, id }, index) => {
        const scattered = scatteredCard(home, origin, score, index, towardPlayer, amount);
        this.placeImage(image, scattered.position);
        image.setAngle(scattered.angle);
        if (id !== undefined) this.priorCardPositions.set(id, scattered.position);
      });
    }, () => { this.board.style.removeProperty("transform"); }, 0, "Linear");
  }

  private drawWildBurn(graphics: Phaser.GameObjects.Graphics, positions: CardPosition[], progress: number): void {
    graphics.clear();
    if (progress <= 0 || progress >= 1) return;
    const first = positions[0]!;
    const last = positions.at(-1)!;
    const height = artHeight(first.width);
    const width = last.x + last.width - first.x;
    const size = first.width;
    const columns = Math.max(5, Math.ceil(width / size * 6));

    // Overlapping smoke puffs expand and drift upward, then disperse completely.
    for (let i = 0; i < columns * 2; i++) {
      const age = unit((progress - .12 - (i % 4) * .09) / (.88 - (i % 4) * .09));
      if (age <= 0 || age >= 1) continue;
      const x = first.x + width * ((i % columns + .5) / columns) + Math.sin(i * 2.4 + age * 2) * size * .24 * age;
      const y = first.y + height * (.78 - age * 1.36);
      const radius = size * (.10 + age * .24);
      const opacity = Math.sin(Math.PI * age) * .48;
      graphics.fillStyle(i % 2 ? 0x655b51 : 0x373732, opacity);
      graphics.fillCircle(x, y, radius);
      graphics.fillStyle(0x9a8e7c, opacity * .42);
      graphics.fillCircle(x - radius * .23, y - radius * .20, radius * .68);
    }

    // A flickering front moves up the cards, leaving the final moments for smoke.
    const intensity = Math.sin(Math.PI * unit(progress / .77));
    if (intensity < .001) return;
    const baseY = first.y + height * (1 - .84 * unit(progress / .68));
    for (let i = 0; i < columns; i++) {
      const x = first.x + width * (i + .5) / columns;
      const flicker = .75 + .25 * Math.sin(i * 2.3 + progress * 54);
      const flameHeight = size * (.24 + .63 * intensity) * flicker;
      const radius = width / columns * (.52 + .14 * intensity);
      const tip = x + Math.sin(i * 1.7 + progress * 36) * radius;
      graphics.fillStyle(0xf04b12, intensity * .88);
      graphics.fillEllipse(x, baseY - flameHeight * .23, radius * 2.15, flameHeight * .65);
      graphics.fillTriangle(x - radius, baseY, x + radius, baseY, tip, baseY - flameHeight);
      graphics.fillStyle(0xffb22d, intensity * .96);
      graphics.fillEllipse(x, baseY - flameHeight * .18, radius * 1.28, flameHeight * .46);
      graphics.fillTriangle(x - radius * .62, baseY, x + radius * .62, baseY, tip, baseY - flameHeight * .67);
      graphics.fillStyle(0xfff3ab, intensity);
      graphics.fillEllipse(x, baseY - flameHeight * .12, radius * .72, flameHeight * .29);

      const spark = (progress * 3 + i * .19) % 1;
      graphics.fillStyle(0xffc65b, intensity * (1 - spark));
      graphics.fillCircle(x + Math.sin(i + spark * 5) * radius, baseY - flameHeight - spark * size * .4,
        size * (.012 + .009 * (1 - spark)));
    }
  }

  private drawHand(
    targets: CardTarget[], buttons: Map<number, HTMLButtonElement>, view: TableView,
    stock: CardPosition, previousPositions: Map<number, CardPosition>, previousShades: Map<number, number>, motion: boolean,
    stagingChanged: boolean, initialDeal: boolean, draw?: DrawTimeline, reflow?: RegisterReflow,
  ): void {
    const ready = handReadinessTimeline(view);
    const drawOrder = new Map(draw ? view.event?.drawnCards?.map((id, index) => [id, index]) : []);
    const arrivals: Arrival[] = [];
    const previousDepths = this.priorHandDepths;
    this.priorHandDepths = new Map();
    const drawShifts: Array<(progress: number) => void> = [];
    for (const { card, position, dimmed, depth } of targets) {
      const drawIndex = drawOrder.get(card.id);
      const from = previousPositions.get(card.id);
      const initialDepth = (draw || reflow) && drawIndex === undefined && from
        ? previousDepths.get(card.id) ?? depth : depth;
      const image = this.drawImage(this.art.face(card), position, initialDepth);
      this.cardImages.set(card.id, image);
      if (this.impact && view.event?.seat !== view.seat && drawIndex === undefined) {
        this.impactCards.push({ image, home: from ?? position, id: card.id });
      }
      this.priorHandDepths.set(card.id, initialDepth);
      const button = buttons.get(card.id)!;
      this.priorCardPositions.set(card.id, position);
      this.positionButton(button, position);
      const move = (from: CardPosition, to: CardPosition, t: number) =>
        this.positionButton(button, this.moveCard(image, from, to, t, card.id));
      if (initialDeal) {
        this.deal(image, stock, position, HAND_DEAL);
      } else if (drawIndex !== undefined) {
        arrivals[drawIndex] = { image, position, id: card.id };
      } else if (reflow && from) {
        reflow(t => {
          if (t > 0 && image.depth !== depth) {
            image.setDepth(depth);
            this.priorHandDepths.set(card.id, depth);
          }
          move(from, position, t);
        });
      } else if (draw && from) {
        // Keep the old overlap order and positions until the first draw begins,
        // including any delay for the opponent's play or a stock reshuffle.
        move(from, position, 0);
        drawShifts.push(t => {
          if (image.depth !== depth) {
            image.setDepth(depth);
            this.priorHandDepths.set(card.id, depth);
          }
          move(from, position, t);
        });
      } else if ((motion || stagingChanged) && from && !samePosition(from, position)) {
        move(from, position, 0);
        const duration = motion ? Math.min(HAND_DRAW, ready.start) : STAGE_FLIGHT;
        this.tween(duration, t => move(from, position, t));
      }
      const shade = (value: number) => {
        image.setPaperShade(value);
        this.priorCardShades.set(card.id, value);
      };
      const targetShade = dimmed ? 1 : 0;
      const previousShade = previousShades.get(card.id) ?? 0;
      if (motion) {
        shade(previousShade);
        if (ready.start > 0 && previousShade > 0) {
          this.tween(Math.min(HAND_DRAW, ready.start), t => shade(lerp(previousShade, 0, t)));
        } else shade(0);
        if (ready.duration && dimmed) {
          this.tween(ready.duration, t => shade(t), undefined, ready.start);
        }
      } else if (stagingChanged && previousShade !== targetShade) {
        shade(previousShade);
        this.tween(STAGE_FLIGHT, t => shade(lerp(previousShade, targetShade, t)));
      } else {
        shade(targetShade);
      }
    }
    if (draw) {
      // Change all existing card depths together in the same frame as their motion.
      if (drawShifts.length) {
        this.tween(Math.min(HAND_DRAW, ready.start),
          t => drawShifts.forEach(shift => shift(t)), undefined, draw.cardStarts[0] ?? draw.start);
      }
      this.animateDraws(arrivals, stock, draw);
    }
  }

  private animateDraws(arrivals: Arrival[], stock: CardPosition, draw: DrawTimeline): void {
    if (!arrivals.length) return;
    const origins = arrivals.map(({ id }) => this.stockDrawOrigin && id === this.stockDrawOrigin.id ? this.stockDrawOrigin.position : undefined);
    if (origins.some(Boolean)) this.stockDrawOrigin = undefined;
    arrivals.forEach(({ image, position, id }, index) => {
      this.moveCard(image, origins[index] ?? stock, position, 0, id);
      image.setVisible(!!origins[index] || draw.cardStarts[index] === 0);
    });

    const span = draw.total - draw.start;
    this.tween(span, progress => {
      const elapsed = progress * span;
      arrivals.forEach(({ image, position, id }, index) => {
        const age = elapsed + draw.start - draw.cardStarts[index]!;
        if (age < 0) return;
        image.setVisible(true);
        this.moveCard(image, origins[index] ?? stock, position, arrivalProgress(age - (origins[index] ? 0 : draw.reveal), draw.duration), id, 14);
      });
    }, undefined, draw.start, "Linear");
  }

  private cardsEnabled(view: TableView): boolean {
    return !this.state?.locked && view.turn === view.seat && !view.result && !view.queuedCards.length;
  }

  private placeTargets(staged: CardTarget[], hand: CardTarget[], view: TableView): Map<number, HTMLButtonElement> {
    const activeId = (document.activeElement as HTMLElement | null)?.dataset.cardId;
    const enabled = this.cardsEnabled(view);
    const targets = [...staged, ...hand].map(({ card, position, staged }) => {
      const button = document.createElement("button");
      button.className = "card-target gesture-card";
      button.setAttribute("aria-label", describeCard(card));
      button.setAttribute("aria-pressed", String(staged));
      button.dataset.cardId = String(card.id);
      if (!staged) button.dataset.handCard = "true";
      button.disabled = !enabled;
      this.bindCardGesture(button, card.id, staged);
      this.positionButton(button, position);
      return button;
    });
    this.cardTargets.replaceChildren(...targets);
    if (activeId && enabled) targets.find(button => button.dataset.cardId === activeId)?.focus({ preventScroll: true });
    return new Map(targets.map(button => [Number(button.dataset.cardId), button]));
  }

  // Keep live images and cached positions together so the next paint starts at release.
  private moveDragged(dx: number, dy: number): void {
    for (const [id, { image, home }] of this.dragged) {
      const position = { ...home, x: home.x + dx, y: home.y + dy };
      this.placeImage(image, position);
      this.priorCardPositions.set(id, position);
    }
  }

  returnDraggedCards(immediate = false): void {
    this.dragReturn?.stop();
    this.dragReturn = undefined;
    if (!this.dragged.size) return;
    const cards = [...this.dragged].map(([id, item]) => ({ id, ...item, from: this.priorCardPositions.get(id)! }));
    const move = (t: number) => {
      for (const { id, image, home, from, depth } of cards) {
        const position = t === 1 ? home : between(from, home, t);
        this.placeImage(image, position);
        this.priorCardPositions.set(id, position);
        if (t === 1) image.setDepth(depth);
      }
    };
    const done = () => { this.dragged.clear(); this.dragReturn = undefined; };
    if (immediate) { move(1); done(); }
    else this.dragReturn = this.tween(140, move, done);
  }

  private beginCardDrag(id: number, staged: boolean): void {
    this.cardClicks.cancel();
    const state = this.state;
    if (!state) return;
    const remaining = state.view.hand.filter(card => !state.staged.some(queued => queued.id === card.id));
    const last = state.staged.at(-1);
    const legal = last ? remaining.filter(card => canFollowInQueue(card, last)).map(card => card.id) : state.view.legalLeads;
    const card = remaining.find(card => card.id === id);
    const group = staged ? state.staged : card ? flickPlay(card, remaining, legal, state.flickSettings) ?? [card] : [];
    for (const [index, card] of group.entries()) {
      const image = this.cardImages.get(card.id), position = this.priorCardPositions.get(card.id);
      if (!image || !position) continue;
      this.dragged.set(card.id, { image, home: { ...position }, depth: image.depth });
      image.setDepth(CARD_DEPTH.staging + PLAY_SLOTS * 2 + index);
    }
  }

  private bindCardGesture(button: HTMLButtonElement, id: number, staged: boolean): void {
    let start: { x: number; y: number; time: number; pointer: number; dragging: boolean } | undefined;
    let suppressClick = false;
    let pointerType = "touch";
    const cancel = () => {
      start = undefined;
      suppressClick = true;
      this.cancelPointer = undefined;
      this.returnDraggedCards();
    };
    button.onpointerdown = event => {
      if (!event.isPrimary || event.button !== 0 || !this.state || !this.cardsEnabled(this.state.view)) return;
      this.cancelPointer?.();
      this.returnDraggedCards(true);
      suppressClick = false;
      pointerType = event.pointerType;
      start = { x: event.clientX, y: event.clientY, time: event.timeStamp, pointer: event.pointerId, dragging: false };
      this.cancelPointer = cancel;
      if (event.isTrusted) button.setPointerCapture(event.pointerId);
    };
    const track = (event: PointerEvent) => {
      if (!start || start.pointer !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!start.dragging && isCardDrag(dx, dy, staged)) {
        start.dragging = true;
        suppressClick = true;
        this.beginCardDrag(id, staged);
      }
      if (start.dragging) {
        const bounds = this.board.getBoundingClientRect();
        this.moveDragged(dx * this.board.clientWidth / bounds.width, dy * this.board.clientHeight / bounds.height);
      }
    };
    button.onpointermove = track;
    button.onpointercancel = event => { if (start?.pointer === event.pointerId) cancel(); };
    button.onlostpointercapture = event => { if (start?.pointer === event.pointerId) cancel(); };
    button.onpointerup = event => {
      if (!start || start.pointer !== event.pointerId) return;
      track(event);
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const elapsed = event.timeStamp - start.time;
      const gesture = staged ? queuedCardFlick(dx, dy, elapsed) : undefined;
      const flick = !staged && isUpwardFlick(dx, dy, elapsed);
      const drop = start.dragging ? this.dragDropRegion() : undefined;
      suppressClick = start.dragging || Math.hypot(dx, dy) > 12;
      start = undefined;
      this.cancelPointer = undefined;
      if (gesture === "play") this.controls.playQueue();
      else if (gesture === "clear") this.controls.clearPlay();
      else if (flick) this.controls.flickCard(id);
      else if (drop) this.controls.dropCards([...this.dragged.keys()], drop);
      else this.returnDraggedCards();
    };
    button.onclick = event => {
      if (event.detail === 0) { this.controls.tapCard(id); return; }
      if (!suppressClick) this.cardClicks.click(id, pointerType, event.timeStamp,
        () => this.controls.tapCard(id),
        () => {
          if (this.state?.staged.some(card => card.id === id)) this.controls.playQueue();
          else this.controls.flickCard(id);
        });
    };
  }

  private dragDropRegion(): "discard" | "play" | undefined {
    return this.dropRegion([...this.dragged.keys()].flatMap(id => {
      const position = this.priorCardPositions.get(id);
      return position ? [position] : [];
    }));
  }

  private dropRegion(positions: readonly CardPosition[]): "discard" | "play" | undefined {
    const layout = this.priorLayout;
    if (!layout || !positions.length) return;
    const discard = layout.piles.discard;
    const first = discard[0]!, last = discard.at(-1)!;
    const edge = last.x + last.width;
    const top = Math.min(...discard.map(card => card.y));
    const bottom = Math.max(...discard.map(card => card.y + artHeight(card.width)));
    const cards = positions.map(card => ({ ...card, width: card.clipWidth ?? card.width, height: card.clipHeight ?? artHeight(card.width) }));
    return cardDropRegion(cards,
      { x: first.x, y: top, width: edge - first.x, height: bottom - top },
      { x: edge, y: top, width: Math.max(0, layout.tableWidth - layout.inset - edge), height: bottom - top });
  }

  revealStockDraw(card: Card): void {
    const drag = this.stockDrag;
    if (!drag) return;
    drag.image.destroy();
    drag.image = this.drawImage(this.art.face(card), drag.position, CARD_DEPTH.staging + 100);
    drag.card = card;
    this.stockDrawOrigin = { id: card.id, position: { ...drag.position } };
  }

  private bindStockGesture(): void {
    let lastRelease = -Infinity;
    let fallback: number | undefined;
    const release = (event?: PointerEvent, updatePosition = true) => {
      const drag = this.stockDrag;
      if (drag && !drag.released && (!event || drag.pointer === event.pointerId)) {
        if (event && updatePosition) track(event);
        drag.released = true;
        lastRelease = event?.timeStamp ?? performance.now();
        this.controls.releaseDeckDraw(event && updatePosition ? this.dropRegion([drag.position]) : undefined);
      } else if (event && fallback === event.pointerId) {
        fallback = undefined;
        lastRelease = event.timeStamp;
        this.controls.deckClick();
      }
    };
    const track = (event: PointerEvent) => {
      const drag = this.stockDrag;
      if (!drag || drag.released || drag.pointer !== event.pointerId) return;
      const bounds = this.board.getBoundingClientRect();
      const dx = (event.clientX - drag.x) * this.board.clientWidth / bounds.width;
      const dy = (event.clientY - drag.y) * this.board.clientHeight / bounds.height;
      drag.position = { ...drag.home, x: drag.home.x + dx, y: drag.home.y + dy };
      this.placeImage(drag.image, drag.position);
      if (drag.card) this.stockDrawOrigin = { id: drag.card.id, position: { ...drag.position } };
    };
    this.stockButton.onpointerdown = event => {
      if (!event.isPrimary || event.button !== 0 || event.timeStamp - lastRelease <= 450 || this.stockDrag) return;
      this.cardClicks.cancel();
      const home = this.priorStockPosition;
      if (!home || !this.state) return;
      // Create the preview before sending the request; replies may arrive on the next task.
      const image = this.drawImage(this.art.back(this.state.back, this.state.view.pointsPerCard), home, CARD_DEPTH.staging + 100);
      this.stockDrag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, home: { ...home }, position: { ...home }, image, released: false };
      if (!this.controls.beginDeckDraw()) {
        image.destroy(); this.stockDrag = undefined;
        fallback = event.pointerId;
      }
      if (event.isTrusted) this.stockButton.setPointerCapture(event.pointerId);
    };
    this.stockButton.onpointermove = track;
    this.stockButton.onpointerup = release;
    this.stockButton.onpointercancel = event => {
      fallback = undefined;
      release(event, false);
    };
    this.stockButton.onlostpointercapture = event => {
      fallback = undefined;
      release(event, false);
    };
    this.stockButton.onclick = event => { if (event.detail === 0) this.controls.deckClick(); };
    const onBlur = () => release();
    window.addEventListener("blur", onBlur);
    this.events.once("shutdown", () => window.removeEventListener("blur", onBlur));
  }

  private positionButton(button: HTMLElement, position: CardPosition): void {
    button.style.left = position.x + "px";
    button.style.top = position.y + "px";
    const visibleWidth = button.dataset.handCard ? Math.max(0, this.handEdge - HAND_FADE_WIDTH - position.x) : Infinity;
    button.style.width = Math.min(position.clipWidth ?? position.width, visibleWidth) + "px";
    const visibleHeight = button.dataset.handCard ? Math.max(0, this.handBottom - HAND_FADE_WIDTH - position.y) : Infinity;
    button.style.height = Math.min(position.clipHeight ?? artHeight(position.width), visibleHeight) + "px";
  }

  private drawImage(texture: string | FaceTexture, position: CardPosition, depth: number): CardImage {
    const image = new CardImage(this, texture).setDepth(depth);
    this.placeImage(image, position);
    return image;
  }

  private placeImage(image: CardImage, position: CardPosition): void {
    const scale = this.textureScale(position.width);
    image.setPosition(position.x, position.y).setScale(scale).setCrop(0, 0,
      (position.clipWidth ?? position.width) / scale, (position.clipHeight ?? artHeight(position.width)) / scale);
  }

  private textureScale(width: number): number {
    return width / (ART_WIDTH * this.textureDensity);
  }

  private moveCard(image: CardImage, from: CardPosition, to: CardPosition, t: number, id?: number, lift = 0): CardPosition {
    // Older staging/reflow tweens must not pull a held group away from the pointer.
    if (id !== undefined && this.dragged.has(id)) return this.priorCardPositions.get(id)!;
    const position = t === 1 ? to : between(from, to, t, lift);
    this.placeImage(image, position);
    if (id !== undefined) this.priorCardPositions.set(id, position);
    return position;
  }

  private deal(image: CardImage, from: CardPosition, to: CardPosition, duration: number): void {
    this.placeImage(image, from);
    image.setAlpha(0);
    this.tween(duration, t => {
      this.moveCard(image, from, to, t, undefined, 11);
      image.setAlpha(Math.min(1, t * 9));
    });
  }

  private tween(duration: number, frame: (t: number) => void, done?: () => void, delay = 0, easing = "Sine.InOut"): Phaser.Tweens.Tween {
    const progress = { t: 0 };
    return this.tweens.add({
      targets: progress, t: 1, duration: duration / this.speed, delay: delay / this.speed, ease: easing,
      onUpdate: () => frame(progress.t),
      onComplete: () => { frame(1); done?.(); },
    });
  }
}
