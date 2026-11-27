import assert from "node:assert/strict";
import test from "node:test";
import {
  hoverPositions, planTableLayout, targetHandPlan, committedFromPlay, collapsePlayPositions, ART_WIDTH, CARD_DEPTH, CORNER_HEIGHT, CORNER_WIDTH, PILE_STEP, artHeight,
  groupHandRows, handPositions, opponentPositions, pilePositions, playLandingPositions, replayPosition, automaticActionPosition, tableLayout, type CardPosition,
} from "../src/table-layout.ts";

const cornerWidth = (card: CardPosition) => card.width * CORNER_WIDTH / ART_WIDTH;
const cornerHeight = (card: CardPosition) => card.width * CORNER_HEIGHT / ART_WIDTH;
const close = (a: number, b: number) => assert(Math.abs(a - b) < .001, `${a} differs from ${b}`);

test("every opponent card fits in one row with its bottom half visible", () => {
  for (const width of [276, 349, 624]) {
    const layout = tableLayout(width, 630, 8);
    const cards = opponentPositions(layout, width, 47);
    assert.equal(cards.length, 47);
    assert(cards.every(card => card.width === layout.opponentWidth));
    assert(cards.every(card => card.y === cards[0]!.y));
    assert(cards.every(card => Math.abs(card.y + artHeight(card.width) / 2) < .001));
    assert(cards[0]!.x >= layout.inset - .01);
    assert(cards.at(-1)!.x + layout.opponentWidth <= width - layout.inset + .01);
  }
});

test("the pile row translates, closes the play gap, then scales while preserving every minimum-width strip", () => {
  const seen = new Set<string>();
  for (const [width, height] of [[290,580], [390,680], [850,290], [850,900]] as const) {
    for (const stockCount of [0,1,14,35,52]) for (let discard = 1; discard <= 4; discard++) {
      for (let count = 0; count <= 12; count++) {
        const layout = tableLayout(width, height, 2, stockCount, 8, discard, count);
        const { stock, discard: old, play } = layout.piles;
        const cards = [...old, ...play];
        const minimum = stock.width * PILE_STEP;
        const deckRight = stock.x + stock.width + (layout.stockLayers - 1) * layout.stockLayerStep;
        assert(cards.every(card => card.width === stock.width && card.y === stock.y));
        assert(cards.every(card => card.x >= 0 && card.x + minimum <= width + .001));
        assert(deckRight >= minimum - .001);
        assert(stock.y + artHeight(stock.width) < height);
        const last = cards.at(-1)!;
        if (play.length) {
          const offset = play[0]!.x - old.at(-1)!.x;
          const natural = stock.width + old[0]!.x - deckRight;
          assert(offset >= 2 * minimum - .001 && offset <= natural + .001);
          if (offset < natural - .001) close(deckRight, minimum);
          if (stock.width < layout.basePileWidth - .001) {
            seen.add("scale"); close(offset, 2 * minimum); close(deckRight, minimum);
          } else if (offset < natural - .001) seen.add("close gap");
          else if (last.x + last.width + old[0]!.x - deckRight > width + .001) seen.add("clip");
          else if (stock.x < layout.baseStockLeft - .001) seen.add("translate");
          if(deckRight > minimum + .001) assert(last.x + last.width + old[0]!.x - deckRight <= width + .001);
        }
        for (const group of [old, play]) for (let i = 1; i < group.length; i++) {
          assert(group[i]!.x - group[i-1]!.x >= cornerWidth(group[i-1]!));
        }
        close(stock.y, tableLayout(width, height, 2).pileY);
      }
    }
  }
  assert.deepEqual([...seen].sort(), ["clip", "close gap", "scale", "translate"]);
});

test("the row shifts left for whole queued cards and a matching right margin before clipping their bodies", () => {
  const idle = tableLayout(390,680,1,35,8,1);
  const first = tableLayout(390,680,1,35,8,1,1);
  assert(first.stockLeft < idle.stockLeft);
  close(first.pileWidth, idle.pileWidth);
  const deckRight = first.stockLeft + first.pileWidth + (first.stockLayers-1)*first.stockLayerStep;
  const gap = first.discardLeft - deckRight;
  close(first.piles.play[0]!.x, first.discardLeft + first.pileWidth + gap);
  close(first.piles.play[0]!.x + first.pileWidth + gap, 390);
  const wide = tableLayout(850,900,1,35,8,1,1);
  close(wide.stockLeft, wide.baseStockLeft);
  for (let count=1;count<=12;count++) {
    const layout = tableLayout(390,680,1,35,8,1,count);
    const stock=layout.piles.stock;
    const bottomRight=stock.x+stock.width+(layout.stockLayers-1)*layout.stockLayerStep;
    const last=layout.piles.play.at(-1)!;
    if(last.x+last.width+layout.baseGap*stock.width/layout.basePileWidth>390+.001) close(bottomRight,stock.width*PILE_STEP);
  }
});

test("direct plays land one minimum width after the current discard, before it returns home", () => {
  for (const [width,height] of [[290,580],[390,680],[850,290]] as const) {
    for (let discard=1;discard<=4;discard++) for (let count=1;count<=4;count++) {
      const shifted=tableLayout(width,height,1,35,8,discard,4).piles.discard;
      const landing=playLandingPositions(shifted,count);
      const last=shifted.at(-1)!;
      close(landing[0]!.x,last.x+last.width*PILE_STEP);
      assert(landing.every(card=>card.width===last.width&&card.y===last.y));
      landing.forEach((card,index)=>close(card.x,last.x+(index+1)*last.width*PILE_STEP));
    }
  }
});

test("the square replay button fits in the gap beside the whole discard and shares its vertical center", () => {
  for (const [width,height] of [[290,390], [390,680], [850,290], [624,900]] as const) {
    for (const stock of [0,1,14,35,52]) for (const count of [1,2,3,4]) {
      const layout = tableLayout(width,height,2,stock,8,count);
      const last = layout.piles.discard.at(-1)!;
      const replay = replayPosition(layout);
      close(replay.width, artHeight(last.width)/3);
      close(replay.clipHeight!, replay.width);
      close(replay.x + replay.width/2, (last.x + last.width + width)/2);
      close(replay.y + replay.width/2, last.y + artHeight(last.width)/2);
      assert(replay.x >= last.x + last.width - .001);
      assert(replay.x + replay.width <= width + .001);
    }
  }
});

test("unplayed groups retain their original slots across successive skip turns", () => {
  for (const [width, height] of [[290,580], [390,680], [850,290]] as const) {
    for (const discard of [1,4]) for (const groups of [[2,1,1], [4,4,4]]) {
      const count = groups.reduce((sum, group) => sum + group, 0);
      const capacity = discard + count;
      const original = tableLayout(width, height, 2, 35, 8, discard, count, capacity);
      let played = 0;
      for (const group of groups.slice(0,-1)) {
        played += group;
        const remaining = count - played;
        const next = tableLayout(width, height, 1, 35, 8, group, remaining, capacity, {
          discardCount: discard, playCount: count, playCapacity: capacity, playedCount: played,
        });
        assert.deepEqual(next.piles.play, original.piles.play.slice(played));
        assert.deepEqual(next.piles.stock, original.piles.stock);
        assert.deepEqual(next.piles.discard[0], original.piles.discard[0]);
        assert(next.piles.discard.every(card => card.width === original.pileWidth));
      }
      const finished = tableLayout(width, height, 1, 35, 8, groups.at(-1), 0);
      assert(finished.stockLeft >= original.stockLeft - .001);
      assert(finished.pileWidth >= original.pileWidth - .001);
    }
  }
});

test("removing a middle queued card moves the cards to its right leftward", () => {
  for (const width of [290,390,850]) {
    const layout = tableLayout(width, 680, 1);
    for (let discard = 1; discard <= 4; discard++) for (let count = 3; count <= 12; count++) {
      const before = pilePositions(layout, discard, count).play;
      const after = pilePositions(layout, discard, count - 1, count).play;
      for (let index = 2; index < count; index++) assert(after[index-1]!.x < before[index]!.x);
    }
  }
});

test("each table zone has room for all 52 cards at distinct depths", () => {
  const { discard, stock, opponent, play, hand, staging } = CARD_DEPTH;
  const depths = [discard, stock, opponent, play, hand, staging];
  assert.deepEqual(depths.slice(1).map((depth, index) => depth - depths[index]!), [52,52,52,52,52]);
});

test("equal ranks stay together while the configured row size controls wrapping", () => {
  const cards = [8,8,2,2,11,1,10,10,10,5,5,4].map(rank => ({rank}));
  for (let maxRowSize = 4; maxRowSize <= 12; maxRowSize++) {
    const rows = groupHandRows(cards, maxRowSize);
    assert(rows.every(row => row.length <= maxRowSize));
    assert.deepEqual(rows.flat(), cards);
    for (let i = 1; i < rows.length; i++) assert(rows[i-1]!.at(-1)!.rank !== rows[i]![0]!.rank);
  }
  assert.deepEqual(groupHandRows(cards).map(row => row.length), [6,6]);
});

test("table rows have 24 dp vertical gaps and 20 dp side margins", () => {
  for (const [width,height] of [[290,390],[390,680],[850,290],[624,900]] as const) {
    for (const count of [0,1,5,12]) for (const rowCount of [1,3,13]) {
      const layout = tableLayout(width,height,rowCount,35,4,4,count);
      const opponent = opponentPositions(layout,width,10)[0]!;
      const card = layout.piles.discard[0]!;
      close(card.y - (opponent.y + artHeight(opponent.width)), 24);
      close(layout.handY - (layout.pileY + layout.stockHeight), 24);
      close(layout.inset,20);
      close(layout.handY, tableLayout(width,height,1,35,12,4,count).handY);
    }
  }
});

test("all hand corners remain visible for a full deck at every row limit", () => {
  const cards = Array.from({length:52},(_,i)=>({rank:Math.floor(i/4)+1}));
  for (const keepGroups of [true,false]) for (let maxRowSize = 4; maxRowSize <= 12; maxRowSize++) {
    const rows = groupHandRows(cards,maxRowSize,keepGroups);
    for (const [width,height] of [[290,480],[390,680],[850,250]] as const) {
      const layout = tableLayout(width,height,rows.length,35,maxRowSize);
      const hand = handPositions(layout,rows);
      assert.equal(hand.length,52);
      for (const [index,card] of hand.entries()) {
        assert(card.y + cornerHeight(card) <= height - 8 + .001);
        assert(card.x >= 0 && card.x + cornerWidth(card) <= width + .001);
        for (const above of hand.slice(index+1)) {
          const overlapX = above.x < card.x + cornerWidth(card) && card.x < above.x + above.width;
          const overlapY = above.y < card.y + cornerHeight(card) - .001 && card.y < above.y + artHeight(above.width);
          assert(!(overlapX && overlapY));
        }
      }
    }
  }
});

test("hand rows use fixed columns, uniform card sizes and opponent side margins", () => {
  for (const count of [1,2,4,8,12,18]) for (const rowSize of [4,8,12]) {
    const rows=groupHandRows(Array.from({length:count},(_,rank)=>({rank})),rowSize);
    const layout=tableLayout(390,2000,rows.length,35,rowSize);
    const hand=handPositions(layout,rows);
    assert(hand.every(card=>card.width===hand[0]!.width));
    const step=hand[0]!.width*PILE_STEP;
    const slots=rowSize;
    close(step*slots,390-2*layout.inset-10);
    let offset=0;
    for(const row of rows) {
      const cards=hand.slice(offset,offset+row.length);offset+=row.length;
      const left=rows.length===1?(390-10-row.length*step)/2:layout.inset;
      close(cards[0]!.x,left);
      assert(cards.every(card=>card.y===cards[0]!.y));
      cards.forEach((card,index)=>close(card.x,left+index*step));
      for(let i=1;i<cards.length;i++) assert(cards[i]!.x-cards[i-1]!.x>=cornerWidth(cards[i-1]!));
    }
  }
  const rows=[[{rank:1},{rank:1}],Array.from({length:8},(_,rank)=>({rank:rank+2}))];
  const hand=handPositions(tableLayout(390,2000,2),rows);
  close(hand[0]!.x,hand[2]!.x);
  close(hand[1]!.x,hand[3]!.x);
});

test("group wrapping can be disabled to fill rows by card count", () => {
  const cards=[1,1,1,2,2,2,3,3,3].map(rank=>({rank}));
  assert.deepEqual(groupHandRows(cards,4).map(row=>row.length),[3,3,3]);
  const split=groupHandRows(cards,4,false);
  assert.deepEqual(split.map(row=>row.length),[4,4,1]);
  assert.deepEqual(split.flat(),cards);
  assert.equal(split[0]!.at(-1)!.rank,split[1]![0]!.rank);
});


test("automatic action cards sit over the deck, entirely visible and left of the last discard", () => {
  for (const [width,height] of [[290,480],[390,680],[850,300]] as const) for (let count=1;count<=4;count++) {
    const layout=tableLayout(width,height,2,35,8,count);
    const panel=automaticActionPosition(layout);
    const last=layout.piles.discard.at(-1)!;
    close(panel.y,layout.pileY);
    close(panel.width,layout.pileWidth);
    assert(panel.x>=layout.inset);
    assert(panel.x+panel.width<=last.x+.001);
    assert(panel.x+panel.width<=width-layout.inset+.001);
  }
});


test("every committed group collapses at the current shifted discard before returning home",()=>{
  const initial=tableLayout(390,680,1,35,8,1,2);
  const current=initial.piles.discard[0]!;
  const home=tableLayout(390,680,1,35,8,1).piles.discard[0]!;
  assert(current.x<home.x);
  const first={id:1}, final={id:2};
  assert(committedFromPlay([first],{staged:[first,final],view:{queuedCards:[]}}));
  // A later queued turn can be recognized even if its local staging list was cleared.
  assert(committedFromPlay([final],{staged:[],view:{queuedCards:[final.id]}}));
  assert(!committedFromPlay([final],{staged:[],view:{queuedCards:[]}}));
  for(const count of [1,2,4]){
    const collapsed=collapsePlayPositions(current,count);
    close(collapsed[0]!.x,current.x);
    close(collapsed[0]!.y,current.y);
    assert(collapsed.every(p=>p.width===current.width));
    collapsed.forEach((p,i)=>close(p.x,current.x+i*current.width*PILE_STEP));
  }
});


test("a short single row keeps the configured full-row card size and centers its corner strips",()=>{
  const layout=tableLayout(390,800,1,35,8);
  const full=handPositions(layout,[Array.from({length:8},(_,rank)=>({rank}))]);
  for(let count=1;count<8;count++){
    const row=handPositions(layout,[Array.from({length:count},(_,rank)=>({rank}))]);
    assert(row.every(card=>card.width===full[0]!.width&&card.y===full[0]!.y));
    const step=row[0]!.width*PILE_STEP;
    close(row[0]!.x+count*step/2,190);
    assert(row[0]!.x>=20);
    assert(row.at(-1)!.x+step<=370+.001);
  }
});


test("hand corner strips remain fully opaque before the ten-pixel fade and clear right margin",()=>{
  for(const width of [280,390,768]) for(const size of [4,8,12]) for(const count of [1,8,20,52]) {
    const rows=groupHandRows(Array.from({length:count},(_,rank)=>({rank})),size);
    const layout=tableLayout(width,1200,rows.length,35,size);
    for(const card of handPositions(layout,rows)) {
      assert(card.x>=20-.001);
      assert(card.x+cornerWidth(card)<=width-30+.001);
      assert(card.y+card.width*65/142<=layout.tableHeight-30+.001);
    }
  }
});


test("target hand layout uses uniform card sizes, visible corner heights, centered block and left-justified rows",()=>{
 for(const [w,h] of [[320,568],[390,740],[768,900],[1200,700]]) for(const count of [1,3,8,18,36,52]) for(const target of [40,60,120,240,1000]) for(const together of [true,false]) {
  const cards=Array.from({length:count},(_,i)=>({rank:Math.floor(i/4)+1}));
  const layout=tableLayout(w!,h!,1);
  const plan=targetHandPlan(layout,cards,target,together), positions=plan.positions;
  assert.equal(positions.length,count);
  assert(positions.every(p=>p.width===positions[0]!.width));
  assert(positions.every(p=>p.x>=20-.001&&p.x+p.width*PILE_STEP<=w!-30+.001&&p.y+cornerHeight(p)<=h!-30+.001));
  let index=0;const left=positions[0]!.x;
  for(const row of plan.rows){close(positions[index]!.x,left);index+=row.length;}
  const maxCount=Math.max(...plan.rows.map(row=>row.length));
  close(left+(maxCount*positions[0]!.width*PILE_STEP)/2,(w!-10)/2);
  if(together) for(const rank of new Set(cards.map(c=>c.rank)))assert.equal(plan.rows.filter(row=>row.some(c=>c.rank===rank)).length,1);
 }
});


test("overlapping rows achieve the target width while every face and suit stays exposed",()=>{
 const cards=Array.from({length:8},(_,i)=>({rank:Math.floor(i/2)+1}));
 const layout=tableLayout(390,740,1);
 const {rows,positions}=targetHandPlan(layout,cards,240,true);
 assert(rows.length>1);
 assert.equal(positions[0]!.width,240);
 let offset=0;
 for(let i=0;i<rows.length-1;i++){
  const top=positions[offset]!;
  offset+=rows[i]!.length;
  const next=positions[offset]!;
  assert(next.y>=top.y+cornerHeight(top));
  assert(next.y<top.y+artHeight(top.width));
  close(next.x,top.x);
 }
 const last=positions.at(-1)!;
 assert(last.y+cornerHeight(last)<=740-30+.001);
});

test("narrow screens explore non-greedy partitions while tablets use a single row", () => {
  const cards = [8, 12, 12, 10, 10, 5, 5].map(rank => ({ rank }));
  const { layout, hand } = planTableLayout(800, 1050, { cards, target: 240, keepGroups: true });
  assert.deepEqual(hand.rows.map(row => row.length), [7]);
  close(hand.width, 240);
  const narrow = planTableLayout(360, 1000, { cards, target: 240, keepGroups: true });
  assert.deepEqual(narrow.hand.rows.map(row => row.length), [3, 4]);
  close(narrow.hand.width, 240);
  assert(layout.pileWidth >= 192 && layout.pileWidth <= 240);
  close(layout.opponentWidth, layout.pileWidth);
  close(layout.tableHeight - layout.inset - 10 - hand.positions.at(-1)!.y,
    2 * cornerHeight(hand.positions.at(-1)!));
  assert(layout.opponentVisible - layout.pileHeight >= layout.inset - .001);
  close(layout.pileY + layout.pileHeight / 2, 1050 / 2);
  close(layout.opponentVisible - layout.pileHeight / 2, 1050 / 6);
});

test("integrated layouts preserve visible corners, shared pile sizes, and minimum clearance", () => {
  for (const [w, h] of [[360, 650], [800, 1050], [1024, 700], [850, 270]] as const) {
    for (const count of [1, 7, 18, 52]) for (const keepGroups of [true, false]) {
      const cards = Array.from({ length: count }, (_, i) => ({ rank: Math.floor(i / 4) }));
      for (const target of [40, 240, 1000]) for (const playCount of [0, 4, 12]) {
        const { layout, hand } = planTableLayout(w, h, { cards, target, keepGroups, playCount });
        assert.deepEqual(hand.rows.flat(), cards);
        assert(hand.width <= target);
        assert(layout.pileWidth <= target);
        close(layout.opponentWidth, layout.pileWidth);
        assert(layout.opponentVisible >= layout.pileHeight / 2 - .001);
        assert(layout.pileY - layout.opponentVisible >= 24 + layout.stockHeight - layout.pileHeight - .001);
        assert(layout.handY - layout.pileY - layout.stockHeight >= 24 - .001);
        const panel = automaticActionPosition(layout);
        close(panel.width, layout.pileWidth);
        close(panel.y, layout.pileY);
        if (!playCount) close(panel.x, layout.piles.stock.x);
        for (const position of hand.positions) {
          assert(position.x >= layout.inset - .001);
          assert(position.x + cornerWidth(position) <= w - layout.inset - 10 + .001);
          assert(position.y + cornerHeight(position) <= h - layout.inset - 10 + .001);
        }
        if (keepGroups) for (let i = 1; i < hand.rows.length; i++) {
          assert.notEqual(hand.rows[i - 1]!.at(-1)!.rank, hand.rows[i]![0]!.rank);
        }
      }
    }
  }
});

test("committed multi-group plays retain their layout while the remaining hand is optimized", () => {
  const cards = Array.from({ length: 18 }, (_, i) => ({ rank: Math.floor(i / 2) }));
  const original = planTableLayout(800, 1050, {
    cards, target: 240, keepGroups: true, stockCount: 35, discardCount: 1, playCount: 4, playCapacity: 5,
  }).layout;
  const next = planTableLayout(800, 1050, {
    cards: cards.slice(4), target: 240, keepGroups: true, stockCount: 35, discardCount: 2, playCount: 2,
    heldLayout: original, queuedSlots: { discardCount: 1, playCount: 4, playCapacity: 5, playedCount: 2 },
  }).layout;
  assert.deepEqual(next.piles.stock, original.piles.stock);
  assert.deepEqual(next.piles.play, original.piles.play.slice(2));
  assert.deepEqual(next.piles.discard[0], original.piles.discard[0]);
});

test("three cards stay in one row and the three zones spread into available vertical space", () => {
  const cards = [1, 2, 3].map(rank => ({ rank }));
  for (const [width, height] of [[800, 1050], [800, 1600], [1500, 2000]] as const) {
    const { layout, hand } = planTableLayout(width, height, { cards, target: 240, keepGroups: true });
    assert.deepEqual(hand.rows.map(row => row.length), [3]);
    close(hand.width, 240);
    close(height - layout.inset - 10 - hand.positions[0]!.y, 2 * cornerHeight(hand.positions[0]!));
    close(layout.pileY + layout.pileHeight / 2, height / 2);
    close(layout.opponentVisible - layout.pileHeight / 2, height / 6);
    assert(layout.handY - layout.pileY - layout.stockHeight > 24);
    assert(layout.pileY - layout.opponentVisible > 24);
  }
});


test("the hand uses the fewest rows that preserve the target width", () => {
  const cards = Array.from({ length: 8 }, (_, rank) => ({ rank }));
  for (const keepGroups of [true, false]) {
    const plan = (target: number) => planTableLayout(390, 1000, { cards, target, keepGroups }).hand;
    const large = plan(240);
    close(large.width, 240);
    assert.equal(large.rows.length, 2);
    const small = plan(150);
    close(small.width, 150);
    assert.deepEqual(small.rows, [cards]);
  }
});

test("a wider row does not justify a third row at the same card width", () => {
  const cards = [1, 2, 1, 2, 2, 1].flatMap((count, rank) => Array.from({ length: count }, () => ({ rank })));
  const plan = (target: number) => planTableLayout(540, 1340, { cards, target, keepGroups: true }).hand;
  const large = plan(240);
  close(large.width, 240);
  assert.deepEqual(large.rows.map(row => row.length), [4, 5]);
  const small = plan(190);
  close(small.width, 190);
  assert.deepEqual(small.rows, [cards]);
});

test("equally wide layouts with the same row count fill the earlier rows first", () => {
  const cards = [8, 2, 7, 11, 5].map(rank => ({ rank }));
  for (const keepGroups of [true, false]) {
    const { hand } = planTableLayout(360, 740, { cards, target: 240, keepGroups });
    close(hand.width, 240);
    assert.deepEqual(hand.rows, [cards.slice(0, 3), cards.slice(3)]);
  }

  const grouped = [8, 2, 7, 7, 5].map(rank => ({ rank }));
  const { hand } = planTableLayout(360, 740, { cards: grouped, target: 240, keepGroups: true });
  close(hand.width, 240);
  assert.deepEqual(hand.rows, [grouped.slice(0, 2), grouped.slice(2)]);
});

test("hover fans anchor the selected top card and expose each earlier card's corner", () => {
  for (const width of [60, 142, 240]) for (const count of [1, 2, 3, 4]) {
    const anchor = { x: 225, y: 410, width, clipWidth: 35, clipHeight: 65 };
    const positions = hoverPositions(anchor, count);
    assert.deepEqual(positions.at(-1), { x: anchor.x, y: anchor.y, width });
    for (let index = 0; index < count; index++) {
      assert.equal(positions[index]!.y, anchor.y);
      assert.equal(positions[index]!.width, width);
      assert.equal(positions[index]!.clipHeight, undefined);
      if (index) {
        const gap = positions[index]!.x - positions[index - 1]!.x;
        close(gap, width * PILE_STEP);
        assert(gap >= width * CORNER_WIDTH / ART_WIDTH);
      }
    }
    assert.equal(anchor.clipHeight, 65);
  }
});
