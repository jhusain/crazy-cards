import Phaser from "phaser";
import { PLAY_SLOTS, canFollowInQueue, otherSeat, wildSuitOptions, type Card, type TableView } from "@crazy-eights/protocol";
import { CardTextures, describeCard, loadCardArt, type FaceTexture } from "./cards.ts";
import { shuffleFrame } from "./shuffle-animation.ts";
import { wildReel, wildReelStop } from "./wild-reel.ts";
import { isUpwardFlick, queuedCardFlick } from "./card-gesture.ts";
import {
  ART_HEIGHT, ART_WIDTH, CARD_DEPTH, HAND_FADE_WIDTH, PILE_STEP, artHeight, targetHandPlan, handPositions, opponentPositions, playLandingPositions,
  committedFromPlay, collapsePlayPositions, automaticActionPosition, replayPosition, stockLayerCount, tableLayout, type CardPosition, type QueuedPileSlots,
} from "./table-layout.ts";
import {
  HAND_DEAL, HAND_DRAW, OPPONENT_DEAL, PLAY_FLIGHT, PLAY_TIME, STAGE_FLIGHT, drawTimeline, handReadinessTimeline, playPhases, opponentWildPlay,
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
  view: TableView; staged: Card[]; back: number; locked: boolean; targetCardWidth: number; keepGroupsTogether: boolean; dimUnplayable: boolean; replaying: boolean; playCapacity?: number;
};
type Controls = {
  tapCard: (id: number) => void; flickCard: (id: number) => void;
  playQueue: () => void; clearPlay: () => void; ready: () => void; suitBling?: () => void;
};
type CardTarget = { card: Card; position: CardPosition; dimmed: boolean; staged: boolean; depth: number };
type Arrival = { image: CardImage; position: CardPosition; id?: number };
type DrawTimeline = ReturnType<typeof drawTimeline>;

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
  private priorCardPositions = new Map<number, CardPosition>();
  private priorCardShades = new Map<number, number>();
  private priorHandDepths = new Map<number, number>();
  private priorStockPosition?: CardPosition;
  private stagingFlights = new Set<number>();
  private queuedSlots?: Omit<QueuedPileSlots, "playedCount"> & { round: number; ids: number[] };
  private painting = false;
  private recycling = false;
  private resizePending = false;
  private speed = 1;
  private textureDensity: number;
  private layoutWidth = 0;
  private layoutHeight = 0;
  private handEdge = Infinity;
  private handBottom = Infinity;

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
    this.cameras.main.setOrigin(0);
    const resize = () => {
      if (this.recycling) { this.resizePending = true; return; }
      this.paint();
    };
    const observer = new ResizeObserver(() => {
      if (this.board.clientWidth !== this.layoutWidth || this.board.clientHeight !== this.layoutHeight) resize();
    });
    observer.observe(this.board);
    window.addEventListener("resize", resize);
    this.events.once("shutdown", () => {
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
    if (this.art) { this.recycling = false; this.resizePending = false; this.paint(previous, animate); }
  }

  setLocked(locked: boolean): void {
    if (!this.state) return;
    this.state.locked = locked;
    const enabled = this.cardsEnabled(this.state.view);
    for (const button of this.cardTargets.querySelectorAll("button")) button.disabled = !enabled;
  }

  private paint(previous?: BoardState, animate = false): void {
    if (this.painting) return;
    this.painting = true;
    try {
      this.tweens.killAll();
      delete this.board.dataset.wildReel;
      delete this.board.dataset.wildPhase;
      this.children.removeAll(true);
      const { view, staged = [], back = 0 } = this.state ?? {};
      const stagedIds = new Set(staged.map(card => card.id));
      const committedIds = new Set(view?.queuedCards);
      const cards = (view?.hand ?? []).filter(card => !committedIds.has(card.id));
      const width = this.board.clientWidth;
      // Reserve the original slots while editing a play. Once committed, reserve
      // the final hand slots even when the server is still executing later groups.
      const targetCardWidth = this.state?.targetCardWidth ?? 240;
      const maxRowSize = 8;
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
      const layout = tableLayout(width, height, 1, view?.stockCount, maxRowSize,
        view?.visibleDiscard.length, staged.length, this.state?.playCapacity,
        this.queuedSlots && { ...this.queuedSlots, playedCount: this.queuedSlots.ids.length - queued.length });
      const handLayout = committedIds.size
        ? tableLayout(width, height, 1, view?.stockCount, maxRowSize, view?.visibleDiscard.length) : layout;
      const plan = targetHandPlan(handLayout, cards, targetCardWidth, this.state?.keepGroupsTogether);
      const rows = plan.rows;
      const handSlots = plan.positions;
      const largestCard = Math.max(layout.pileWidth, ...handSlots.map(position => position.width));
      const textureDensity = Math.min(Math.floor(4096 / ART_HEIGHT),
        Math.ceil(this.density * Math.max(1, largestCard / ART_WIDTH)));
      if (textureDensity !== this.textureDensity) {
        this.art.destroy();
        this.textureDensity = textureDensity;
        this.art = new CardTextures(this.textures, this.images, textureDensity);
      }
      const { pileY, pileHeight } = layout;
      this.board.style.setProperty("--turn-split", pileY + pileHeight * .53 + "px");
      this.board.style.setProperty("--notice-y", handLayout.noticeY + "px");
      const bounds = this.board.getBoundingClientRect();
      this.board.style.setProperty("--pile-center-x", bounds.left + width / 2 + "px");
      this.board.style.setProperty("--pile-center-y", bounds.top + pileY + layout.stockHeight / 2 + "px");
      this.board.style.setProperty("--pile-row-height", layout.stockHeight + "px");
      this.board.style.setProperty("--pile-row-width", width + "px");
      const stock = layout.piles.stock;
      this.drawFelt(layout, width);
      this.updateHandMask(layout, pixelWidth, pixelHeight);

      if (!view) return;

      this.positionButton(this.replayButton, replayPosition(layout));
      this.positionButton(this.automaticPanel, automaticActionPosition(layout));
      this.automaticPanel.style.setProperty("--automatic-card-width", layout.pileWidth + "px");
      this.replayButton.hidden = staged.length > 0 && !this.state?.replaying;
      const reshuffling = animate && !!previous && previous.view.round === view.round &&
        previous.view.revision !== view.revision && !!view.event?.reshuffles?.length;
      const oldPpc = view.event?.reshuffles?.[0]?.pointsBefore ?? view.pointsPerCard;
      const backTexture = reshuffling ? this.art.rollBack(back, oldPpc, oldPpc, 1) : this.art.back(back, view.pointsPerCard);
      const priorPositions = this.priorCardPositions;
      const priorShades = this.priorCardShades;
      const priorFlights = this.stagingFlights;
      this.priorCardPositions = new Map();
      this.priorCardShades = new Map();
      this.stagingFlights = new Set();
      const motion = animate && previous?.view.revision !== view.revision;
      const stagingChanged = animate && !!previous &&
        (staged.length !== previous.staged.length || staged.some((card, index) => card.id !== previous.staged[index]?.id));
      const adjusting = stagingChanged || animate && (previous?.targetCardWidth !== targetCardWidth ||
        previous?.keepGroupsTogether !== this.state?.keepGroupsTogether ||
        previous?.dimUnplayable !== this.state?.dimUnplayable);
      const initialDeal = motion && !view.event;
      const priorRound = previous?.view.round === view.round && view.event !== null ? previous.view : undefined;
      const enemy = opponentPositions(layout, width, view.opponentCount);
      this.opponentButton.hidden = !enemy.length;
      if (enemy.length) this.positionButton(this.opponentButton, {
        x: enemy[0]!.x, y: 0, width: enemy.at(-1)!.x + enemy.at(-1)!.width - enemy[0]!.x,
        clipHeight: layout.opponentVisible,
      });
      const oldEnemy = motion && priorRound ? opponentPositions(layout, width, priorRound.opponentCount) : undefined;
      const opponentPlayed = motion && view.event?.kind === "play" && view.event.seat !== view.seat;
      const playing = motion && priorRound && view.event?.kind === "play";
      const stagedCommit = !!playing && view.event?.seat === view.seat && committedFromPlay(view.visibleDiscard, previous);
      // Keep the deck and collapse anchor at their actual on-screen positions.
      // Only restore the final layout after the new play has covered the old one.
      const appendedStock = playing ? this.priorStockPosition ?? stock : undefined;
      const collapseAnchor = playing ? priorPositions.get(priorRound.visibleDiscard[0]!.id) : undefined;
      const phases = appendedStock ? playPhases(stagedCommit,
        !samePosition(appendedStock, stock) || !samePosition(collapseAnchor, layout.piles.discard[0]!), opponentWildPlay(view)) : undefined;
      const drawingSeat = view.event?.kind === "draw" ? view.event.seat : view.event?.penalty?.seat ?? view.seat;
      const shuffleDraw = reshuffling ? drawTimeline(view, drawingSeat) : undefined;
      this.drawStock(stock, view.stockCount, backTexture, layout, adjusting, appendedStock, phases,
        shuffleDraw, view.event?.kind === "shuffle" ? 0 : previous?.view.stockCount, back);
      this.drawDiscard(view, layout, stock, priorPositions, oldEnemy, adjusting, phases,
        motion && priorRound ? previous : undefined);
      this.drawOpponent(enemy, backTexture, stock, drawTimeline(view, otherSeat(view.seat)), initialDeal, opponentPlayed, oldEnemy);

      const stagedTargets = layout.piles.play.map((position, index) => {
        const card = staged[index]!;
        const depth = CARD_DEPTH.play + index;
        return { card, position, dimmed: false, staged: true, depth };
      });
      const legal = new Set(view.legalLeads);
      const last = staged.at(-1);
      const handActive = view.turn === view.seat && !view.result && !view.queuedCards.length;
      const canStage = handActive && staged.length < PLAY_SLOTS;
      const handTargets = handSlots.map((position, index) => {
        const card = cards[index]!;
        const playable = canStage && (last ? canFollowInQueue(card, last) : legal.has(card.id));
        return { card, position, dimmed: !!this.state?.dimUnplayable && handActive && !playable, staged: false, depth: CARD_DEPTH.hand + index };
      }).filter(({ card }) => !stagedIds.has(card.id));
      const buttons = this.placeTargets(stagedTargets, handTargets, view);
      for (const { card, position, depth } of stagedTargets) {
        const from = priorPositions.get(card.id);
        const image = this.drawImage(this.art.face(card), position, depth);
        const button = buttons.get(card.id)!;
        this.priorCardPositions.set(card.id, position);
        if (adjusting && from) {
          const inFlight = priorFlights.has(card.id) || !previous?.staged.some(item => item.id === card.id);
          if (inFlight) { image.setDepth(CARD_DEPTH.staging + depth - CARD_DEPTH.play); this.stagingFlights.add(card.id); }
          const move = (t: number) => this.positionButton(button,
            this.moveCard(image, from, position, t, card.id, inFlight ? 16 : 0));
          move(0);
          this.tween(STAGE_FLIGHT, move, () => { image.setDepth(depth); this.stagingFlights.delete(card.id); });
        }
      }
      const draw = drawTimeline(view, view.seat);
      const movingDraw = motion && !!priorRound && draw.count > 0;
      this.drawHand(handTargets, buttons, view, stock, priorPositions, priorShades, motion, adjusting, initialDeal,
        movingDraw ? draw : undefined);
      if (reshuffling) {
        this.recycling = true;
        const ready = handReadinessTimeline(view);
        this.tween(ready.start + ready.duration, () => {}, () => {
          this.recycling = false;
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

  private drawFelt(layout: Layout, width: number): void {
    const { pileY, pileHeight } = layout;
    const felt = this.add.graphics().setDepth(-1);
    const middle = pileY + pileHeight / 2;
    felt.lineStyle(1, 0xf4db9c, .12);
    felt.strokeEllipse(width / 2, middle, width * .88, pileHeight + 41);
    felt.lineStyle(1, 0xf4db9c, .055);
    felt.strokeEllipse(width / 2, middle, width * .94, pileHeight + 58);
  }

  private updateHandMask(layout: Layout, pixelWidth: number, pixelHeight: number): void {
    this.handEdge = layout.tableWidth - layout.inset;
    this.handBottom = layout.tableHeight - layout.inset;
    const mask = document.createElement("canvas");
    mask.width = pixelWidth;
    mask.height = pixelHeight;
    const ctx = mask.getContext("2d")!;
    ctx.scale(pixelWidth / layout.tableWidth, pixelHeight / layout.tableHeight);
    // Start above the card stroke and align to physical pixels: fractional
    // mask edges must not leave an unmasked hairline across the right margin.
    const pixelScaleY = pixelHeight / layout.tableHeight;
    const maskTop = Math.max(0, Math.floor((layout.handY - 2) * pixelScaleY) / pixelScaleY);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, layout.tableWidth, maskTop);
    ctx.fillRect(0, maskTop, this.handEdge - HAND_FADE_WIDTH, layout.tableHeight);
    const fade = ctx.createLinearGradient(this.handEdge - HAND_FADE_WIDTH, 0, this.handEdge, 0);
    fade.addColorStop(0, "rgba(255,255,255,1)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(this.handEdge - HAND_FADE_WIDTH, maskTop, HAND_FADE_WIDTH, layout.tableHeight);
    // Multiply the existing right fade by the bottom fade, including their corner.
    const bottomFade = ctx.createLinearGradient(0, this.handBottom - HAND_FADE_WIDTH, 0, this.handBottom);
    bottomFade.addColorStop(0, "rgba(255,255,255,1)");
    bottomFade.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = bottomFade;
    ctx.fillRect(0, 0, layout.tableWidth, layout.tableHeight);
    // Mask the already-composited canvas only within the hand region. Piles and
    // opponent cards are above it; flights cross this fixed boundary smoothly.
    // CSS compositing supports both Phaser's WebGL and Canvas renderers without
    // reparenting cards or changing their existing global depth ordering.
    const canvas = this.game.canvas;
    canvas.style.maskImage = `url(${mask.toDataURL()})`;
    canvas.style.maskSize = "100% 100%";
    canvas.style.maskRepeat = "no-repeat";
  }

  private drawStock(
    deck: CardPosition, count: number, texture: string, layout: Layout, adjusting: boolean,
    appended?: CardPosition, phases?: PlayPhases, draw?: DrawTimeline, beforeCount = count, back = 0,
  ): void {
    const visible = draw ? 4 : stockLayerCount(count);
    const images: CardImage[] = [];
    for (let index = visible - 1; index >= 0; index--) {
      images[index] = this.drawImage(texture, deck, CARD_DEPTH.stock + visible - index - 1);
    }
    const place = (position: CardPosition, stockCount = draw ? beforeCount : count) => {
      const step = 2 * position.width / layout.basePileWidth;
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
    place(from && (adjusting || appended) ? from : deck);
    if (from && appended && phases) {
      this.tween(phases.total, progress => {
        const elapsed = progress * phases.total;
        place(elapsed < phases.flight ? between(from, appended, ease(elapsed / phases.flight)) :
          between(appended, deck, ease(unit((elapsed - phases.returnStart) / Math.max(1, phases.total - phases.returnStart)))));
      }, undefined, 0, "Linear");
    } else if (from && adjusting && !samePosition(from, deck)) {
      this.tween(STAGE_FLIGHT, t => place(between(from, deck, t)));
    }
    if (!draw?.shuffles.length) return;
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
        const value = completed.at(-1)?.pointsAfter ?? draw.shuffles[0]!.pointsBefore;
        points(value, value);
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
    draw: DrawTimeline, initialDeal: boolean, played: boolean, previous?: CardPosition[],
  ): void {
    const arrivals: Arrival[] = [];
    enemy.forEach((position, index) => {
      const image = this.drawImage(texture, position, CARD_DEPTH.opponent + index);
      const from = previous?.[index];
      if (initialDeal) {
        this.deal(image, stock, position, OPPONENT_DEAL);
      } else if (previous && draw.count > 0 && index >= enemy.length - draw.count) {
        arrivals.push({ image, position });
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
    adjusting: boolean, phases: PlayPhases | undefined, previous?: BoardState,
  ): void {
    const width = layout.tableWidth;
    const last = view.visibleDiscard;
    const targets = layout.piles.discard;
    const old = view.event?.kind === "play" ? previous?.view.visibleDiscard ?? [] : [];
    const firstTarget = targets[0]!;
    const lastTarget = targets.at(-1)!;
    this.positionButton(this.discardButton, {
      ...firstTarget, clipWidth: lastTarget.x - firstTarget.x + lastTarget.width,
    });
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
    const timing = phases ?? playPhases(alreadyQueued, false, opponentWildPlay(view));
    const anchor = outgoingTargets[0]!;
    const collapsedPositions = collapsePlayPositions(anchor, last.length);
    const incoming = last.map((card, index) => {
      const enemyIndex = Math.max(0, (opponent?.length ?? 0) - last.length + index);
      const from = playerPlayed ? previousPositions.get(card.id) ?? at((width - layout.handWidth) / 2, layout.handY, layout.handWidth)
        : opponent?.[enemyIndex] ?? stock;
      const depth = playerPlayed ? CARD_DEPTH.staging + PLAY_SLOTS + index : CARD_DEPTH.opponent + enemyIndex;
      const reel = !playerPlayed && index === last.length - 1 && card.special === "wild"
        ? wildReel(card.suit, card.calledSuit ?? card.suit, Math.random, wildSuitOptions(previous!.view.activeSuit, last.length)) : undefined;
      const image = this.drawImage(this.art.face(card, reel ? { suits: reel, progress: 0 } : undefined), from, depth);
      this.priorCardPositions.set(card.id, from);
      const collapsed = collapsedPositions[index]!;
      return { image, from, appended: alreadyQueued ? from : landing[index]!, collapsed, target: targets[index]!, id: card.id, card, reel };
    });

    let landed = false;
    let soundedStop = 0;
    if (incoming.some(card => card.reel)) this.board.dataset.wildReel = String(last.at(-1)!.id);
    this.tween(timing.total, progress => {
      const elapsed = progress * timing.total;
      for (const { card, reel } of incoming) if (reel) {
        const progress = unit(elapsed / timing.reelEnd);
        this.art.face(card, { suits: reel, progress });
        const stop = wildReelStop(reel, progress);
        if (stop > soundedStop) { soundedStop = stop; this.controls.suitBling?.(); }
      }
      if (incoming.some(card => card.reel)) this.board.dataset.wildPhase = elapsed < timing.flight ? "flight" : elapsed < timing.reelEnd ? "hold" : "slide";
      if (elapsed < timing.flight) {
        const flight = ease(elapsed / timing.flight);
        const spread = unit(flight * 2);
        outgoing.forEach((image, index) => this.moveCard(image, prior[index]!, outgoingTargets[index]!, spread));
        incoming.forEach(({ image, from, appended, id }, index) => {
          this.moveCard(image, from, appended, unit((flight - index * .055) / .835), id, alreadyQueued ? 0 : 18);
        });
        return;
      }

      if (!landed) {
        landed = true;
        incoming.forEach(({ image }, index) => image.setDepth(CARD_DEPTH.discard + old.length + index));
      }
      const slide = ease(unit((elapsed - timing.collapseStart) / (timing.collapseEnd - timing.collapseStart)));
      const restore = ease(unit((elapsed - timing.returnStart) / Math.max(1, timing.total - timing.returnStart)));
      outgoing.forEach((image, index) => {
        const start = outgoingTargets[index]!;
        const collapsed = { ...start, x: anchor.x };
        this.placeImage(image, elapsed < timing.returnStart ? { ...start, x: lerp(start.x, anchor.x, slide) }
          : between(collapsed, targets[0]!, restore));
      });
      incoming.forEach(({ image, appended, collapsed, target, id }) =>
        elapsed < timing.returnStart ? this.moveCard(image, appended, collapsed, slide, id) :
          this.moveCard(image, collapsed, target, restore, id));
    }, () => {
      delete this.board.dataset.wildReel;
      delete this.board.dataset.wildPhase;
      outgoing.forEach(image => image.destroy());
      incoming.forEach(({ image }, index) => image.setDepth(CARD_DEPTH.discard + index));
    }, 0, "Linear");
  }

  private drawHand(
    targets: CardTarget[], buttons: Map<number, HTMLButtonElement>, view: TableView,
    stock: CardPosition, previousPositions: Map<number, CardPosition>, previousShades: Map<number, number>, motion: boolean,
    stagingChanged: boolean, initialDeal: boolean, draw?: DrawTimeline,
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
      const initialDepth = draw && drawIndex === undefined && from
        ? previousDepths.get(card.id) ?? depth : depth;
      const image = this.drawImage(this.art.face(card), position, initialDepth);
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
    arrivals.forEach(({ image, position, id }, index) => {
      this.moveCard(image, stock, position, 0, id);
      image.setVisible(draw.cardStarts[index] === 0);
    });

    const span = draw.total - draw.start;
    this.tween(span, progress => {
      const elapsed = progress * span;
      arrivals.forEach(({ image, position, id }, index) => {
        const age = elapsed + draw.start - draw.cardStarts[index]!;
        if (age < 0) return;
        image.setVisible(true);
        this.moveCard(image, stock, position, ease(unit((age - draw.reveal) / draw.duration)), id, 14);
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

  private bindCardGesture(button: HTMLButtonElement, id: number, staged: boolean): void {
    let start: { x: number; y: number; time: number; pointer: number } | undefined;
    let suppressClick = false;
    button.onpointerdown = event => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      start = { x: event.clientX, y: event.clientY, time: event.timeStamp, pointer: event.pointerId };
      if (event.isTrusted) button.setPointerCapture(event.pointerId);
    };
    button.onpointercancel = () => { start = undefined; suppressClick = true; };
    button.onpointerup = event => {
      if (!start || start.pointer !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const elapsed = event.timeStamp - start.time;
      const gesture = staged ? queuedCardFlick(dx, dy, elapsed) : undefined;
      const flick = !staged && isUpwardFlick(dx, dy, elapsed);
      start = undefined;
      suppressClick = Math.hypot(dx, dy) > 12;
      if (gesture === "play") this.controls.playQueue();
      else if (gesture === "clear") this.controls.clearPlay();
      else if (flick) this.controls.flickCard(id);
    };
    button.onclick = event => {
      if (!suppressClick || event.detail === 0) this.controls.tapCard(id);
    };
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

  private tween(duration: number, frame: (t: number) => void, done?: () => void, delay = 0, easing = "Sine.InOut"): void {
    const progress = { t: 0 };
    this.tweens.add({
      targets: progress, t: 1, duration: duration / this.speed, delay: delay / this.speed, ease: easing,
      onUpdate: () => frame(progress.t),
      onComplete: () => { frame(1); done?.(); },
    });
  }
}
