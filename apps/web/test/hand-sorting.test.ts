import assert from "node:assert/strict";
import test from "node:test";
import { standardDeck } from "../../../packages/game-server/src/rules.ts";
import { sortVisibleHand } from "../src/hand-sorting.ts";
import { DEFAULT_SETTINGS, readSettings } from "../src/settings.ts";

const deck = standardDeck();
const parse = (text: string) => text.split(" ").map(label => deck.find(card =>
  card.rank === ({ A: 1, J: 11, Q: 12, K: 13 }[label.slice(0, -1)] ?? Number(label.slice(0, -1))) &&
  card.suit[0]!.toUpperCase() === label.at(-1))!);
// Suit tie order varies in the supplied examples. Compare rank groups, keeping
// the queen of spades separate because it has its own sorting priority.
const groups = (text: string) => parse(text).map(card => card.rank === 12 && card.suit === "spades" ? "QS" : card.rank);
const fixtures = [
  [2, "10H 5S 7C 9S 3C 9H 6S 4H", "3C 4H 5S 6S 7C 9S 9H 10H"],
  [3, "8D 5S 8C 3D 6C KD 2C 2H", "3D 5S 6C KD 2C 2H 8D 8C"],
  [4, "KC AD 2S 3S 4H 6S QS 8D", "3S 4H 6S KC AD 2S QS 8D"],
  [5, "5H 8D 2C AH 7C KD 9C 10H", "5H 7C 9C 10H KD AH 2C 8D"],
  [6, "5H KC 5S AC KS 4C AS KH", "4C 5S 5H KS KC KH AS AC"],
  [7, "QS AS 9D 5C 7C 7S 9C KS", "5C 7S 7C 9C 9D KS AS QS"],
  [8, "AH 8D JS 10C 8C 7S 6H QD", "6H 7S 10C QD AH JS 8C 8D"],
  [9, "6C 3D 5S 3S AC JH 6D 4D", "3D 3S 4D 5S 6C 6D AC JH"],
  [10, "9H 10S 4H 5C 9S KS QH 3D", "3D 4H 5C 9H 9S 10S QH KS"],
  [11, "2H JC 6D 10C 4S JS 8D QS", "4S 6D 10C 2H QS JC JS 8D"],
  [12, "10D QH 8S 10S 6S 4H 3D QS", "3D 4H 6S 10D 10S QH QS 8S"],
  [13, "KS 5S 7S 7C 9S 6H 4H 7H", "4H 5S 6H 7S 7H 7C 9S KS"],
  [14, "QH AS 5S 6D 9H 10D AH 2C", "5S 6D 9H 10D QH AS AH 2C"],
  [16, "10C 9H KC 2D 9D 2C 5C AC", "5C 9H 9D 10C KC AC 2D 2C"],
  [17, "5H QD KH 10H 5C 9D 6C 5D", "5H 5C 5D 6C 9D 10H QD KH"],
  [18, "5C 10S QD 5S 6H AC 10C JH", "5C 5S 6H 10C 10S QD AC JH"],
  [19, "5C 4C 10H 10C JD 9D 4D AS", "4C 4D 5C 9D 10H 10C AS JD"],
  [20, "8C QC 3C KH 7C 3D 7H 9D", "3D 3C 7H 7C 9D QC KH 8C"],
  [21, "KS 7H KH JS 9D 10H 10D 8D", "7H 9D 10H 10D KS KH JS 8D"],
  [22, "5C KD 8D KH JC 6S 7S 3S", "3S 5C 6S 7S KD KH JC 8D"],
  [23, "3D 4D 10D 10H 3S 10S 6S 8H", "3D 3S 4D 6S 10D 10H 10S 8H"],
  [24, "3H JD 4H KH KC JS 2C QS", "3H 4H KC KH 2C QS JS JD"],
  [25, "10D KS 9C 6S 9S 5H AS AH", "5H 6S 9C 9S 10D KS AH AS"],
  [26, "9C 7C JD AC 10D 5S 4S 9D", "4S 5S 7C 9D 9C 10D AC JD"],
  [27, "10H JC AS 9H 7S 6S KD 8D", "6S 7S 9H 10H KD AS JC 8D"],
  [28, "JS 2C 10H JD 9S 10C QS AC", "9S 10H 10C AC 2C QS JD JS"],
  [29, "3H 3D AH 3S 5D JD 10D KS", "3H 3D 3S 5D 10D KS AH JD"],
] as const;

for (const [number, dealt, expected] of fixtures) {
  test(`wizard matches rank groups in example ${number}`, () => {
    const sorted = sortVisibleHand(parse(dealt), "wizard");
    assert.deepEqual(sorted.map(card => card.rank === 12 && card.suit === "spades" ? "QS" : card.rank), groups(expected));
  });
}

test("inconsistent examples use the same action-card priorities as the other hands", () => {
  for (const [dealt, expected] of [
    ["7H 10S 8C QS 8H AC 8D 2C", "7H 10S AC 2C QS 8C 8H 8D"],
    ["5C KH AD 6S 10H AC QS 2H", "5C 6S 10H KH AD AC 2H QS"],
    ["8C 2S 5C 4D JC JS 2H QS", "4D 5C 2S 2H QS JC JS 8C"],
  ]) assert.deepEqual(sortVisibleHand(parse(dealt!), "wizard"), parse(expected!));
});

test("sorting is visual only, preserves card identities and equal-rank order, and default restores original order", () => {
  const hand = Object.freeze(parse("8H 9D 9C 3S AH"));
  const before = [...hand];
  const sorted = sortVisibleHand(hand, "wizard");
  assert.deepEqual(sorted, parse("3S 9D 9C AH 8H"));
  assert.deepEqual(hand, before);
  assert.ok(sorted.every(card => hand.includes(card)));
  assert.deepEqual(sortVisibleHand(hand, "default"), before);
  assert.deepEqual(sortVisibleHand([], "wizard"), []);
  assert.deepEqual(sortVisibleHand([hand[0]!], "wizard"), [hand[0]]);
});

test("sorting setting defaults safely and survives saved-settings round trips", () => {
  assert.equal(DEFAULT_SETTINGS.handSortingStrategy, "default");
  for (const value of [null, {}, { handSortingStrategy: "unknown" }, { handSortingStrategy: 1 }]) {
    assert.equal(readSettings(value).handSortingStrategy, "default");
  }
  const saved = readSettings({ ...DEFAULT_SETTINGS, handSortingStrategy: "wizard" });
  assert.deepEqual(readSettings(JSON.parse(JSON.stringify(saved))), saved);
});

const anupaFixtures = [
  ["7H 10S 8C QS 8H AC 8D 2C", "8H 8C 8D QS 2C AC 10S 7H"],
  ["10H 5S 7C 9S 3C 9H 6S 4H", "9S 6S 5S 7C 3C 10H 9H 4H"],
  ["8D 5S 8C 3D 6C KD 2C 2H", "8C 8D 2H 2C 5S 6C KD 3D"],
  ["KC AD 2S 3S 4H 6S QS 8D", "8D QS 2S AD 6S 3S KC 4H"],
  ["5H 8D 2C AH 7C KD 9C 10H", "8D 2C AH 9C 7C 10H 5H KD"],
  ["5H KC 5S AC KS 4C AS KH", "AC AS KS 5S KC 4C KH 5H"],
  ["QS AS 9D 5C 7C 7S 9C KS", "QS AS KS 7S 9C 7C 5C 9D"],
  ["AH 8D JS 10C 8C 7S 6H QD", "8C 8D JS AH 7S 10C 6H QD"],
  ["6C 3D 5S 3S AC JH 6D 4D", "AC JH 5S 3S 6C 6D 4D 3D"],
  ["9H 10S 4H 5C 9S KS QH 3D", "KS 10S 9S 5C QH 9H 4H 3D"],
] as const;

// Action-card ties have no consistent ordering in the examples. Compare their
// categories while checking every ordinary card's exact identity and position.
const anupaSequence = (cards: ReturnType<typeof parse>) => cards.map(card =>
  card.special === "normal" ? card.id : card.special === "reverse" ? "skip" : card.special);

for (const [index, [dealt, expected]] of anupaFixtures.entries()) {
  test(`anupa matches example ${index + 1} apart from unspecified action-card tie order`, () => {
    const hand = parse(dealt);
    const before = hand.slice();
    const sorted = sortVisibleHand(hand, "anupa");
    assert.deepEqual(anupaSequence(sorted), anupaSequence(parse(expected)));
    assert.deepEqual(hand, before);
    assert.deepEqual(sorted.map(card => card.id).sort((a, b) => a - b), hand.map(card => card.id).sort((a, b) => a - b));
    assert.deepEqual(sortVisibleHand(hand, "default"), before);
    assert.deepEqual(sortVisibleHand(sorted, "anupa"), sorted);
  });
}

test("anupa matches the supplied prefix of the unfinished eleventh example", () => {
  const sorted = sortVisibleHand(parse("2H JC 6D 10C 4S JS 8D QS"), "anupa");
  assert.deepEqual(anupaSequence(sorted.slice(0, 6)), anupaSequence(parse("8D QS 2H JS JC 4S")));
  assert.deepEqual(sorted.slice(6), parse("10C 6D"));
});

test("anupa keeps tied action cards in existing order and preserves identities", () => {
  const hand = Object.freeze(parse("AH 8D JS 2C 8C 2H QS"));
  const sorted = sortVisibleHand(hand, "anupa");
  assert.deepEqual(sorted, parse("8D 8C QS 2C 2H AH JS"));
  assert.ok(sorted.every(card => hand.includes(card)));
  assert.deepEqual(sortVisibleHand([], "anupa"), []);
  assert.deepEqual(sortVisibleHand([hand[0]!], "anupa"), [hand[0]]);
});

test("anupa stays selected when saved settings are read again", () => {
  const saved = readSettings({ ...DEFAULT_SETTINGS, handSortingStrategy: "anupa" });
  assert.equal(saved.handSortingStrategy, "anupa");
  assert.deepEqual(readSettings(JSON.parse(JSON.stringify(saved))), saved);
});
