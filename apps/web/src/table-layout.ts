export const CARDS_PER_ROW = 8;
export const ART_WIDTH = 142;
export const ART_HEIGHT = 190;
export const CORNER_WIDTH = 35;
export const CORNER_HEIGHT = 65;
export const HAND_CORNER_MARGIN = 6;
const PLAY_CORNER_MARGIN = 3;
const PLAY_SCALE = .8;
const cornerWidth = (width: number) => width * CORNER_WIDTH / ART_WIDTH;
const cornerHeight = (width: number) => width * CORNER_HEIGHT / ART_WIDTH;
export const artHeight = (width: number) => width * ART_HEIGHT / ART_WIDTH;

export interface CardPosition {
  x: number;
  y: number;
  width: number;
  clipWidth?: number;
  clipHeight?: number;
}

export function groupHandRows<T extends { rank: number }>(cards: readonly T[]): T[][] {
  const rows: T[][] = [];
  let row: T[] = [];
  for (let start = 0; start < cards.length;) {
    let end = start + 1;
    while (end < cards.length && cards[start]!.rank === cards[end]!.rank) end++;
    const run = cards.slice(start, end);
    if (row.length + run.length > CARDS_PER_ROW) {
      rows.push(row);
      row = [];
    }
    row.push(...run);
    start = end;
  }
  if (row.length) rows.push(row);
  return rows;
}

export function tableLayout(width: number, height: number, handRows: number) {
  const inset = width < 460 ? 10 : 18;
  const available = width - 2 * inset;
  const gap = Math.min(16, height * .035);
  const pileGap = Math.min(19, width * .034);
  const pileWidth = Math.min(145, width * .326, (available - pileGap - 12) / 2.75,
    height * .47 * ART_WIDTH / (1.5 * ART_HEIGHT));
  const pileHeight = artHeight(pileWidth);
  const opponentWidth = pileWidth;
  const opponentVisible = pileHeight / 2;
  const pileY = opponentVisible + gap;
  const discardStep = pileWidth / 4;
  const stockLeft = (width - pileWidth * 2 - pileGap - discardStep * 3) / 2;
  const discardLeft = stockLeft + pileWidth + pileGap;
  const baseStageY = pileY + pileHeight + gap;
  const rowsBelowFirst = Math.max(0, handRows - 1);
  const rowGap = Math.min(7, (height - baseStageY) / (Math.max(1, handRows) * 10));
  const handHeight = height - baseStageY - 2 * gap - rowsBelowFirst * rowGap;
  const heightPerCardWidth = (ART_HEIGHT + (PLAY_SCALE + rowsBelowFirst) * CORNER_HEIGHT) / ART_WIDTH;
  const handWidth = Math.min(181, (available / CARDS_PER_ROW - HAND_CORNER_MARGIN) * ART_WIDTH / CORNER_WIDTH,
    handHeight / heightPerCardWidth);
  const rowStep = cornerHeight(handWidth) + rowGap;
  const baseHandY = baseStageY + cornerHeight(handWidth * PLAY_SCALE) + gap;
  const extra = Math.max(0, height - (baseHandY + artHeight(handWidth) + rowStep * rowsBelowFirst + gap));
  const lowerOffset = Math.min(145, extra * .83);
  const stageY = baseStageY + lowerOffset;
  const handY = baseHandY + lowerOffset;
  return {
    pileWidth, pileHeight, stockLeft, discardLeft, opponentWidth, opponentVisible,
    handWidth, rowStep, stageY, tableWidth: width, handY, pileY, inset,
  };
}

type Layout = ReturnType<typeof tableLayout>;

function rowPositions(layout: Layout, count: number, width: number, y: number, margin: number): CardPosition[] {
  const step = cornerWidth(width) + margin;
  const rowWidth = width + Math.max(0, count - 1) * step;
  const left = Math.max(layout.inset, (layout.tableWidth - rowWidth) / 2);
  return Array.from({ length: count }, (_, index) => ({ x: left + index * step, y, width }));
}

export function handPositions<T extends { rank: number }>(layout: Layout, rows: readonly (readonly T[])[]): CardPosition[] {
  return rows.flatMap((row, index) =>
    rowPositions(layout, row.length, layout.handWidth, layout.handY + index * layout.rowStep, HAND_CORNER_MARGIN));
}

export function playPositions(layout: Layout, count: number): CardPosition[] {
  const available = layout.tableWidth - 2 * layout.inset;
  const width = Math.min(layout.handWidth * PLAY_SCALE,
    (available / Math.max(1, count) - PLAY_CORNER_MARGIN) * ART_WIDTH / CORNER_WIDTH);
  return rowPositions(layout, count, width, layout.stageY, PLAY_CORNER_MARGIN);
}

export function opponentPositions(layout: Layout, tableWidth: number, count: number): CardPosition[] {
  const width = layout.opponentWidth;
  const available = tableWidth - 2 * layout.inset;
  const gap = Math.min(width * .46, (available - width) / Math.max(1, count - 1));
  const left = (tableWidth - width - gap * Math.max(0, count - 1)) / 2;
  const y = layout.opponentVisible - artHeight(width);
  return Array.from({ length: count }, (_, index) => ({ x: left + index * gap, y, width }));
}

export function discardPositions(layout: Layout, tableWidth: number, count: number): CardPosition[] {
  if (count === 0) return [];
  const { discardLeft, pileY, pileWidth, inset } = layout;
  const overlap = .25;
  const width = Math.min(pileWidth, (tableWidth - inset - discardLeft) / (1 + (count - 1) * overlap));
  const step = width * overlap;
  const y = pileY + (artHeight(pileWidth) - artHeight(width)) / 2;
  return Array.from({ length: count }, (_, index) => ({ x: discardLeft + index * step, y, width }));
}
