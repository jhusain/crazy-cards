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

// The selected top card stays anchored; earlier cards expose their corners to its left.
export function hoverPositions(top: CardPosition, count: number): CardPosition[] {
  return Array.from({ length: count }, (_, index) => ({
    x: top.x + (index - count + 1) * top.width * PILE_STEP, y: top.y, width: top.width,
  }));
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
  preferredPileWidth?: number,
) {
  const inset = 20;
  const available = width - 2 * inset;
  const gap = 24;
  const baseGap = Math.min(19, width * .034);
  const stockLayers = stockLayerCount(stockCount);
  const restingDiscard = queuedSlots?.discardCount ?? discardCount;
  const restingLimit = (available - baseGap - 2 * (stockLayers - 1)) /
    (2 + Math.max(0, restingDiscard - 1) * PILE_STEP + ART_HEIGHT / ART_WIDTH / 3);
  const verticalLimit = (height - inset - HAND_FADE_WIDTH - 2 * gap - 4 * (stockLayers - 1) - 8) /
    (1.5 * ART_HEIGHT / ART_WIDTH);
  const basePileWidth = preferredPileWidth === undefined
    ? Math.min(145, width * .326, (available - baseGap - 12) / 2.75,
      height * .47 * ART_WIDTH / (1.5 * ART_HEIGHT))
    : Math.max(.1, Math.min(preferredPileWidth, restingLimit, verticalLimit));
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
  const gap = Math.max(0, Math.min(width * .46, (available - width) / Math.max(1, count - 1)));
  const left = (tableWidth - width - gap * Math.max(0, count - 1)) / 2;
  const y = layout.opponentVisible - artHeight(width);
  return Array.from({ length: count }, (_, index) => ({ x: left + index * gap, y, width }));
}

export function discardPositions(layout: Layout, _tableWidth: number, count: number): CardPosition[] {
  return pilePositions(layout, count).discard;
}

export function automaticActionPosition(layout: Layout & { automaticPosition?: CardPosition }): CardPosition {
  if (layout.automaticPosition) return layout.automaticPosition;
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


// Store the minimum widest row for each suffix and exact row count.
// Among equally balanced partitions, fill earlier rows first.
function handPartitions<T extends { rank: number }>(cards: readonly T[], keepGroups: boolean) {
  const boundaries = [0];
  for (let index = 1; index <= cards.length; index++) {
    if (index === cards.length || !keepGroups || cards[index - 1]!.rank !== cards[index]!.rank) {
      boundaries.push(index);
    }
  }
  const count = boundaries.length - 1;
  const minimum = Array.from({ length: count + 1 }, () => Array<number>(count + 1).fill(Infinity));
  minimum[0]![count] = 0;
  for (let rows = 1; rows <= count; rows++) {
    for (let start = 0; start <= count - rows; start++) {
      for (let end = start + 1; end <= count - rows + 1; end++) {
        const length = boundaries[end]! - boundaries[start]!;
        const widest = Math.max(length, minimum[rows - 1]![end]!);
        minimum[rows]![start] = Math.min(minimum[rows]![start]!, widest);
      }
    }
  }

  function pack(rowCount: number, capacity: number): T[][] {
    const rows: T[][] = [];
    let start = 0;
    for (let remaining = rowCount - 1; remaining >= 0; remaining--) {
      // Take the longest prefix that leaves a feasible partition for the suffix.
      let end = count - remaining;
      while (boundaries[end]! - boundaries[start]! > capacity || minimum[remaining]![end]! > capacity) end--;
      rows.push(cards.slice(boundaries[start], boundaries[end]));
      start = end;
    }
    return rows;
  }

  return { widestByRowCount: minimum.slice(1).map(row => row[0]!), pack };
}

function betterScore(score: readonly number[], previous: readonly number[]): boolean {
  const first = score.findIndex((value, index) => Math.abs(value - previous[index]!) > 1e-6);
  return first >= 0 && score[first]! < previous[first]!;
}

function verticalPlacement(layout: Layout, handY: number, fixedPiles: boolean) {
  const gap = 24 + layout.stockHeight - layout.pileHeight;
  const maxPileY = Math.max(layout.pileY, handY - layout.stockHeight - 24);
  const fullOpponentPileY = layout.pileHeight + layout.inset + gap;
  const idealPileY = (layout.tableHeight - layout.pileHeight) / 2;
  // Preserve as much of the opponent hand as possible before centering the
  // pile. If the whole hand fits, retain the top margin as a minimum.
  const minPileY = Math.min(maxPileY, Math.max(layout.pileY, fullOpponentPileY));
  const pileY = fixedPiles ? layout.pileY : Math.min(maxPileY, Math.max(minPileY, idealPileY));
  const maxOpponentBottom = pileY - gap;
  const idealOpponentBottom = layout.tableHeight / 6 + layout.pileHeight / 2;
  const minOpponentBottom = Math.min(maxOpponentBottom, layout.pileHeight + layout.inset);
  const opponentVisible = fixedPiles ? layout.opponentVisible :
    Math.min(maxOpponentBottom, Math.max(minOpponentBottom, idealOpponentBottom));
  const margin = opponentVisible - layout.pileHeight;
  return { pileY, opponentVisible, score: [
    Math.max(0, -margin), Math.max(0, layout.inset - margin),
    Math.abs(pileY - idealPileY), Math.abs(opponentVisible - idealOpponentBottom),
  ] };
}

function chooseHandPlan<T extends { rank: number }>(
  layout: Layout, partitions: ReturnType<typeof handPartitions<T>>, target: number,
  arrangeVertically: boolean, fixedPiles = false,
) {
  const available = Math.max(.01, layout.tableWidth - 2 * layout.inset - HAND_FADE_WIDTH);
  const room = Math.max(.01, layout.tableHeight - layout.handY - layout.inset - HAND_FADE_WIDTH);
  let best: { rowCount: number; minimumWidest: number; width: number; step: number; handY: number;
    pileY: number; opponentVisible: number; score: number[] } | undefined;
  for (const [index, minimumWidest] of partitions.widestByRowCount.entries()) {
    const rowCount = index + 1;
    const gap = Math.min(7, room / (rowCount * 10));
    const width = Math.min(target, available / (minimumWidest * PILE_STEP),
      (room - (rowCount - 1) * gap) / rowCount * ART_WIDTH / CORNER_HEIGHT);
    const step = cornerHeight(width) + gap;
    const lastSpace = room - (rowCount - 1) * step;
    const shift = arrangeVertically ? Math.max(0, lastSpace - 2 * cornerHeight(width)) : 0;
    const handY = layout.handY + shift;
    const placement = verticalPlacement(layout, handY, fixedPiles || !arrangeVertically);
    const score = [target - width, rowCount, Math.abs(lastSpace - shift - 2 * cornerHeight(width)),
      ...placement.score];
    if (!best || betterScore(score, best.score)) best = { rowCount, minimumWidest, width, step, handY,
      pileY: placement.pileY, opponentVisible: placement.opponentVisible, score };
  }
  if (!best) {
    const handY = arrangeVertically ? layout.handY + room : layout.handY;
    const placement = verticalPlacement(layout, handY, fixedPiles || !arrangeVertically);
    return { rows: [] as T[][], positions: [] as CardPosition[], width: target, handY,
      pileY: placement.pileY, opponentVisible: placement.opponentVisible, score: [0, 0, 0, ...placement.score] };
  }
  const { rowCount, minimumWidest, width, step, handY, pileY, opponentVisible, score } = best;
  const rows = partitions.pack(rowCount, minimumWidest);
  const left = layout.inset + (available - minimumWidest * width * PILE_STEP) / 2;
  return { rows, width, handY, pileY, opponentVisible, score, positions: rows.flatMap((row, r) => row.map((_, c) => ({
    x: left + c * width * PILE_STEP, y: handY + r * step, width,
  }))) };
}

export function targetHandPlan<T extends { rank: number }>(layout: Layout, cards: readonly T[], target = 240, keepGroups = true) {
  return chooseHandPlan(layout, handPartitions(cards, keepGroups), target, false);
}

export interface TablePlanOptions<T> {
  cards: readonly T[];
  target: number;
  keepGroups: boolean;
  stockCount?: number;
  discardCount?: number;
  playCount?: number;
  playCapacity?: number;
  queuedSlots?: QueuedPileSlots;
  heldLayout?: Layout;
}

export function planTableLayout<T extends { rank: number }>(
  width: number, height: number, options: TablePlanOptions<T>,
) {
  const { cards, target, keepGroups, stockCount, discardCount = 1, playCount = 0,
    playCapacity, queuedSlots, heldLayout } = options;
  const partitions = handPartitions(cards, keepGroups);
  const minimum = target * .8;
  const candidates = [minimum];
  for (let value = Math.ceil(minimum); value < target; value++) candidates.push(value);
  candidates.push(target);
  // A committed multi-group play retains the original pile geometry until its
  // final group has finished. The hand can still independently shrink.
  const held = queuedSlots && heldLayout?.tableWidth === width && heldLayout.tableHeight === height
    ? heldLayout : undefined;
  let best: { layout: Layout & { automaticPosition: CardPosition }; hand: ReturnType<typeof chooseHandPlan<T>>; score: number[] } | undefined;
  for (const candidate of held ? [held.basePileWidth] : candidates) {
    const layout = tableLayout(width, height, 1, stockCount, CARDS_PER_ROW, discardCount,
      playCount, playCapacity, queuedSlots, candidate);
    layout.opponentWidth = layout.pileWidth;
    layout.opponentVisible = held ? held.opponentVisible : layout.pileHeight / 2;
    // Both gaps are measured from the discard. The deck's layered bottom
    // also retains its original 24-pixel clearance from the player's hand.
    const gap = 24 + layout.stockHeight - layout.pileHeight;
    layout.pileY = held ? held.pileY : layout.opponentVisible + gap;
    layout.handY = layout.pileY + layout.stockHeight + 24;
    const hand = chooseHandPlan(layout, partitions, target, true, !!held);
    layout.pileY = hand.pileY;
    layout.handY = hand.handY;
    layout.opponentVisible = hand.opponentVisible;
    layout.handWidth = hand.width;
    layout.noticeY = layout.handY + 24;
    for (const card of [layout.piles.stock, ...layout.piles.discard, ...layout.piles.play]) card.y = layout.pileY;
    const resting = pileRow(width, layout.inset, layout.basePileWidth, layout.baseStockLeft,
      layout.baseGap, layout.pileY, discardCount, 0, layout.stockLayers);
    const automaticPosition = { x: playCount ? resting.stock.x : layout.piles.stock.x,
      y: layout.pileY, width: layout.pileWidth };
    const score = [Math.max(0, minimum - layout.pileWidth), ...hand.score, -layout.pileWidth];
    if (!best || betterScore(score, best.score)) best = { layout: { ...layout, automaticPosition }, hand, score };
  }
  return best!;
}
