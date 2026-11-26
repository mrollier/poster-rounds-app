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

// ---------- Zones: areas that follow streets and water, built from statistical sectors ----------
// Statbel's statistical sectors (data/sectors-<city>.json) are Belgium's smallest official areas; their
// borders run along streets, railways and waterways. A zone = one or more touching sectors, merged until
// it holds about the chosen amount of work. Zones are built from all stops that pass the filters, done
// ones too: so the borders stay put while the team works, and a finished zone simply turns grey.

export const ZONE_MINUTES = { S: 20, M: 45, L: 90 }; // Small / Medium / Large: walking + hanging time
const RACK_MAX = 400;     // metres: a bike rack further than this from every stop of the zone doesn't count
const LABEL_MAX = 1500;   // metres: a neighbourhood name further away than this isn't used
const key = p => `${p[0]},${p[1]}`;

// Walking loop from the bike spot past every stop and back. Returns the stops in order and the metres.
export function walkLoop(park, stops) {
  const loop = orderStops(park, stops, park);
  return { stops: loop, metres: tripTime(park, loop, park, "walk").metres };
}
const avg = (xs, k) => xs.reduce((n, x) => n + +x[k], 0) / xs.length;
const middle = stops => ({ lat: avg(stops, "lat"), lon: avg(stops, "lon") });
// About how long a zone takes: a walking loop from its middle, plus the time at each stop.
const zoneMinutes = stops => (stops.length < 2 ? 0 : minutes(walkLoop(middle(stops), stops).metres, "walk"))
  + stops.reduce((n, s) => n + stopMinutes(s), 0);

// Is the point inside these rings? Ray casting: count the borders crossed going east; odd = inside.
// Holes are rings too, so a point in a hole crosses one more border and counts as outside.
function inside(p, rings) {
  let odd = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ay, ax] = r[i], [by, bx] = r[j];
      if ((ay > p.lat) !== (by > p.lat) && p.lon < ((bx - ax) * (p.lat - ay)) / (by - ay) + ax) odd = !odd;
    }
  }
  return odd;
}

// Per sector, once: its bounding box and middle, to find a point's sector quickly.
const prepared = new WeakMap();
function boxes(sectors) {
  if (!prepared.has(sectors)) prepared.set(sectors, sectors.map(s => {
    const pts = s.rings.flat(), la = pts.map(p => p[0]), lo = pts.map(p => p[1]);
    return { s: Math.min(...la), n: Math.max(...la), w: Math.min(...lo), e: Math.max(...lo), mid: { lat: avg(pts, 0), lon: avg(pts, 1) } };
  }));
  return prepared.get(sectors);
}

// The sector a point lies in; a point outside all of them (e.g. just over the city line) gets the nearest.
export function sectorOf(place, sectors) {
  const box = boxes(sectors), p = { lat: +place.lat, lon: +place.lon }; // the sheet gives text
  const hit = box.findIndex((b, i) => p.lat >= b.s && p.lat <= b.n && p.lon >= b.w && p.lon <= b.e && inside(p, sectors[i].rings));
  if (hit >= 0) return hit;
  let best = 0;
  box.forEach((b, i) => { if (hav(p, b.mid) < hav(p, box[best].mid)) best = i; });
  return best;
}

// One busy sector can hold more work than a zone should (27 stops around the Boekentoren). Then it's cut
// in two along the line halfway between its two farthest-apart stops, again and again until each part fits.
// Only there does a border not follow a street. Rings are cut with the Sutherland–Hodgman method.
const cos = Math.cos(51 * Math.PI / 180); // ponytail: fixed for Belgium, so 1° east ≈ 1° north in metres
function cut(rings, a, b, keepA) {
  // f(p) < 0 on a's side of the line, > 0 on b's side (a flat-earth approximation is fine for a few km).
  const f = p => (p[1] - (a.lon + b.lon) / 2) * cos * cos * (b.lon - a.lon) + (p[0] - (a.lat + b.lat) / 2) * (b.lat - a.lat);
  const keep = p => (keepA ? f(p) <= 0 : f(p) >= 0);
  const r5 = x => Math.round(x * 1e5) / 1e5;
  return rings.map(r => {
    const out = [];
    r.forEach((p, i) => {
      const q = r[(i + 1) % r.length];
      if (keep(p)) out.push(p);
      if (keep(p) !== keep(q)) { // the edge crosses the line: add the crossing point
        const [u, v] = key(p) < key(q) ? [p, q] : [q, p]; // same order for both halves: the very same point
        const t = f(u) / (f(u) - f(v));
        out.push([r5(u[0] + t * (v[0] - u[0])), r5(u[1] + t * (v[1] - u[1]))]);
      }
    });
    return out;
  }).filter(r => r.length >= 3);
}
function splitUnit(u, target) {
  if (u.stops.length < 2 || zoneMinutes(u.stops) <= target * 1.3) return [u];
  let a = u.stops[0], b = u.stops[1], far = -1;
  for (const p of u.stops) for (const q of u.stops) if (hav(p, q) > far) { far = hav(p, q); a = p; b = q; }
  const A = u.stops.filter(s => hav(s, a) <= hav(s, b)), B = u.stops.filter(s => hav(s, a) > hav(s, b));
  if (!A.length || !B.length) return [u];
  const pa = { lat: +a.lat, lon: +a.lon }, pb = { lat: +b.lat, lon: +b.lon };
  return [...splitUnit({ ...u, rings: cut(u.rings, pa, pb, true), stops: A }, target),
          ...splitUnit({ ...u, rings: cut(u.rings, pa, pb, false), stops: B }, target)];
}

// All zones for these stops. target: minutes per zone (ZONE_MINUTES). labels: [{name, lat, lon}] for names.
// Returns [{id, name, rings, ids: [place ids], centre, mins}], biggest first.
export function buildZones(stops, sectors, target, labels = []) {
  const bySector = new Map();
  for (const s of stops) { const i = sectorOf(s, sectors); bySector.set(i, [...(bySector.get(i) || []), s]); }
  // The pieces: sectors with stops (cut up when too busy), and empty sectors, which only connect.
  const units = [...bySector.keys()].sort((x, y) => x - y)
    .flatMap(i => splitUnit({ rings: sectors[i].rings, stops: bySector.get(i), name: sectors[i].name }, target));
  const nodes = [...units, ...sectors.filter((_, i) => !bySector.has(i)).map(s => ({ rings: s.rings, stops: [] }))];
  const at = new Map(); // border point → pieces that have it: pieces that share a point touch
  nodes.forEach((u, i) => u.rings.flat().forEach(p => { const k = key(p); at.set(k, [...(at.get(k) || []), i]); }));
  const touch = nodes.map(() => new Set());
  for (const ids of at.values()) for (const i of ids) for (const j of ids) if (i !== j) touch[i].add(j);
  const full = i => i < units.length;
  // Two pieces with stops that touch the same empty sector (a park, a stretch of water) count as neighbours.
  const near = i => {
    const out = new Set();
    for (const j of touch[i]) {
      if (full(j)) out.add(j);
      else for (const k of touch[j]) if (k !== i && full(k)) out.add(k);
    }
    return out;
  };

  let zones = units.map((u, i) => ({ parts: [i], stops: u.stops, mins: zoneMinutes(u.stops) }));
  const zoneOf = new Map(zones.map(z => [z.parts[0], z]));
  const neighbours = z => new Set(z.parts.flatMap(i => [...near(i)]).map(i => zoneOf.get(i)).filter(q => q !== z));

  // Grow: the smallest zone under the target joins its smallest neighbour, as long as the result stays
  // under target × 1.3. A zone that can't join anything never can later (neighbours only grow).
  // ponytail: greedy, not optimal (the exact "max-p regions" problem is hard); good enough for a map.
  const stuck = new Set();
  for (;;) {
    const z = zones.filter(q => q.mins < target && !stuck.has(q)).sort((a, b) => a.mins - b.mins)[0];
    if (!z) break;
    const options = [...neighbours(z)].sort((a, b) => a.mins - b.mins);
    const fit = options.map(n => ({ n, mins: zoneMinutes([...z.stops, ...n.stops]) })).find(o => o.mins <= target * 1.3);
    if (!fit) { stuck.add(z); continue; }
    const m = { parts: [...z.parts, ...fit.n.parts], stops: [...z.stops, ...fit.n.stops], mins: fit.mins };
    m.parts.forEach(i => zoneOf.set(i, m));
    zones = zones.filter(q => q !== z && q !== fit.n).concat(m);
  }

  zones.sort((p, q) => q.stops.length - p.stops.length || Math.min(...p.parts) - Math.min(...q.parts));
  const used = {};
  return zones.map((z, n) => {
    const centre = middle(z.stops);
    // Name: the nearest neighbourhood, else the sector's own name; a one-stop zone is called after its stop.
    // Repeats get " 2", " 3".
    let name = units[z.parts[0]].name, best = LABEL_MAX;
    for (const l of labels) { const d = hav(centre, l); if (d < best) { best = d; name = l.name; } }
    if (z.stops.length === 1) name = z.stops[0].name;
    used[name] = (used[name] || 0) + 1;
    return { id: `z${n + 1}`, name: used[name] > 1 ? `${name} ${used[name]}` : name, rings: z.parts.flatMap(i => units[i].rings),
      ids: z.stops.map(s => s.place_id), centre, mins: Math.round(z.mins) };
  });
}

// A zone's border: the edges of its sectors that only one of them has (shared edges are inside).
// Returns [[[lat, lon], [lat, lon]], …]: separate segments, which Leaflet draws as one line.
export function zoneOutline(rings) {
  const count = new Map();
  for (const r of rings) {
    r.forEach((p, i) => {
      const q = r[(i + 1) % r.length], k = [key(p), key(q)].sort().join(" ");
      count.set(k, count.has(k) ? null : [p, q]); // null: seen twice, so it's an inside edge
    });
  }
  return [...count.values()].filter(Boolean);
}

// Where to leave the bike for a zone, seen from where you are coming from: the bike rack (within 400 m
// of a stop) that makes biking there + walking the loop quickest. No rack: the stop nearest to you.
// ponytail: the 15 racks closest to you only, so it stays quick with thousands of racks.
export function parkFor(stops, from, racks) {
  const near = racks.filter(r => stops.some(s => hav(r, s) <= RACK_MAX))
    .sort((a, b) => hav(from, a) - hav(from, b)).slice(0, 15);
  let best = null;
  for (const r of near) {
    const t = minutes(dist(from, r), "bike") + minutes(walkLoop(r, stops).metres, "walk");
    if (!best || t < best.t) best = { t, r };
  }
  if (best) return { lat: best.r.lat, lon: best.r.lon, rack: true };
  const s = [...stops].sort((a, b) => hav(from, a) - hav(from, b))[0];
  return { lat: +s.lat, lon: +s.lon, rack: false };
}
