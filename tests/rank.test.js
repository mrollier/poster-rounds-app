import test from "node:test";
import assert from "node:assert/strict";
import { fitBT, chooseDeck, swissRound, quality, sharesToThresholds, starsFromScore, spearman, swipesToComparisons, placeBetween } from "../js/rank.js";
import { readTab } from "./csv.js";

// A fixed "random" generator (same every run), so the tests can't flake.
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;

test("fitBT: recovers a known order from simulated swipes", () => {
  const rand = rng(7), ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const truth = Object.fromEntries(ids.map((id, i) => [id, (i - 10) / 4])); // p19 best
  const comps = [];
  for (let k = 0; k < 100; k++) {
    const a = ids[Math.floor(rand() * 20)], b = ids[Math.floor(rand() * 20)];
    if (a === b) continue;
    comps.push({ a, b, y: rand() < 1 / (1 + Math.exp(truth[b] - truth[a])) ? 1 : 0 });
  }
  const fit = fitBT(ids, comps);
  assert.ok(spearman(ids.map(id => truth[id]), ids.map(id => fit.get(id).score)) > 0.8);
  assert.ok(fit.get("p0").sd > 0 && fit.get("p0").n > 0);
});

test("fitBT: a draw puts two places level; no comparisons keeps the prior", () => {
  const fit = fitBT(["a", "b", "c"], [{ a: "a", b: "b", y: 0.5 }]);
  assert.ok(Math.abs(fit.get("a").score - fit.get("b").score) < 1e-9);
  assert.equal(fit.get("c").score, 0);
  assert.equal(fitBT(["c"], [], { mean: { c: 1.2 } }).get("c").score, 1.2);
});

test("chooseDeck: every type, the must-haves, 60 places, deterministic", () => {
  const places = [...readTab("places")];
  const must = ["Campus UFO", "Vlerick", "Timelab"];
  const deck = chooseDeck(places, { must });
  assert.equal(deck.length, 60);
  assert.deepEqual(deck, chooseDeck(places, { must }));
  const byId = new Map(places.map(p => [p.place_id, p]));
  for (const t of new Set(places.map(p => p.type))) assert.ok(deck.some(id => byId.get(id).type === t), t);
  for (const m of must) {
    const hit = places.find(p => p.name.toLowerCase().includes(m.toLowerCase()));
    if (hit) assert.ok(deck.includes(hit.place_id), m);
  }
});

test("swissRound: everyone once, no pair twice, sides from the seed", () => {
  const deck = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const r1 = swissRound(deck, [], new Map(), 42, 1);
  assert.equal(r1.length, 5);
  assert.deepEqual(new Set(r1.flatMap(p => [p.left, p.right])).size, 10);
  assert.deepEqual(r1, swissRound(deck, [], new Map(), 42, 1));
  const met = r1.map(p => ({ a: p.left, b: p.right }));
  const scores = new Map(deck.map((id, i) => [id, { score: i }]));
  const r2 = swissRound(deck, met, scores, 42, 2);
  const key = (x, y) => [x, y].sort().join("|"), seen = new Set(met.map(m => key(m.a, m.b)));
  assert.ok(r2.every(p => !seen.has(key(p.left, p.right))));
});

test("quality: comparisons per place, share of draws, settled", () => {
  const q = quality([{ a: "a", b: "b", y: 0.5 }, { a: "a", b: "c", y: 1 }], ["a", "b", "c"],
    new Map([["a", { score: 1 }], ["b", { score: 0 }], ["c", { score: -1 }]]), new Map([["a", { score: 1 }], ["b", { score: 0 }], ["c", { score: -1 }]]));
  assert.equal(q.minPer, 1);
  assert.equal(q.drawShare, 0.5);
  assert.equal(q.settled, 1);
});

test("shares: top 10% 3★, next 15% 2★, next 25% 1★, rest 0★", () => {
  const scores = Array.from({ length: 100 }, (_, i) => i);
  const set = sharesToThresholds(scores);
  const count = { 0: 0, 1: 0, 2: 0, 3: 0 };
  scores.forEach(s => count[starsFromScore(s, set)]++);
  assert.deepEqual(count, { 0: 50, 1: 25, 2: 15, 3: 10 });
});

test("swipesToComparisons: undo takes back that admin's last swipe of the pair; '?' gives no comparison", () => {
  const row = (by, l, r, outcome, round = 1) => ({ by, left_id: l, right_id: r, outcome, round: String(round) });
  const rows = [row("Ann", "a", "b", "left"), row("Ann", "a", "b", "undo"), row("Ann", "a", "b", "right"),
    row("Bo", "a", "b", "left"), row("Ann", "c", "d", "unknown_left"), row("Bo", "c", "d", "draw")];
  assert.deepEqual(swipesToComparisons(rows), [{ a: "a", b: "b", y: 0 }, { a: "a", b: "b", y: 1 }, { a: "c", b: "d", y: 0.5 }]);
});

test("placeBetween: a place Claude puts between two anchors gets a score between theirs", () => {
  const anchors = [{ score: 3 }, { score: 1 }, { score: -1 }]; // best first
  assert.equal(placeBetween(anchors, 0, "middle"), 2);
  assert.equal(placeBetween(anchors, 0, "closer_top"), 2.5);
  assert.equal(placeBetween(anchors, 1, "closer_bottom"), -0.5);
  assert.equal(placeBetween(anchors, -1, "middle"), 4);   // above the best anchor
  assert.equal(placeBetween(anchors, 2, "middle"), -2);   // below the worst
});
