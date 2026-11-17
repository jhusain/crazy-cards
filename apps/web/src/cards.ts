import type Phaser from "phaser";
import type { Card, PlayedCard, Special, Suit } from "@crazy-eights/protocol";
import { ART_WIDTH as CARD_WIDTH, ART_HEIGHT as CARD_HEIGHT } from "./table-layout.ts";
import jack from "./art/jack.svg?inline";
import queen from "./art/queen.svg?inline";
import king from "./art/king.svg?inline";

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

export async function loadCardArt(): Promise<{ court: HTMLImageElement[]; backs: (HTMLImageElement | null)[] }> {
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
  const [court, backs] = await Promise.all([
    Promise.all([jack, queen, king].map(load)),
    Promise.all(DECKS.map(deck => deck.art ? load(deck.art) : null)),
  ]);
  return { court, backs };
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
  constructor(
    private readonly textures: Phaser.Textures.TextureManager,
    private readonly art: Awaited<ReturnType<typeof loadCardArt>>,
    private readonly density: number,
  ) {}

  face(card: PlayedCard): string {
    const suit = card.calledSuit ?? card.suit;
    const key = `face:${card.id}:${suit}`;
    if (this.textures.exists(key)) return key;
    const texture = this.textures.createCanvas(key, CARD_WIDTH * this.density, CARD_HEIGHT * this.density)!;
    const ctx = texture.getContext();
    ctx.scale(this.density, this.density);
    this.paper(ctx);
    const red = suit === "hearts" || suit === "diamonds";
    const ink = red ? "#a6293d" : "#202c33";
    const special = SPECIAL_LABEL[card.special];
    const accent = card.special === "wild" ? "#713790" : card.special === "pickup" || card.special === "super-pickup"
      ? "#974b10" : "#285876";

    if (card.rank >= 11) {
      const portrait = this.art.court[card.rank - 11]!;
      const scale = Math.min(79 / portrait.naturalWidth, 123 / portrait.naturalHeight);
      const width = portrait.naturalWidth * scale;
      const height = portrait.naturalHeight * scale;
      ctx.drawImage(portrait, CENTER_X - width / 2, CENTER_Y - height / 2, width, height);
    } else {
      this.pips(ctx, card.rank, suit, ink);
    }

    const corner = () => {
      label(ctx, rankLabel(card.rank), 19, 24, card.rank === 10 ? 27 : 33, "serif", ink);
      label(ctx, SUIT_SYMBOL[suit], 19, 52, 24, "serif", ink);
    };
    corner();
    ctx.save();
    ctx.translate(CARD_WIDTH, CARD_HEIGHT);
    ctx.rotate(Math.PI);
    corner();
    ctx.restore();
    if (special) {
      rounded(ctx, 42, 148, 58, 22, 5);
      ctx.fillStyle = accent;
      ctx.fill();
      label(ctx, special, CENTER_X, 159.5, 14, "sans-serif", "#fff0d7");
    }
    texture.refresh();
    return key;
  }

  back(index: number): string {
    const key = `back:${index}`;
    if (this.textures.exists(key)) return key;
    const texture = this.textures.createCanvas(key, CARD_WIDTH * this.density, CARD_HEIGHT * this.density)!;
    const ctx = texture.getContext();
    ctx.scale(this.density, this.density);
    this.paper(ctx);
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
      ctx.beginPath();
      ctx.moveTo(CENTER_X, 48);
      ctx.lineTo(106, CENTER_Y);
      ctx.lineTo(CENTER_X, 142);
      ctx.lineTo(36, CENTER_Y);
      ctx.closePath();
      ctx.fillStyle = "#213840";
      ctx.fill();
      ctx.stroke();
      label(ctx, "8", CENTER_X, CENTER_Y - 1, 46, "Georgia, serif", "#f1d18e");
    }
    ctx.restore();
    texture.refresh();
    return key;
  }

  private paper(ctx: CanvasRenderingContext2D): void {
    rounded(ctx, 0.5, 0.5, CARD_WIDTH - 1, CARD_HEIGHT - 1, 13);
    const grade = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    grade.addColorStop(0, "#fffdf1");
    grade.addColorStop(.56, "#fcf2df");
    grade.addColorStop(1, "#e9d5b3");
    ctx.fillStyle = grade;
    ctx.fill();
    ctx.strokeStyle = "#c4a97d";
    ctx.stroke();
  }

  private pips(ctx: CanvasRenderingContext2D, rank: number, suit: Suit, color: string): void {
    const symbol = SUIT_SYMBOL[suit];
    if (rank === 1 || rank === 8) {
      label(ctx, symbol, CENTER_X, CENTER_Y + 2, 73, "Georgia, serif", color);
      return;
    }
    if (rank <= 3) {
      const rows = rank === 2 ? [49, 137] : [49, 93, 137];
      rows.forEach(y => label(ctx, symbol, CENTER_X, y, 39, "Georgia, serif", color));
      return;
    }
    const rows = rank <= 5 ? [49, 137] : rank <= 7 ? [49, 93, 137] : [43, 75, 109, 141];
    for (const y of rows) {
      label(ctx, symbol, 52, y, 30, "Georgia, serif", color);
      label(ctx, symbol, 90, y, 30, "Georgia, serif", color);
    }
    if (rank % 2 === 1) label(ctx, symbol, CENTER_X, rank === 7 ? 71 : 93, 28, "Georgia, serif", color);
    if (rank === 10) [59, 125].forEach(y => label(ctx, symbol, CENTER_X, y, 24, "Georgia, serif", color));
  }
}
