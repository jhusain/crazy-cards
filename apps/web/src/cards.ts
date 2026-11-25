import type Phaser from "phaser";
import type { Card, PlayedCard, Special, Suit } from "@crazy-eights/protocol";
import { ART_WIDTH as CARD_WIDTH, ART_HEIGHT as CARD_HEIGHT } from "./table-layout.ts";
import { BACK_INNER_TOP, BACK_INNER_BOTTOM, pointRollOffsets } from "./shuffle-animation.ts";
import { suitInk, wildReelFrame, wildReelInk, type WildReel } from "./wild-reel.ts";

const imports = import.meta.glob<string>("./art/*.gif", { eager: true, import: "default", query: "?inline" });
const art = (file: string) => imports[`./art/${file}.gif`]!;

export const DECKS: { name: string; art?: string }[] = [
  { name: "House pattern" }, { name: "Tinker’s Dream", art: art("Tinker's Dream") },
  { name: "Anna", art: art("anna") }, { name: "Dad", art: art("dad") },
  { name: "Hash", art: art("hash") }, { name: "Jay", art: art("jay") },
  { name: "Kravitz", art: art("kravitz") }, { name: "Leaf", art: art("leaf") },
  { name: "Peace", art: art("peace") }, { name: "Viscious", art: art("viscious") },
  { name: "Zozo", art: art("zozo") },
];

export const SUIT_SYMBOL: Record<Suit, string> = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" };
export const SPECIAL_LABEL: Record<Special, string> = {
  normal: "", reverse: "SKIP", skip: "SKIP", pickup: "+2", "super-pickup": "+5", wild: "WILD",
};
export const rankLabel = (rank: number) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" })[rank] ?? String(rank);
export const suitLabel = (suit: Suit) => suit[0]!.toUpperCase() + suit.slice(1);
export const cardLabel = (card: Card) => ({ 1: "Ace", 11: "Jack", 12: "Queen", 13: "King" })[card.rank] ?? String(card.rank);
export const describeCard = (card: Card) => `${cardLabel(card)} of ${suitLabel(card.suit)}`;

const CENTER_X = CARD_WIDTH / 2;
const CENTER_Y = CARD_HEIGHT / 2;

export interface FaceTexture {
  paper: string;
  grayPaper: string;
  ink: string;
}

export async function loadCardArt(): Promise<{ backs: (HTMLImageElement | null)[] }> {
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = art("icon");
  document.head.append(icon);

  const load = async (source: string) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return image;
  };
  const backs = await Promise.all(DECKS.map(deck => deck.art ? load(deck.art) : null));
  return { backs };
}

function rounded(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  context.beginPath();
  context.roundRect(x, y, w, h, r);
}

function label(context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, font: string, color: string): void {
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = size + "px " + font;
  context.fillText(value, x, y);
}

export class CardTextures {
  private readonly suitBand = document.createElement("canvas");
  private readonly generated = new Set<string>();

  constructor(
    private readonly textures: Phaser.Textures.TextureManager,
    private readonly art: Awaited<ReturnType<typeof loadCardArt>>,
    private readonly density: number,
  ) {}

  face(card: PlayedCard, reel?: { reel: WildReel; progress: number }): FaceTexture {
    const suit = card.calledSuit ?? card.suit;
    const key = reel ? `wild-reel:${card.id}` : `face:${card.id}:${suit}`;
    const face = { paper: this.paper(false), grayPaper: this.paper(true), ink: key };
    if (this.textures.exists(key) && !reel) return face;
    const texture = this.textures.exists(key) ? this.textures.get(key) as Phaser.Textures.CanvasTexture :
      this.textures.createCanvas(key, CARD_WIDTH * this.density, CARD_HEIGHT * this.density)!;
    this.generated.add(key);
    const ctx = texture.getContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CARD_WIDTH * this.density, CARD_HEIGHT * this.density);
    ctx.setTransform(this.density, 0, 0, this.density, 0, 0);
    const ink = reel ? wildReelInk(reel.reel, reel.progress) : suitInk(suit);
    const special = SPECIAL_LABEL[card.special];
    const accent = card.special === "wild" ? "#713790" : card.special === "pickup" || card.special === "super-pickup"
      ? "#974b10" : "#285876";

    const index = (x: number, y: number, scale = 1, inverted = false) => {
      label(ctx, rankLabel(card.rank), x, y, (card.rank === 10 ? 27 : 33) * scale, "serif", ink);
      if (!reel) label(ctx, SUIT_SYMBOL[suit], x, y + 28 * scale, 24 * scale, "serif", ink);
      else this.drawSuitReel(ctx, x, y + 28 * scale, 24 * scale, reel, inverted);
    };

    index(CENTER_X, 58, 2);

    index(19, 24);
    ctx.save();
    ctx.translate(CARD_WIDTH, CARD_HEIGHT);
    ctx.rotate(Math.PI);
    index(19, 24, 1, true);
    ctx.restore();
    if (special) {
      rounded(ctx, 42, 148, 58, 22, 5);
      ctx.fillStyle = accent;
      ctx.fill();
      label(ctx, special, CENTER_X, 159.5, 14, "sans-serif", "#fff0d7");
    }
    texture.refresh();
    return face;
  }

  private drawSuitReel(ctx: CanvasRenderingContext2D, x: number, y: number, size: number,
    reel: { reel: WildReel; progress: number }, inverted: boolean): void {
    const width = size * 1.4, height = size + 10;
    const band = this.suitBand;
    band.width = Math.ceil(width * this.density);
    band.height = Math.ceil(height * this.density);
    const ink = band.getContext("2d")!;
    ink.scale(this.density, this.density);
    const frame = wildReelFrame(reel.reel, reel.progress);
    const direction = inverted ? -1 : 1;
    const draw = (suit: Suit, offset: number) => label(ink, SUIT_SYMBOL[suit], width / 2,
      height / 2 + offset * direction, size, "serif", suitInk(suit));
    draw(frame.current, frame.offset * height);
    if (frame.next) draw(frame.next, (frame.offset - 1) * height);
    const fade = ink.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, "transparent"); fade.addColorStop(5 / height, "white");
    fade.addColorStop(1 - 5 / height, "white"); fade.addColorStop(1, "transparent");
    ink.globalCompositeOperation = "destination-in";
    ink.fillStyle = fade;
    ink.fillRect(0, 0, width, height);
    ctx.drawImage(band, x - width / 2, y - height / 2, width, height);
  }

  back(index: number, pointsPerCard: number): string {
    const key = `back:${index}:${pointsPerCard}`;
    if (!this.textures.exists(key)) this.paintBack(key, index, pointsPerCard, pointsPerCard, 1);
    return key;
  }

  rollBack(index: number, from: number, to: number, progress: number): string {
    const key = `back-roll:${index}`;
    this.paintBack(key, index, from, to, progress);
    return key;
  }

  private paintBack(key: string, index: number, from: number, to: number, progress: number): void {
    const texture = this.textures.exists(key) ? this.textures.get(key) as Phaser.Textures.CanvasTexture :
      this.textures.createCanvas(key, CARD_WIDTH * this.density, CARD_HEIGHT * this.density)!;
    this.generated.add(key);
    const ctx = texture.getContext();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CARD_WIDTH * this.density, CARD_HEIGHT * this.density);
    ctx.drawImage(this.textures.get(this.backPaper(index)).getSourceImage() as CanvasImageSource, 0, 0);
    ctx.scale(this.density, this.density);
    ctx.beginPath();
    ctx.rect(14, BACK_INNER_TOP, CARD_WIDTH - 28, BACK_INNER_BOTTOM - BACK_INNER_TOP);
    ctx.clip();
    const points = (value: number, offset: number) => {
      let size = 62;
      while (size > 12) {
        ctx.font = size + "px Georgia, serif";
        if (ctx.measureText(String(value)).width <= CARD_WIDTH - 62) break;
        size--;
      }
      label(ctx, String(value), CENTER_X, CENTER_Y - 13 + offset, size, "Georgia, serif", "#f1d18e");
      label(ctx, value === 1 ? "pt" : "pts", CENTER_X, CENTER_Y + 37 + offset, 24, "Georgia, serif", "#f1d18e");
    };
    if (from === to) points(to, 0);
    else {
      const offset = pointRollOffsets(progress);
      points(from, offset.old);
      points(to, offset.next);
    }
    ctx.restore();
    texture.refresh();
  }

  private backPaper(index: number): string {
    const key = `back-paper:${index}`;
    if (this.textures.exists(key)) return key;
    const texture = this.textures.createCanvas(key, CARD_WIDTH * this.density, CARD_HEIGHT * this.density)!;
    this.generated.add(key);
    const ctx = texture.getContext();
    ctx.scale(this.density, this.density);
    this.drawPaper(ctx);
    rounded(ctx, 8, 8, CARD_WIDTH - 16, CARD_HEIGHT - 16, 10);
    ctx.save();
    ctx.clip();
    const original = this.art.backs[index];
    if (original) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(original, 8, 8, CARD_WIDTH - 16, CARD_HEIGHT - 16);
    } else {
      ctx.fillStyle = "#1b3942";
      ctx.fillRect(8, 8, CARD_WIDTH - 16, CARD_HEIGHT - 16);
      ctx.fillStyle = "#395855";
      for (let y = 14; y < CARD_HEIGHT; y += 12) {
        for (let x = 10 + (y % 24 === 14 ? 0 : 6); x < CARD_WIDTH; x += 12) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-2.3, -2.3, 4.6, 4.6);
          ctx.restore();
        }
      }
      ctx.strokeStyle = "#ccab6a";
      ctx.lineWidth = 1.5;
      rounded(ctx, 14, 14, CARD_WIDTH - 28, CARD_HEIGHT - 28, 7);
      ctx.stroke();
    }
    ctx.fillStyle = "#213840";
    ctx.fillRect(27, 42, CARD_WIDTH - 54, 107);
    ctx.restore();
    texture.refresh();
    return key;
  }

  destroy(): void {
    for (const key of this.generated) this.textures.remove(key);
    this.generated.clear();
  }

  private paper(gray: boolean): string {
    const key = gray ? "paper:gray" : "paper:normal";
    if (this.textures.exists(key)) return key;
    const texture = this.textures.createCanvas(key, CARD_WIDTH * this.density, CARD_HEIGHT * this.density)!;
    this.generated.add(key);
    const ctx = texture.getContext();
    ctx.scale(this.density, this.density);
    this.drawPaper(ctx, gray);
    texture.refresh();
    return key;
  }

  private drawPaper(ctx: CanvasRenderingContext2D, gray = false): void {
    rounded(ctx, 0.5, 0.5, CARD_WIDTH - 1, CARD_HEIGHT - 1, 13);
    const grade = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    grade.addColorStop(0, "#fffdf1");
    grade.addColorStop(.56, "#fcf2df");
    grade.addColorStop(1, "#e9d5b3");
    ctx.fillStyle = gray ? "#d5d8da" : grade;
    ctx.fill();
    ctx.strokeStyle = gray ? "#aab1b4" : "#c4a97d";
    ctx.stroke();
  }

}
