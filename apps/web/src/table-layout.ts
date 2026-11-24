export const CARDS_PER_ROW = 8;
export const ART_WIDTH = 142;
export const ART_HEIGHT = 190;
export const CORNER_WIDTH = 35;
export const CORNER_HEIGHT = 65;
export const HAND_FADE_WIDTH = 10;
export const PILE_STEP = .27;
const cornerHeight = (width: number) => width * CORNER_HEIGHT / ART_WIDTH;
export const artHeight = (width: number) => width * ART_HEIGHT / ART_WIDTH;
export const stockLayerCount = (count: number) => count ? Math.min(4, 1 + Math.ceil(count / 13)) : 1;

const DECK_SIZE = 52;
export const CARD_DEPTH = {
  discard: 0, stock: DECK_SIZE, opponent: 2 * DECK_SIZE, play: 3 * DECK_SIZE,
  hand: 4 * DECK_SIZE, staging: 5 * DECK_SIZE,
} as const;

export interface CardPosition {
  x: number; y: number; width: number; clipWidth?: number; clipHeight?: number;
}

export interface QueuedPileSlots {
  discardCount: number; playCount: number; playCapacity: number; playedCount: number;
}

const cardRow = (count: number, left: number, y: number, width: number): CardPosition[] =>
  Array.from({ length: count }, (_, index) => ({ x: left + index * width * PILE_STEP, y, width }));

export function groupHandRows<T extends { rank: number }>(cards: readonly T[], maxRowSize = CARDS_PER_ROW, keepGroupsTogether = true): T[][] {
  if (!keepGroupsTogether) return Array.from({ length: Math.ceil(cards.length / maxRowSize) }, (_, index) =>
    cards.slice(index * maxRowSize, (index + 1) * maxRowSize));
  const rows: T[][] = [];
  let row: T[] = [];
  for (let start = 0; start < cards.length;) {
    let end = start + 1;
    while (end < cards.length && cards[start]!.rank === cards[end]!.rank) end++;
    const run = cards.slice(start, end);
    if (row.length && row.length + run.length > maxRowSize) { rows.push(row); row = []; }
    row.push(...run);
    start = end;
  }
  if (row.length) rows.push(row);
  return rows;
}

function pileRow(
  tableWidth: number, inset: number, baseWidth: number, baseStockLeft: number,
  baseGap: number, y: number, discardCount: number, playCount: number, stockLayers: number, landing = false,
) {
  const gapRatio = baseGap / baseWidth;
  const deckRatio = 1 + 2 * (stockLayers - 1) / baseWidth;
  const clipRatio = deckRatio - PILE_STEP;
  const lastDiscard = deckRatio + gapRatio + Math.max(0, discardCount - 1) * PILE_STEP;
  const naturalOffset = landing ? PILE_STEP : 1 + gapRatio;
  const minimumOffset = landing ? PILE_STEP : 2 * PILE_STEP;
  // Without a queue, show the whole discard and reserve a square replay button.
  const rightRatio = (offset: number, full = false) => lastDiscard + (playCount
    ? offset + (playCount - 1) * PILE_STEP + (full ? 1 + gapRatio : PILE_STEP) : 1 + ART_HEIGHT / ART_WIDTH / 3);
  const right = playCount ? tableWidth : tableWidth - inset;
  // Shift the whole row to preserve the complete play and its right margin.
  // Once the deck reaches its minimum visible strip, allow card bodies to clip,
  // then close the queue gap, and finally scale the row uniformly.
  const width = Math.min(baseWidth, right / (rightRatio(minimumOffset) - clipRatio));
  const restingLeft = Math.min(baseStockLeft, tableWidth - inset - (lastDiscard + 1 + ART_HEIGHT / ART_WIDTH / 3) * width);
  const stockLeft = Math.max(-clipRatio * width, Math.min(restingLeft, right - rightRatio(naturalOffset, true) * width));
  const offset = Math.min(naturalOffset, Math.max(minimumOffset,
    (right - stockLeft) / width - lastDiscard - (playCount - 1) * PILE_STEP - PILE_STEP));
  const discardLeft = stockLeft + width * (deckRatio + gapRatio);
  const firstPlay = discardLeft + Math.max(0, discardCount - 1) * width * PILE_STEP + offset * width;
  return {
    stock: { x: stockLeft, y, width } as CardPosition,
    discard: cardRow(discardCount, discardLeft, y, width), play: cardRow(playCount, firstPlay, y, width),
  };
}

export function tableLayout(
  width: number, height: number, handRows: number, stockCount = 52,
  maxRowSize = CARDS_PER_ROW, discardCount = 1, playCount = 0, playCapacity = discardCount + playCount,
  queuedSlots?: QueuedPileSlots,
) {
  const inset = 20;
  const available = width - 2 * inset;
  const gap = 24;
  const baseGap = Math.min(19, width * .034);
  const basePileWidth = Math.min(145, width * .326, (available - baseGap - 12) / 2.75,
    height * .47 * ART_WIDTH / (1.5 * ART_HEIGHT));
  const stockLayers = stockLayerCount(stockCount);
  const opponentWidth = basePileWidth;
  const opponentVisible = artHeight(opponentWidth) / 2;
  const pileY = opponentVisible + gap;
  const baseStockLeft = Math.max(inset, (width - basePileWidth * (2 + 3 * PILE_STEP) - baseGap - 2 * (stockLayers - 1)) / 2);
  const reservedDiscard = queuedSlots?.discardCount ?? discardCount;
  const reservedPlay = queuedSlots?.playCount ?? playCount;
  const capacity = queuedSlots?.playCapacity ?? playCapacity;
  const piles = pileRow(width, inset, basePileWidth, baseStockLeft, baseGap, pileY, reservedDiscard,
    reservedPlay ? Math.max(reservedPlay, capacity - reservedDiscard) : 0, stockLayers);
  // Committing a prefix leaves its slots empty. Later groups keep their original
  // size and position until their own turn, including while the piles are shifted.
  const played = queuedSlots?.playedCount ?? 0;
  piles.play = piles.play.slice(played, played + playCount);
  if (queuedSlots) piles.discard = cardRow(discardCount, piles.discard[0]!.x, pileY, piles.stock.width);
  const pileWidth = piles.stock.width;
  const pileHeight = artHeight(pileWidth);
  const stockLayerStep = 2 * pileWidth / basePileWidth;
  const stockHeight = pileHeight + (stockLayers - 1) * stockLayerStep;
  const handY = pileY + stockHeight + gap;
  const rowGap = Math.min(7, (height - handY) / (Math.max(1, handRows) * 10));
  const handWidth = Math.min((width - 2 * inset - HAND_FADE_WIDTH) / maxRowSize / PILE_STEP,
    (height - handY - inset - HAND_FADE_WIDTH - Math.max(0, handRows - 1) * rowGap) / Math.max(1, handRows) * ART_WIDTH / CORNER_HEIGHT);
  return {
    piles, basePileWidth, baseStockLeft, baseGap, pileWidth, pileHeight, stockHeight, stockLayerStep, stockLayers,
    stockLeft: piles.stock.x, discardLeft: piles.discard[0]?.x ?? piles.stock.x + pileWidth + baseGap,
    opponentWidth, opponentVisible, handWidth, rowStep: cornerHeight(handWidth) + rowGap, rowGap,
    maxRowSize, noticeY: handY + 24, tableWidth: width, tableHeight: height, handY, pileY, inset,
  };
}

type Layout = ReturnType<typeof tableLayout>;

export function handPositions<T extends { rank: number }>(layout: Layout, rows: readonly (readonly T[])[]): CardPosition[] {
  if (!rows.length) return [];
  const slots = layout.maxRowSize;
  const room = layout.tableHeight - layout.handY - layout.inset - HAND_FADE_WIDTH - Math.max(0, rows.length - 1) * layout.rowGap;
  // All rows share one size and fixed column positions. Fit the corner strips
  // across the screen, using the opponent’s side margins; shrink uniformly
  // only when the available height cannot show every row's rank and suit.
  const available = layout.tableWidth - 2 * layout.inset - HAND_FADE_WIDTH;
  const width = Math.min(available / slots / PILE_STEP,
    room / rows.length * ART_WIDTH / CORNER_HEIGHT);
  const step = width * PILE_STEP;
  const left = rows.length === 1 ? layout.inset + (available - rows[0]!.length * step) / 2 : layout.inset;
  let y = layout.handY;
  return rows.flatMap(row => {
    const positions = row.map((_, i) => ({ x: left + i * step, y, width }));
    y += cornerHeight(width) + layout.rowGap;
    return positions;
  });
}

export function pilePositions(layout: Layout, discardCount: number, playCount = 0, reservedPlayCount = playCount) {
  const piles = pileRow(layout.tableWidth, layout.inset, layout.basePileWidth, layout.baseStockLeft,
    layout.baseGap, layout.pileY, discardCount, Math.max(playCount, reservedPlayCount), layout.stockLayers);
  return { ...piles, play: piles.play.slice(0, playCount) };
}

export function playLandingPositions(currentDiscard: readonly CardPosition[], playCount: number): CardPosition[] {
  // Direct plays land beside the discard's current location, even when the
  // eventual resting layout will have a different position or scale.
  const last = currentDiscard.at(-1)!;
  return cardRow(playCount, last.x + last.width * PILE_STEP, last.y, last.width);
}

export function replayPosition(layout: Layout): CardPosition {
  const last = layout.piles.discard.at(-1)!;
  const size = artHeight(last.width) / 3;
  return {
    x: (last.x + last.width + layout.tableWidth - size) / 2,
    y: last.y + (artHeight(last.width) - size) / 2, width: size, clipHeight: size,
  };
}

export function playPositions(layout: Layout, count: number, discardCount = 1): CardPosition[] {
  return pilePositions(layout, discardCount, count).play;
}

export function opponentPositions(layout: Layout, tableWidth: number, count: number): CardPosition[] {
  const width = layout.opponentWidth;
  const available = tableWidth - 2 * layout.inset;
  const gap = Math.min(width * .46, (available - width) / Math.max(1, count - 1));
  const left = (tableWidth - width - gap * Math.max(0, count - 1)) / 2;
  const y = layout.opponentVisible - artHeight(width);
  return Array.from({ length: count }, (_, index) => ({ x: left + index * gap, y, width }));
}

export function discardPositions(layout: Layout, _tableWidth: number, count: number): CardPosition[] {
  return pilePositions(layout, count).discard;
}

export function automaticActionPosition(layout: Layout): CardPosition {
  const last = layout.piles.discard.at(-1)!;
  return { x: Math.max(layout.inset, Math.min(layout.stockLeft, last.x - layout.pileWidth)),
    y: layout.pileY, width: layout.pileWidth };
}


export function committedFromPlay(cards: readonly { id: number }[], previous: {
  staged: readonly { id: number }[]; view: { queuedCards: readonly number[] };
} | undefined): boolean {
  return !!previous && cards.every(card => previous.staged.some(member => member.id === card.id) ||
    previous.view.queuedCards.includes(card.id));
}

export function collapsePlayPositions(anchor: CardPosition, count: number): CardPosition[] {
  return cardRow(count, anchor.x, anchor.y, anchor.width);
}


// Compare deterministic row packings. Width means the full card's width in
// logical screen pixels (dp); only its corner strip consumes horizontal space.
export function targetHandPlan<T extends { rank: number }>(layout: Layout, cards: readonly T[], target = 240, keepGroups = true) {
  const available = Math.max(1, layout.tableWidth - 2 * layout.inset - HAND_FADE_WIDTH);
  const room = Math.max(1, layout.tableHeight - layout.handY - layout.inset - HAND_FADE_WIDTH);
  let best: { rows: T[][]; width: number; score: number } | undefined;
  for (let columns = 1; columns <= Math.max(1,cards.length); columns++) {
    const rows = groupHandRows(cards, columns, keepGroups);
    if (!rows.length) return { rows, positions: [] as CardPosition[] };
    const longest = Math.max(...rows.map(row => row.length));
    const gap = Math.min(7,room/(rows.length*10));
    const fit = Math.min(available / (longest * PILE_STEP),
      Math.max(1,room-(rows.length-1)*gap)/rows.length*ART_WIDTH/CORNER_HEIGHT);
    const width = Math.min(target,fit);
    const score = Math.abs(width-target);
    if (!best || score < best.score-.001 || Math.abs(score-best.score)<.001 && rows.length < best.rows.length) best={rows,width,score};
  }
  const {rows,width} = best!;
  const longest = Math.max(...rows.map(row => row.length));
  const left = layout.inset + (available-longest*width*PILE_STEP)/2;
  const gap = Math.min(7,room/(rows.length*10));
  return { rows, positions: rows.flatMap((row,r) => row.map((_,c) => ({
    x:left+c*width*PILE_STEP, y:layout.handY+r*(cornerHeight(width)+gap), width,
  }))) };
}
