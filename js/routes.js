// The three route modes (spec §4.6), ported from the prototype. Pure functions, no DOM.
// Points are anything with lat/lon (places from the sheet, {lat, lon} for home or my position).
import { dist, hav, minutes, stopMinutes } from "./geo.js";

// ---------- Ordering stops: nearest first, then 2-opt ----------

// Visit `stops` starting at `start`, ending at `end` (or anywhere when end is null).
// 1. Nearest neighbour: always go to the closest stop not yet visited.
// 2. 2-opt: if reversing a stretch of the trip makes it shorter, reverse it; repeat until nothing helps.
// Good, not provably optimal: the "travelling salesman" problem has no fast exact answer.
export function orderStops(start, stops, end = null) {
  if (stops.length < 2) return [...stops];
  const pts = [start, ...stops], n = pts.length, END = n; // END: the trip's end, a virtual point
  const D = pts.map(a => pts.map(b => dist(a, b)));       // all distances once, in a table
  const toEnd = pts.map(p => (end ? dist(p, end) : 0));   // no fixed end: finishing anywhere costs 0
  const d = (a, b) => (b === END ? toEnd[a] : a === END ? toEnd[b] : D[a][b]);

  const seq = [0], left = new Set(stops.map((_, i) => i + 1));
  while (left.size) {
    const cur = seq[seq.length - 1];
    let best = null;
    for (const i of left) if (best === null || D[cur][i] < D[cur][best]) best = i;
    seq.push(best); left.delete(best);
  }
  seq.push(END);

  for (let pass = 0, better = true; better && pass < 60; pass++) {
    better = false;
    for (let i = 1; i < seq.length - 2; i++) {
      for (let j = i + 1; j < seq.length - 1; j++) {
        const before = d(seq[i - 1], seq[i]) + d(seq[j], seq[j + 1]);
        const after = d(seq[i - 1], seq[j]) + d(seq[i], seq[j + 1]);
        if (after + 1 < before) { // +1 m: ignore rounding noise, so it can't loop forever
          seq.splice(i, j - i + 1, ...seq.slice(i, j + 1).reverse());
          better = true;
        }
      }
    }
  }
  return seq.slice(1, -1).map(i => stops[i - 1]);
}

// Length and timing of a trip: start → stops → end (end optional).
// Returns {metres, minutes, arrive: minutes from the start at which you reach each stop}.
export function tripTime(start, stops, end, mode) {
  let metres = 0, mins = 0, prev = start;
  const arrive = [];
  for (const s of stops) {
    const m = dist(prev, s);
    metres += m; mins += minutes(m, mode);
    arrive.push(Math.round(mins));
    mins += stopMinutes(s);
    prev = s;
  }
  if (end) { const m = dist(prev, end); metres += m; mins += minutes(m, mode); }
  return { metres, minutes: mins, arrive };
}

// ---------- On my way: cheapest insertion ----------

// From `from` to `to` with `budget` extra minutes: keep adding the stop that costs the fewest extra
// minutes (detour + time at the stop) at its best place in the trip, until the next one would go over.
export function computeWay(from, to, candidates, budget, mode) {
  const mins = (a, b) => minutes(dist(a, b), mode);
  const seq = [from, to], left = [...candidates];
  let extra = 0;
  for (;;) {
    let best = null;
    for (const s of left) {
      for (let i = 0; i < seq.length - 1; i++) {
        const c = mins(seq[i], s) + mins(s, seq[i + 1]) - mins(seq[i], seq[i + 1]) + stopMinutes(s);
        if (!best || c < best.c) best = { s, i, c };
      }
    }
    if (!best || extra + best.c > budget) break;
    seq.splice(best.i + 1, 0, best.s);
    left.splice(left.indexOf(best.s), 1);
    extra += best.c;
  }
  return { stops: seq.slice(1, -1), direct: Math.round(mins(from, to)), extra: Math.round(extra) };
}

// ---------- Zones: park the bike, walk a loop, bike on ----------

const RACK_MAX = 400;     // metres: a bike rack further than this from the zone's middle doesn't count
const LABEL_MAX = 1500;   // metres: a neighbourhood name further away than this isn't used

// Walking loop from the bike spot past every stop and back. Returns the stops in order and the metres.
export function walkLoop(park, stops) {
  const loop = orderStops(park, stops, park);
  return { stops: loop, metres: tripTime(park, loop, park, "walk").metres };
}

// One zone from a group of stops: its middle, bike spot, walking loop and time.
export function zoneOf(stops, racks) {
  const centre = { lat: avg(stops, "lat"), lon: avg(stops, "lon") };
  let rack = null, rd = Infinity;
  for (const r of racks) { const d = hav(centre, r); if (d < rd) { rd = d; rack = r; } }
  const hasRack = rd < RACK_MAX;
  const park = stops.length === 1 ? { lat: +stops[0].lat, lon: +stops[0].lon } : hasRack ? rack : centre;
  const loop = stops.length === 1 ? { stops, metres: 0 } : walkLoop(park, stops);
  const mins = minutes(loop.metres, "walk") + stops.reduce((n, s) => n + stopMinutes(s), 0);
  return {
    ids: loop.stops.map(s => s.place_id), park, rack: hasRack && stops.length > 1, centre,
    mins: Math.round(mins), walkM: Math.round(loop.metres), posters: stops.reduce((n, s) => n + (+s.posters || 0), 0),
  };
}
const avg = (xs, k) => xs.reduce((n, x) => n + +x[k], 0) / xs.length;

// A zone that takes longer than `maxMin` is cut in two around its two farthest-apart stops, again and again.
export function splitZone(stops, maxMin, racks) {
  const z = zoneOf(stops, racks);
  if (stops.length === 1 || z.mins <= maxMin) return [z];
  let a = stops[0], b = stops[1], far = -1;
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const d = dist(stops[i], stops[j]);
      if (d > far) { far = d; a = stops[i]; b = stops[j]; }
    }
  }
  const A = stops.filter(s => dist(s, a) <= dist(s, b)), B = stops.filter(s => dist(s, a) > dist(s, b));
  return A.length && B.length ? [...splitZone(A, maxMin, racks), ...splitZone(B, maxMin, racks)] : [z];
}

// All zones. Stops within `gap` metres of each other end up in one group (chains count: A–B and B–C
// put A, B and C together); groups that take too long are split. Biggest zones first.
// labels: [{name, lat, lon}] for zone names; racks: [{lat, lon}].
export function buildZones(stops, { gap, maxMin }, racks, labels) {
  // Union-find: each stop points to a "parent"; stops with the same root are in the same group.
  const parent = stops.map((_, i) => i);
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      if (dist(stops[i], stops[j]) <= gap) parent[root(i)] = root(j);
    }
  }
  const groups = new Map();
  stops.forEach((s, i) => { const r = root(i); groups.set(r, [...(groups.get(r) || []), s]); });

  const zones = [...groups.values()].flatMap(g => splitZone(g, maxMin, racks))
    .sort((p, q) => q.ids.length - p.ids.length || q.posters - p.posters || (p.ids[0] < q.ids[0] ? -1 : 1));

  // Names: the nearest neighbourhood; a one-stop zone is called after its stop. Repeats get " 2", " 3".
  const byId = new Map(stops.map(s => [s.place_id, s])), used = {};
  zones.forEach((z, i) => {
    let name = null, best = LABEL_MAX;
    for (const l of labels) { const d = hav(z.centre, l); if (d < best) { best = d; name = l.name; } }
    if (z.ids.length === 1 || !name) name = byId.get(z.ids[0]).name;
    used[name] = (used[name] || 0) + 1;
    Object.assign(z, { id: `z${i + 1}`, name: used[name] > 1 ? `${name} ${used[name]}` : name });
  });
  return zones;
}
