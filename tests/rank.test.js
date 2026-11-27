import test from "node:test";
import assert from "node:assert/strict";
import { fitBT, chooseDeck, swissRound, quality, sharesToThresholds, starsFromScore, spearman, swipesToComparisons, placeBetween, historyFromRows, nextPair, LINES, tierLabels } from "../js/rank.js";
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

test("quality: comparisons per place, settled", () => {
  const q = quality([{ a: "a", b: "b", y: 0.5 }, { a: "a", b: "c", y: 1 }], ["a", "b", "c"],
    new Map([["a", { score: 1 }], ["b", { score: 0 }], ["c", { score: -1 }]]), new Map([["a", { score: 1 }], ["b", { score: 0 }], ["c", { score: -1 }]]));
  assert.equal(q.minPer, 1);
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

test("historyFromRows: a new phone rebuilds an admin's swipes, with undos applied like the fit does", () => {
  const row = (by, l, r, outcome, round = 1) => ({ by, left_id: l, right_id: r, outcome, round: String(round), deck_version: "v1", undo_of: "" });
  const rows = [row("Ann", "a", "b", "left"), row("Ann", "a", "b", "undo"), row("Ann", "c", "d", "right", 2), row("Bo", "a", "b", "left")];
  assert.deepEqual(historyFromRows(rows, "Ann", "v1"), [{ left: "c", right: "d", outcome: "right", round: 2 }]);
});

test("nextPair: a '?' doesn't restart the schedule; rounds keep going", () => {
  const deck = Array.from({ length: 10 }, (_, i) => `p${i}`), h = [];
  for (let k = 0; k < 24; k++) {
    const p = nextPair(deck, h, 42);
    if (!p) break;
    h.push({ left: p.left, right: p.right, outcome: k % 7 === 2 ? "unknown_left" : "left", round: p.round }); // a "?" now and then
  }
  // Rounds only go forward: a "?" in round 3 must not send the schedule back to round 1.
  h.forEach((x, i) => assert.ok(i === 0 || x.round >= h[i - 1].round, `swipe ${i} went back from round ${h[i - 1]?.round} to ${x.round}`));
  assert.ok(Math.max(...h.map(x => x.round)) >= 3, `stuck in round ${Math.max(...h.map(x => x.round))}`);
  const dupes = new Set(h.map(x => [x.left, x.right].sort().join("|")));
  assert.ok(dupes.size >= h.length - 2, "pairs repeat too often");
});

test("spearman: no spread to compare means 'not settled' (0), not 1", () => {
  assert.equal(spearman([0, 0, 0], [3, 2, 1]), 0);
});

test("'Both 3★ / 1–2★ / 0★': a draw between the two, and each place's side of the 3★ and 1★ lines", () => {
  const row = (l, r, outcome) => ({ by: "Ann", left_id: l, right_id: r, outcome, round: "1" });
  assert.deepEqual(swipesToComparisons([row("a", "b", "both_high"), row("c", "d", "both_low"), row("e", "f", "both_mid")]), [
    { a: "a", b: "b", y: 0.5 }, { a: "a", b: LINES.high, y: 1 }, { a: "b", b: LINES.high, y: 1 },
    { a: "c", b: "d", y: 0.5 }, { a: "c", b: LINES.low, y: 0 }, { a: "d", b: LINES.low, y: 0 },
    { a: "e", b: "f", y: 0.5 }, { a: "e", b: LINES.high, y: 0 }, { a: "f", b: LINES.high, y: 0 },
    { a: "e", b: LINES.low, y: 1 }, { a: "f", b: LINES.low, y: 1 }]);
  // An undo takes back a "both" swipe like any other.
  assert.deepEqual(swipesToComparisons([row("a", "b", "both_high"), row("a", "b", "undo")]), []);
});

test("the lines spread places that only ever drew: 'both 3★' ones end above 'both 0★' ones", () => {
  const row = (l, r, outcome) => ({ by: "Ann", left_id: l, right_id: r, outcome, round: "1" });
  const comps = swipesToComparisons([row("a", "b", "both_high"), row("c", "d", "both_low"), row("b", "c", "draw")]);
  const fit = fitBT(["a", "b", "c", "d", LINES.high, LINES.low], comps);
  assert.ok(fit.get("a").score > fit.get("d").score + 0.5, `${fit.get("a").score} vs ${fit.get("d").score}`);
  assert.ok(fit.get(LINES.high).score < fit.get("a").score && fit.get(LINES.low).score > fit.get("d").score);
  // Plain draws only: no spread at all (what the earlier swipes give).
  const flat = fitBT(["a", "b", "c", "d"], swipesToComparisons([row("a", "b", "draw"), row("c", "d", "draw"), row("b", "c", "draw")]));
  assert.ok(Math.abs(flat.get("a").score - flat.get("d").score) < 1e-6);
});

test("tierLabels: what the admins called each place with the 'Both …' buttons (undos applied)", () => {
  const row = (l, r, outcome) => ({ by: "Ann", left_id: l, right_id: r, outcome });
  const t = tierLabels([row("a", "b", "both_high"), row("a", "c", "both_mid"), row("d", "e", "both_low"), row("d", "e", "undo"), row("a", "b", "left")]);
  assert.deepEqual(t, { a: [3, 1], b: [3], c: [1] }); // 3 = "3★", 1 = "1–2★", 0 = "0★"
});

test("nextPair: 'both' swipes count for the schedule and rounds keep going", () => {
  const deck = Array.from({ length: 10 }, (_, i) => `p${i}`), h = [];
  for (let k = 0; k < 20; k++) {
    const p = nextPair(deck, h, 7);
    if (!p) break;
    h.push({ left: p.left, right: p.right, outcome: ["both_high", "both_low", "left"][k % 3], round: p.round });
  }
  assert.ok(h.length === 20 && Math.max(...h.map(x => x.round)) >= 3);
});

// The science check: simulate an admin who knows the true scores and the true 3★ / 1★ lines (at the 90% and
// 50% marks), swiping on a Swiss schedule like the app. The fit must find the order, and the 1★ line must
// land near the true 50% mark. With one-sided evidence (only "both 3★" and "both 0★") the lines drift off;
// the middle button gives each line evidence from both sides. (The 3★ line, a tail, is pulled up by the
// prior shrinking the few top places: it shows too few places above it, so it isn't used as a check.)
test("simulation: the fit recovers the order and where the 3★ / 1★ lines are", () => {
  const rand = rng(11), deck = Array.from({ length: 60 }, (_, i) => `p${String(i).padStart(2, "0")}`);
  const truth = Object.fromEntries(deck.map(id => [id, (rand() - 0.5) * 5]));
  const sorted = Object.values(truth).sort((a, b) => b - a), hi = sorted[5], lo = sorted[29]; // 6 of 60 above hi, 30 below lo
  const tier = s => (s >= hi ? "high" : s < lo ? "low" : "mid");
  const h = [];
  for (let k = 0; k < 250; k++) {
    const p = nextPair(deck, h, 3);
    const d = truth[p.left] - truth[p.right], same = tier(truth[p.left]) === tier(truth[p.right]);
    // Close and in the same tier: a "both" button; else a winner, by the Bradley–Terry chance.
    const outcome = same && Math.abs(d) < 0.5 ? `both_${tier(truth[p.left])}` : rand() < 1 / (1 + Math.exp(-d)) ? "left" : "right";
    h.push({ left: p.left, right: p.right, outcome, round: p.round });
  }
  const rows = h.map(x => ({ by: "Ann", left_id: x.left, right_id: x.right, outcome: x.outcome, round: String(x.round) }));
  const fit = fitBT([...deck, LINES.high, LINES.low], swipesToComparisons(rows));
  const rho = spearman(deck.map(id => truth[id]), deck.map(id => fit.get(id).score));
  const below1 = deck.filter(id => fit.get(id).score < fit.get(LINES.low).score).length / deck.length;
  assert.ok(rho > 0.9, `order: spearman ${rho.toFixed(2)}`);
  assert.ok(Math.abs(below1 - 0.50) <= 0.1, `below the 1★ line: ${below1}`);
  // The lines help the order: the same swipes with plain draws instead of "both" give a worse fit.
  const plain = fitBT(deck, swipesToComparisons(rows.map(r => ({ ...r, outcome: r.outcome.startsWith("both") ? "draw" : r.outcome }))));
  assert.ok(rho > spearman(deck.map(id => truth[id]), deck.map(id => plain.get(id).score)), "lines don't help the order");
});
