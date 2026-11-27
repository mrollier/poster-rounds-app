// Learning stars from swipes ("which of these two places is better for this event?"). Pure functions,
// tested in tests/rank.test.js. In plain terms:
//   - Every place gets a score. If A beats B, A's score goes up and B's down, more so when the result was
//     a surprise. This is the Bradley–Terry model, the idea behind chess ratings: the chance that A beats B
//     is 1 / (1 + e^(score_B − score_A)).
//   - Each admin sees a deck of 60 places, paired like a chess tournament ("Swiss rounds"): first at
//     random, later places with similar scores meet, so each swipe teaches the most.
//   - Scores become stars by share: the top 10% 3★, the next 15% 2★, the next 25% 1★, the rest 0★.

// ---------- The fit ----------

// ids: place ids; comparisons: [{a, b, y}] with y = 1 (a better), 0 (b better) or 0.5 (about the same).
// Each score starts at its prior mean (0, or `mean[id]`), and a prior with spread `sd` keeps a place with
// few swipes from running off to extremes. Fitted with Newton steps, one place at a time.
// Returns Map(id → {score, sd, n}); sd = how unsure the score still is, n = number of comparisons.
export function fitBT(ids, comparisons, { sd = 1.5, mean = {} } = {}) {
  const prior = id => mean[id] || 0, v = sd * sd;
  const score = new Map(ids.map(id => [id, prior(id)]));
  const mine = new Map(ids.map(id => [id, []]));
  for (const c of comparisons) if (score.has(c.a) && score.has(c.b)) { mine.get(c.a).push(c); mine.get(c.b).push(c); }
  const p = (a, b) => 1 / (1 + Math.exp(score.get(b) - score.get(a)));
  let h = new Map();
  for (let sweep = 0; sweep < 50; sweep++) {
    let biggest = 0;
    for (const id of ids) {
      let g = -(score.get(id) - prior(id)) / v, hh = 1 / v;
      for (const c of mine.get(id)) {
        const pa = p(c.a, c.b);
        g += id === c.a ? c.y - pa : (1 - c.y) - (1 - pa);
        hh += pa * (1 - pa);
      }
      score.set(id, score.get(id) + g / hh);
      h.set(id, hh);
      biggest = Math.max(biggest, Math.abs(g / hh));
    }
    if (biggest < 1e-6) break;
  }
  return new Map(ids.map(id => [id, { score: score.get(id), sd: 1 / Math.sqrt(h.get(id) || 1 / v), n: mine.get(id).length }]));
}

// ---------- The deck ----------

// How many places of each type go in a deck of 60: at least one of every type, more where the top places
// likely are. Types not listed get 1.
const QUOTA = { sci: 9, boards: 7, arts: 5, student: 4, ideas: 3, startups: 3, libraries: 3, community: 3, bookshops: 3,
  research: 2, makers: 2, veggie: 2, cafes: 2, musicvenues: 2, stages: 2 };
const active = p => p.active === undefined || /^(true|yes|1|x)$/i.test(String(p.active).trim());

// 60 place ids for swiping. `must`: (parts of) names that always go in, e.g. places the organiser knows
// are rated wrong. Within a type, busy and quiet places take turns (importance 3, 2, 1, 3, …), so the deck
// shows the whole range. Deterministic: same places in, same deck out.
export function chooseDeck(places, { size = 60, must = [] } = {}) {
  const live = places.filter(active).sort((a, b) => (a.place_id < b.place_id ? -1 : 1));
  const deck = [], take = p => { if (p && !deck.includes(p.place_id)) deck.push(p.place_id); };
  for (const m of must) take(live.find(p => p.name.toLowerCase().includes(m.toLowerCase())));
  const types = [...new Set(live.map(p => p.type))].sort();
  for (const t of types) {
    const ofType = live.filter(p => p.type === t);
    const byImp = [3, 2, 1].map(i => ofType.filter(p => Math.round(+p.importance) === i));
    const order = [];
    for (let k = 0; order.length < ofType.length; k++) for (const list of byImp) if (list[k]) order.push(list[k]);
    const want = QUOTA[t] || 1, have = () => deck.filter(id => ofType.some(p => p.place_id === id)).length;
    for (const p of order) { if (have() >= want || deck.length >= size) break; take(p); }
  }
  // A type with fewer places than its quota leaves room: fill it with the busiest places left.
  for (const p of [...live].sort((a, b) => b.importance - a.importance)) { if (deck.length >= size) break; take(p); }
  return deck.slice(0, size);
}

// ---------- Pairing ----------

// A small seeded random generator: the same seed gives the same pairs, so a schedule can be rebuilt
// from the swipes alone (also offline, also on another phone).
const seeded = seed => () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;

// One Swiss round: every place in the deck once. Round 1 at random; later rounds sort by current score
// and pair each place with the nearest one it hasn't met yet. met: [{a, b}] earlier pairs.
// Returns [{left, right}]; which card is left is random (so a habit of swiping one way can't tilt scores).
export function swissRound(deck, met, scores, seed, round) {
  const rand = seeded(seed * 1000 + round);
  let order = [...deck];
  if (round === 1) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  } else {
    order.sort((x, y) => (scores.get(y)?.score || 0) - (scores.get(x)?.score || 0) || (x < y ? -1 : 1));
  }
  const key = (x, y) => [x, y].sort().join("|"), seen = new Set(met.map(m => key(m.a, m.b)));
  const pairs = [], free = new Set(order);
  for (const id of order) {
    if (!free.has(id)) continue;
    free.delete(id);
    const rest = order.filter(x => free.has(x));
    const other = rest.find(x => !seen.has(key(id, x))) || rest[0];
    if (!other) break; // an odd one out sits this round out
    free.delete(other);
    pairs.push(rand() < 0.5 ? { left: id, right: other } : { left: other, right: id });
  }
  return pairs;
}

// ---------- How settled is it? ----------

// Spearman rank correlation: 1 = same order, 0 = unrelated. Ties share their average rank.
export function spearman(xs, ys) {
  const rank = v => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = new Array(v.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const a = rank(xs), b = rank(ys), n = a.length, ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - ma); da += (a[i] - ma) ** 2; db += (b[i] - ma) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 1;
}

// For the screen: the fewest comparisons any deck place has had, the share of "about the same", and how
// much the order still moved since the previous round (1 = not at all; ≥ 0.9 counts as settled).
export function quality(comparisons, ids, scores, before) {
  const n = Object.fromEntries(ids.map(id => [id, 0]));
  for (const c of comparisons) { if (c.a in n) n[c.a]++; if (c.b in n) n[c.b]++; }
  return {
    minPer: Math.min(...Object.values(n)),
    drawShare: comparisons.length ? comparisons.filter(c => c.y === 0.5).length / comparisons.length : 0,
    settled: spearman(ids.map(id => before.get(id)?.score || 0), ids.map(id => scores.get(id)?.score || 0)),
  };
}

// ---------- Scores to stars ----------

// The scores at the 10% / 25% / 50% lines. Stored with a set when it is made, so later places don't
// shift anyone's stars ("frozen per campaign").
export function sharesToThresholds(scores, { t3 = 0.10, t2 = 0.25, t1 = 0.50 } = {}) {
  const s = [...scores].sort((a, b) => b - a), at = share => s[Math.max(0, Math.round(share * s.length) - 1)];
  return { t3: at(t3), t2: at(t2), t1: at(t1) };
}
export const starsFromScore = (score, set) => (score >= set.t3 ? 3 : score >= set.t2 ? 2 : score >= set.t1 ? 1 : 0);
