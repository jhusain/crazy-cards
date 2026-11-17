import assert from "node:assert/strict";
import test from "node:test";
import { keepCornersVisible } from "../src/hand-motion.ts";
import {
  ART_WIDTH, CORNER_HEIGHT, CORNER_WIDTH, HAND_CORNER_MARGIN, artHeight, discardPositions, groupHandRows, handPositions, playPositions,
  opponentPositions, tableLayout, type CardPosition,
} from "../src/table-layout.ts";

test("every opponent card fits in one row with its bottom half visible", () => {
  for (const width of [276, 349, 624]) {
    const layout = tableLayout(width, 630, 8);
    const cards = opponentPositions(layout, width, 47);
    assert.equal(cards.length, 47);
    assert(cards.every(card => card.width === layout.pileWidth));
    assert(cards.every(card => card.y === cards[0]!.y));
    assert(cards.every(card => Math.abs(card.y + artHeight(card.width) / 2) < .001));
    assert(cards[0]!.x >= layout.inset - .01);
    assert(cards.at(-1)!.x + layout.opponentWidth <= width - layout.inset + .01);
  }
});

test("both four-card plays keep readable corners and fit the whole discard during transitions", () => {
  for (const width of [276, 349, 624]) {
    const layout = tableLayout(width, 640, 9);
    const combined = discardPositions(layout, width, 8);
    const corner = combined[0]!.width * CORNER_WIDTH / ART_WIDTH;
    assert(combined.every((card, i) => i === 0 || card.x - combined[i - 1]!.x >= corner));
    assert(combined.at(-1)!.x + combined.at(-1)!.width <= width - layout.inset + .01);
    assert(combined.every(card => card.clipWidth === undefined));
    assert.equal(discardPositions(layout, width, 4)[0]?.x, combined[0]?.x);
  }
});

test("corner protection separates crossing cards in the sorted hand", () => {
  for (const width of [276, 349, 624]) {
    const rows = groupHandRows(Array.from({ length: 18 }, (_, rank) => ({ rank })));
    const layout = tableLayout(width, 640, rows.length);
    const hand = handPositions(layout, rows);
    assert.equal(hand[7]!.y, hand[0]!.y);
    assert(hand[8]!.y > hand[7]!.y);
    const collided: CardPosition[] = hand.map((slot, index) => index === 4 || index === 9
      ? { ...slot, x: hand[3]!.x, y: hand[3]!.y } : slot);
    const protectedCards = keepCornersVisible(collided, width, 640);
    assert(protectedCards);
    assert.notDeepEqual(protectedCards, collided);
    for (const [i, a] of protectedCards.entries()) {
      for (const b of protectedCards.slice(i + 1)) {
        const overlapX = a.x < b.x + b.width * CORNER_WIDTH / ART_WIDTH &&
          b.x < a.x + a.width * CORNER_WIDTH / ART_WIDTH;
        const overlapY = a.y < b.y + b.width * CORNER_HEIGHT / ART_WIDTH &&
          b.y < a.y + a.width * CORNER_HEIGHT / ART_WIDTH;
        assert(!(overlapX && overlapY));
      }
    }
  }
});

test("the deck and discard stay in place as a draw wraps the player's hand", () => {
  const before = tableLayout(349, 580, 1);
  const after = tableLayout(349, 580, 2);
  assert.equal(after.stockLeft, before.stockLeft);
  assert.equal(after.discardLeft, before.discardLeft);
  assert.equal(after.pileY, before.pileY);
  assert(after.handWidth < before.handWidth);
});

test("equal ranks move as a run and short rows are centered", () => {
  const ranks = [8, 8, 2, 2, 11, 1, 10, 10, 10, 5, 5, 4];
  const rows = groupHandRows(ranks.map(rank => ({ rank })));
  assert.deepEqual(rows.map(row => row.map(card => card.rank)), [ranks.slice(0, 6), ranks.slice(6)]);
  const layout = tableLayout(390, 780, rows.length);
  const [first] = handPositions(layout, [[{ rank: 2 }]]);
  assert.equal(first!.x + first!.width / 2, 195);
  assert.equal(first!.clipWidth, undefined);
});

test("all hand and queue corners fit while the card faces extend to the screen edge", () => {
  for (const width of [290, 360, 390, 768]) {
    const layout = tableLayout(width, 780, 1);
    const row = groupHandRows(Array.from({ length: 8 }, (_, rank) => ({ rank })));
    const hand = handPositions(layout, row);
    const queue = playPositions(layout, 12);
    const fits = (cards: CardPosition[]) => cards.every((card, index) => {
      const edge = cards[index + 1]?.x ?? width;
      return edge - card.x >= card.width * CORNER_WIDTH / ART_WIDTH &&
        card.clipWidth === undefined && card.clipHeight === undefined;
    });
    assert(fits(hand));
    assert(fits(queue));
    assert(Math.abs(hand[1]!.x - hand[0]!.x - layout.handWidth * CORNER_WIDTH / ART_WIDTH - HAND_CORNER_MARGIN) < .001);
    assert.equal(playPositions(layout, 1)[0]?.width, layout.handWidth * .8);
    assert.equal(playPositions(layout, 3)[0]?.width, layout.handWidth * .8);
    assert(queue[0]!.width <= layout.handWidth * .8);
    assert(layout.handY - layout.stageY > .8 * layout.handWidth * CORNER_HEIGHT / ART_WIDTH);
  }
});

test("piles and queued corners fit in the short table below the score bar", () => {
  for (const [width, viewportHeight] of [[290, 390], [390, 580], [850, 290]] as const) {
    const layout = tableLayout(width, viewportHeight, 3);
    const staged = playPositions(layout, 12);
    assert(layout.stockLeft >= 0);
    assert(layout.pileY > layout.opponentVisible);
    assert(layout.pileY + layout.pileHeight + 6 < layout.stageY);
    assert(layout.stageY + staged[0]!.width * CORNER_HEIGHT / ART_WIDTH < viewportHeight);
  }
});

test("a full deck in the hand fits within the clipped viewport in portrait and landscape", () => {
  const rows = groupHandRows(Array.from({ length: 52 }, (_, i) => ({ rank: Math.floor(i / 4) + 1 })));
  for (const [width, height] of [[290, 480], [390, 680], [850, 250]] as const) {
    const layout = tableLayout(width, height, rows.length);
    const positions = handPositions(layout, rows);
    assert(positions.every(card => card.y + artHeight(card.width) < height));
    assert(positions.every(card => card.x + card.width * CORNER_WIDTH / ART_WIDTH < width));
    assert.equal(positions.length, 52);
  }
});
