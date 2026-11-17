import Phaser from "phaser";
import { PLAY_SLOTS, canFollowInQueue, otherSeat, type Card, type TableView } from "@crazy-eights/protocol";
import { CardTextures, describeCard, loadCardArt } from "./cards.ts";
import { isUpwardFlick, isVerticalFlick } from "./card-gesture.ts";
import { keepCornersVisible } from "./hand-motion.ts";
import {
  ART_WIDTH, CORNER_HEIGHT, CORNER_WIDTH, artHeight, discardPositions, groupHandRows, handPositions, opponentPositions, playPositions,
  tableLayout, type CardPosition,
} from "./table-layout.ts";
import type { GameSettings } from "./settings.ts";
import {
  HAND_DEAL, HAND_DRAW, OPPONENT_DEAL, PLAY_FLIGHT, PLAY_HOLD, PLAY_SLIDE, STAGE_FLIGHT, drawTimeline,
} from "./table-timing.ts";

type Layout = ReturnType<typeof tableLayout>;
type Image = Phaser.GameObjects.Image;
type BoardState = {
  view: TableView; staged: Card[]; back: number; locked: boolean;
  pickup: GameSettings["pickupAnimation"];
};
type Controls = {
  tapCard: (id: number) => void; flickCard: (id: number) => void;
  playQueue: () => void; clearPlay: () => void; ready: () => void;
};
type CardTarget = { card: Card; position: CardPosition; staged: boolean };

const at = (x: number, y: number, width: number): CardPosition => ({ x, y, width });
const lerp = Phaser.Math.Linear;
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
  private painting = false;
  private speed = 1;
  private readonly textureDensity: number;
  private layoutWidth = 0;
  private layoutHeight = 0;

  constructor(
    private readonly board: HTMLElement,
    private readonly cardTargets: HTMLElement,
    private readonly stockButton: HTMLButtonElement,
    private readonly discardButton: HTMLButtonElement,
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
    const observer = new ResizeObserver(() => {
      if (this.board.clientWidth !== this.layoutWidth || this.board.clientHeight !== this.layoutHeight) this.paint();
    });
    observer.observe(this.board);
    const resize = () => this.paint();
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
    if (this.art) this.paint(previous, animate);
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
      this.children.removeAll(true);
      const { view, staged = [], back = 0, pickup = "sequential" } = this.state ?? {};
      const stagedIds = new Set(staged.map(card => card.id));
      const committedIds = new Set(view?.queuedCards);
      const cards = (view?.hand ?? []).filter(card => !committedIds.has(card.id));
      const width = this.board.clientWidth;
      // Reserve the original slots while editing a play. Once committed, reserve
      // the final hand slots even when the server is still executing later groups.
      const rows = groupHandRows(cards);
      const height = this.board.clientHeight;
      if (!width || !height) return;
      this.layoutWidth = width;
      this.layoutHeight = height;
      const density = Math.min(this.density, 4096 / Math.max(width, height));
      const pixelWidth = Math.round(width * density);
      const pixelHeight = Math.round(height * density);
      if (pixelWidth !== this.scale.gameSize.width || pixelHeight !== this.scale.gameSize.height) {
        this.scale.resize(pixelWidth, pixelHeight);
      }
      this.cameras.main.setZoom(pixelWidth / width, pixelHeight / height);
      const layout = tableLayout(width, height, rows.length);
      const { pileY, pileHeight, pileWidth, stageY } = layout;
      this.board.style.setProperty("--turn-split", pileY + pileHeight * .53 + "px");
      this.board.style.setProperty("--notice-y", stageY + "px");
      const stock = at(layout.stockLeft, pileY, pileWidth);
      this.drawFelt(layout, width);

      if (!view) return;

      const backTexture = this.art.back(back);
      const priorPositions = this.priorCardPositions;
      this.priorCardPositions = new Map();
      this.drawStock(stock, view.stockCount, backTexture);
      const motion = animate && previous?.view.revision !== view.revision;
      const stagingChanged = animate && !!previous &&
        (staged.length !== previous.staged.length || staged.some((card, index) => card.id !== previous.staged[index]?.id));
      const initialDeal = motion && !view.event;
      const priorRound = previous?.view.round === view.round && view.event !== null ? previous.view : undefined;
      const enemy = opponentPositions(layout, width, view.opponentCount);
      this.drawOpponent(enemy, backTexture, stock, drawTimeline(view, otherSeat(view.seat), pickup), initialDeal,
        motion && priorRound ? opponentPositions(layout, width, priorRound.opponentCount) : undefined);
      this.drawDiscard(view, layout, width, stock, priorPositions, motion ? priorRound : undefined);

      const stagedTargets = playPositions(layout, staged.length).map((position, index) => {
        const card = staged[index]!;
        const from = priorPositions.get(card.id);
        const depth = 2 + index / PLAY_SLOTS;
        const image = this.drawImage(this.art.face(card), position).setDepth(depth);
        this.priorCardPositions.set(card.id, position);
        if (stagingChanged && from) {
          const fromHand = !previous.staged.some(item => item.id === card.id);
          if (fromHand) image.setDepth(208);
          this.placeImage(image, from);
          this.priorCardPositions.set(card.id, from);
          this.tween(STAGE_FLIGHT, t => {
            const current = between(from, position, t, fromHand ? 16 : 0);
            this.placeImage(image, current);
            this.priorCardPositions.set(card.id, current);
          }, () => image.setDepth(depth));
        }
        return { card, position, staged: true };
      });
      const handTargets = handPositions(layout, rows).map((position, index) => ({
        card: cards[index]!, position, staged: false,
      })).filter(({ card }) => !stagedIds.has(card.id));
      const draw = drawTimeline(view, view.seat, pickup);
      const played = motion && !!priorRound && view.event?.kind === "play" && view.event.seat === view.seat;
      const movingDraw = motion && !!priorRound && draw.count > 0;
      this.drawHand(handTargets, staged, view, width, height, stock, priorPositions,
        movingDraw || stagingChanged || played, initialDeal, movingDraw ? draw : undefined);
      this.placeTargets(stagedTargets, handTargets, view);
    } finally {
      this.painting = false;
    }
  }

  private drawFelt(layout: Layout, width: number): void {
    const { pileY, pileHeight } = layout;
    const felt = this.add.graphics();
    const middle = pileY + pileHeight / 2;
    felt.lineStyle(1, 0xf4db9c, .12);
    felt.strokeEllipse(width / 2, middle, width * .88, pileHeight + 41);
    felt.lineStyle(1, 0xf4db9c, .055);
    felt.strokeEllipse(width / 2, middle, width * .94, pileHeight + 58);
  }

  private drawStock(deck: CardPosition, count: number, texture: string): void {
    const visible = count ? Math.min(4, 1 + Math.ceil(count / 13)) : 1;
    for (let index = visible - 1; index >= 0; index--) {
      this.drawImage(texture, { ...deck, x: deck.x + index * 2, y: deck.y + index * 2 })
        .setAlpha(count ? 1 : .62);
    }
    this.positionButton(this.stockButton, { ...deck, clipWidth: deck.width + 6, clipHeight: artHeight(deck.width) + 6 });
  }

  private drawOpponent(
    enemy: CardPosition[], texture: string, stock: CardPosition,
    draw: ReturnType<typeof drawTimeline>, initialDeal: boolean, previous?: CardPosition[],
  ): void {
    enemy.forEach((position, index) => {
      const image = this.drawImage(texture, position);
      if (initialDeal) {
        this.fly(image, stock, position, OPPONENT_DEAL);
      } else if (previous && draw.count) {
        const drawIndex = index - (enemy.length - draw.count);
        const from = previous[index];
        if (drawIndex >= 0) {
          const delay = draw.start + (draw.sequential ? draw.reflow + drawIndex * draw.duration : 0);
          this.fly(image, stock, position, draw.duration, delay);
        } else if (from && from.x !== position.x) {
          this.placeImage(image, from);
          this.tween(draw.duration, t => this.placeImage(image, between(from, position, t)), undefined, draw.start);
        }
      }
    });
  }

  private drawDiscard(
    view: TableView, layout: Layout, width: number, stock: CardPosition,
    previousPositions: Map<number, CardPosition>, previous?: TableView,
  ): void {
    const last = view.visibleDiscard;
    const targets = discardPositions(layout, width, last.length);
    const eventsArePlays = previous && view.event?.kind === "play";
    const old = eventsArePlays ? previous.visibleDiscard : [];
    const prior = discardPositions(layout, width, old.length);
    const lastTarget = targets.at(-1)!;
    this.positionButton(this.discardButton, {
      ...targets[0]!, clipWidth: lastTarget.x - targets[0]!.x + lastTarget.width,
    });
    if (!old.length) {
      last.forEach((card, index) => this.drawImage(this.art.face(card), targets[index]!));
      return;
    }

    const combined = discardPositions(layout, width, old.length + last.length);
    const outgoing = old.map((card, index) => this.drawImage(this.art.face(card), prior[index]!).setDepth(210 + index));
    const opponent = opponentPositions(layout, width, Math.max(previous?.opponentCount ?? 0, last.length));
    const incoming = last.map((card, index) => {
      const from = view.event!.seat === view.seat
        ? previousPositions.get(card.id) ?? at((width - layout.handWidth) / 2, layout.stageY, layout.handWidth)
        : opponent[opponent.length - last.length + index] ?? stock;
      const image = this.drawImage(this.art.face(card), from).setDepth(220 + index);
      return { image, from, appended: combined[old.length + index]!, target: targets[index]! };
    });

    this.tween(PLAY_FLIGHT, t => {
      const spread = Math.min(t * 2, 1);
      outgoing.forEach((image, index) =>
        this.placeImage(image, between(prior[index]!, combined[index]!, spread)));
      incoming.forEach(({ image, from, appended }, index) => {
        const flight = Math.max(0, Math.min(1, (t - index * .055) / .835));
        this.placeImage(image, between(from, appended, flight, 18));
      });
    }, () => this.tween(PLAY_SLIDE, t => {
      outgoing.forEach((image, index) => {
        const start = combined[index]!;
        image.setPosition(lerp(start.x, layout.discardLeft, t), start.y)
          .setScale(this.textureScale(start.width) * (1 - t), this.textureScale(start.width))
          .setAlpha(1 - t * t);
      });
      incoming.forEach(({ image, appended, target }) => this.placeImage(image, between(appended, target, t)));
    }, () => outgoing.forEach(image => image.destroy()), PLAY_HOLD));
  }

  private drawHand(
    targets: CardTarget[], staged: Card[], view: TableView, width: number, height: number,
    stock: CardPosition, previousPositions: Map<number, CardPosition>, moving: boolean, initialDeal: boolean,
    draw?: ReturnType<typeof drawTimeline>,
  ): void {
    const legal = new Set(view.legalLeads);
    const last = staged.at(-1);
    const tracks = targets.map(({ card, position }, index) => {
      const playable = view.turn === view.seat && !view.queuedCards.length && staged.length < PLAY_SLOTS &&
        (last ? canFollowInQueue(card, last) : legal.has(card.id));
      const depth = 12 + index * 2;
      const texture = this.art.face(card);
      const image = this.drawImage(texture, position).setDepth(depth);
      const mark = playable ? this.add.graphics().setDepth(depth + 1) : undefined;
      if (mark) {
        const width = position.width;
        const height = artHeight(width);
        const radius = width * 13 / ART_WIDTH;
        mark.lineStyle(9, 0xffc036, .23).strokeRoundedRect(.5, .5, width - 1, height - 1, radius);
        mark.lineStyle(5, 0xffd34d, .50).strokeRoundedRect(.5, .5, width - 1, height - 1, radius);
        mark.lineStyle(2, 0xffe873, 1).strokeRoundedRect(.5, .5, width - 1, height - 1, radius);
        mark.setPosition(position.x, position.y).setVisible(!initialDeal);
      }
      if (initialDeal) this.fly(image, stock, position, HAND_DEAL, 0,
        () => mark?.setVisible(true));
      this.priorCardPositions.set(card.id, position);
      return { image, texture, mark, position, previous: previousPositions.get(card.id), index };
    });
    if (!moving || tracks.every(track => samePosition(track.previous, track.position))) return;

    const back = this.art.back(this.state!.back);
    if (draw?.sequential) {
      const order = view.event?.drawnCards ?? [];
      const arrivals = tracks.filter(track => !track.previous)
        .sort((a, b) => order.indexOf(targets[a.index]!.card.id) - order.indexOf(targets[b.index]!.card.id));
      arrivals.forEach((track, index) => {
        const { image, mark, position, texture } = track;
        const card = targets[track.index]!.card;
        const depth = image.depth;
        image.setDepth(11).setTexture(back).setVisible(false);
        mark?.setVisible(false);
        this.placeImage(image, stock);
        this.priorCardPositions.set(card.id, stock);
        this.tween(draw.duration, t => {
          image.setVisible(true);
          if (t >= .36 && image.texture.key !== texture) image.setTexture(texture);
          const current = between(stock, position, t, 14);
          this.placeImage(image, current);
          this.priorCardPositions.set(card.id, current);
        }, () => {
          image.setDepth(depth);
          mark?.setVisible(true);
        }, draw.start + draw.reflow + index * draw.duration);
      });
    }
    const motion = tracks.filter(track => !draw?.sequential || track.previous).map(track => {
      const corner = this.add.image(0, 0, track.texture).setOrigin(0)
        .setCrop(0, 0, CORNER_WIDTH * this.textureDensity, CORNER_HEIGHT * this.textureDensity)
        .setDepth(320 + track.index);
      return { ...track, corner, from: track.previous ?? stock };
    });
    // Existing cards reserve their corner rectangles before any card arriving from the stock.
    const priority = motion.slice().sort((a, b) => Number(!a.previous) - Number(!b.previous));
    const frame = (t: number) => {
      const desired = priority.map(track => between(track.from, track.position, t, track.previous ? 0 : 14));
      const positions = keepCornersVisible(desired.filter((_, index) => priority[index]!.previous || t >= .28), width, height);
      let nextFace = 0;
      priority.forEach((track, index) => {
        const showFace = !!track.previous || t >= .28;
        const position = showFace ? positions?.[nextFace++] ?? track.position : desired[index]!;
        const texture = showFace ? track.texture : back;
        if (track.image.texture.key !== texture) track.image.setTexture(texture);
        this.placeImage(track.image, position);
        this.priorCardPositions.set(targets[track.index]!.card.id, position);
        track.corner.setVisible(showFace).setPosition(position.x, position.y).setScale(this.textureScale(position.width));
        track.mark?.setVisible(t > .85 || samePosition(track.previous, track.position))
          .setPosition(position.x, position.y).setScale(position.width / track.position.width);
      });
    };
    frame(0);
    this.tween(HAND_DRAW, frame, () => {
      for (const track of motion) {
        this.placeImage(track.image, track.position);
        this.priorCardPositions.set(targets[track.index]!.card.id, track.position);
        track.mark?.setVisible(true).setPosition(track.position.x, track.position.y).setScale(1);
        track.corner.destroy();
      }
    }, draw?.start ?? 0);
  }

  private cardsEnabled(view: TableView): boolean {
    return !this.state?.locked && view.turn === view.seat && !view.result && !view.queuedCards.length;
  }

  private placeTargets(staged: CardTarget[], hand: CardTarget[], view: TableView): void {
    const activeId = (document.activeElement as HTMLElement | null)?.dataset.cardId;
    const enabled = this.cardsEnabled(view);
    const targets = [...staged, ...hand].map(({ card, position, staged }) => {
      const button = document.createElement("button");
      button.className = "card-target gesture-card";
      button.setAttribute("aria-label", describeCard(card));
      button.setAttribute("aria-pressed", String(staged));
      button.dataset.cardId = String(card.id);
      button.disabled = !enabled;
      this.bindCardGesture(button, card.id, staged);
      this.positionButton(button, position);
      return button;
    });
    this.cardTargets.replaceChildren(...targets);
    if (activeId && enabled) targets.find(button => button.dataset.cardId === activeId)?.focus({ preventScroll: true });
  }

  private bindCardGesture(button: HTMLButtonElement, id: number, staged: boolean): void {
    const isFlick = staged ? isVerticalFlick : isUpwardFlick;
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
      const flick = isFlick(dx, dy, event.timeStamp - start.time);
      start = undefined;
      suppressClick = Math.hypot(dx, dy) > 12;
      if (flick && staged) {
        if (dy < 0) this.controls.playQueue();
        else this.controls.clearPlay();
      }
      else if (flick) this.controls.flickCard(id);
    };
    button.onclick = event => {
      if (!suppressClick || event.detail === 0) this.controls.tapCard(id);
    };
  }

  private positionButton(button: HTMLButtonElement, position: CardPosition): void {
    button.style.left = position.x + "px";
    button.style.top = position.y + "px";
    button.style.width = (position.clipWidth ?? position.width) + "px";
    button.style.height = (position.clipHeight ?? artHeight(position.width)) + "px";
  }

  private drawImage(texture: string, position: CardPosition): Image {
    const image = this.add.image(position.x, position.y, texture).setOrigin(0);
    this.placeImage(image, position);
    return image;
  }

  private placeImage(image: Image, position: CardPosition): void {
    const scale = this.textureScale(position.width);
    image.setPosition(position.x, position.y).setScale(scale).setCrop(0, 0,
      (position.clipWidth ?? position.width) / scale, (position.clipHeight ?? artHeight(position.width)) / scale);
  }

  private textureScale(width: number): number {
    return width / (ART_WIDTH * this.textureDensity);
  }

  private fly(image: Image, from: CardPosition, to: CardPosition, duration: number, delay = 0, done?: () => void): void {
    this.placeImage(image, from);
    image.setAlpha(0);
    this.tween(duration, t => {
      this.placeImage(image, between(from, to, t, 11));
      image.setAlpha(Math.min(1, t * 9));
    }, done, delay);
  }

  private tween(duration: number, frame: (t: number) => void, done?: () => void, delay = 0): void {
    const progress = { t: 0 };
    this.tweens.add({
      targets: progress, t: 1, duration: duration / this.speed, delay: delay / this.speed, ease: "Sine.InOut",
      onUpdate: () => frame(progress.t),
      onComplete: () => { frame(1); done?.(); },
    });
  }
}
