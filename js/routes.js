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

// How round a shape is (Polsby–Popper): 4π·area / perimeter². A circle is 1, a square about 0.79, a long
// strip close to 0. Round zones make short walking loops. Measured on a flat map, where 1° east is
// cos(51°) times shorter than 1° north (fine for Belgium).
const cos = Math.cos(51 * Math.PI / 180);
export function compactness(rings) {
  const xy = p => [p[1] * cos, p[0]];
  let area = 0;
  for (const r of rings) {
    let a = 0;
    r.forEach((p, i) => { const [x1, y1] = xy(p), [x2, y2] = xy(r[(i + 1) % r.length]); a += x1 * y2 - x2 * y1; });
    area += Math.abs(a) / 2; // shoelace formula; sectors have no holes
  }
  const perimeter = zoneOutline(rings).reduce((n, [p, q]) => { const [x1, y1] = xy(p), [x2, y2] = xy(q); return n + Math.hypot(x2 - x1, y2 - y1); }, 0);
  return perimeter ? (4 * Math.PI * area) / perimeter ** 2 : 0;
}

// All zones for these stops. target: minutes per zone (ZONE_MINUTES).
// Returns [{id, name, rings, ids: [place ids], centre, mins}], biggest first.
//   1. Each sector with stops starts as a zone, whole (a busy sector is never cut up).
//   2. The smallest zone under the target joins a neighbour it shares a stretch of border with (not just a
//      corner, and never across an empty sector), so every zone stays one connected area. Of the
//      neighbours that keep the work under target × 1.3, it takes the one giving the roundest shape.
//   3. A zone is named after the sector that holds most of its stops.
export function buildZones(stops, sectors, target) {
  const bySector = new Map();
  for (const s of stops) { const i = sectorOf(s, sectors); bySector.set(i, [...(bySector.get(i) || []), s]); }
  const full = [...bySector.keys()].sort((x, y) => x - y);
  // Which sectors share a border edge: the same two border points in a row (either direction).
  const edges = new Map();
  for (const i of full) {
    for (const r of sectors[i].rings) {
      r.forEach((p, n) => {
        const k = [key(p), key(r[(n + 1) % r.length])].sort().join(" ");
        edges.set(k, [...(edges.get(k) || []), i]);
      });
    }
  }
  const touch = new Map(full.map(i => [i, new Set()]));
  for (const ids of edges.values()) for (const i of ids) for (const j of ids) if (i !== j) touch.get(i).add(j);

  let zones = full.map(i => ({ parts: [i], stops: bySector.get(i), mins: zoneMinutes(bySector.get(i)) }));
  const zoneOf = new Map(zones.map(z => [z.parts[0], z]));
  const rings = z => z.parts.flatMap(i => sectors[i].rings);
  const neighbours = z => new Set(z.parts.flatMap(i => [...touch.get(i)]).map(i => zoneOf.get(i)).filter(q => q !== z));

  // ponytail: greedy, not optimal (the exact "max-p regions" problem is hard); good enough for a map.
  const stuck = new Set(); // a zone that can't join anything never can later: neighbours only grow
  for (;;) {
    const z = zones.filter(q => q.mins < target && !stuck.has(q)).sort((a, b) => a.mins - b.mins)[0];
    if (!z) break;
    const options = [...neighbours(z)]
      .map(n => ({ n, mins: zoneMinutes([...z.stops, ...n.stops]) }))
      .filter(o => o.mins <= target * 1.3)
      .map(o => ({ ...o, round: compactness([...rings(z), ...rings(o.n)]) }))
      .sort((a, b) => b.round - a.round || a.mins - b.mins);
    if (!options.length) { stuck.add(z); continue; }
    const { n, mins } = options[0];
    const m = { parts: [...z.parts, ...n.parts], stops: [...z.stops, ...n.stops], mins };
    m.parts.forEach(i => zoneOf.set(i, m));
    zones = zones.filter(q => q !== z && q !== n).concat(m);
  }

  zones.sort((p, q) => q.stops.length - p.stops.length || Math.min(...p.parts) - Math.min(...q.parts));
  const used = {};
  return zones.map((z, n) => {
    // Name: the sector with most of the zone's stops (ties: the first sector); a one-stop zone: its stop.
    const most = [...z.parts].sort((a, b) => bySector.get(b).length - bySector.get(a).length || a - b)[0];
    let name = z.stops.length === 1 ? z.stops[0].name : sectors[most].name;
    used[name] = (used[name] || 0) + 1;
    if (used[name] > 1) name = `${name} ${used[name]}`;
    return { id: `z${n + 1}`, name, rings: rings(z), ids: z.stops.map(s => s.place_id), centre: middle(z.stops), mins: Math.round(z.mins) };
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

// Where to leave the bike for a zone: the public bike rack nearest the middle of its stops, so the walk
// to every stop is short. No rack within 150 m: the middle itself. The same spot whoever opens the zone.
const PARK_MAX = 150; // metres
export function parkAt(stops, racks) {
  const r5 = x => Math.round(x * 1e5) / 1e5;
  const mid = { lat: r5(avg(stops, "lat")), lon: r5(avg(stops, "lon")) };
  let best = null;
  for (const r of racks) if (hav(mid, r) <= PARK_MAX && (!best || hav(mid, r) < hav(mid, best))) best = r;
  return best ? { lat: best.lat, lon: best.lon, rack: true } : { ...mid, rack: false };
}
