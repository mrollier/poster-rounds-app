// Distances and travel times. Points are {lat, lon}. Pure functions, no DOM.

// Streets don't go in straight lines: real routes in Ghent are about 1.3 × the straight-line distance.
const DETOUR = 1.3;
const SPEED_KMH = { bike: 15, walk: 4.5 };

// Straight-line distance in metres (haversine formula: distance over the earth's surface).
// Works on places straight from the sheet too (lat/lon as text): the + turns text into numbers.
export function hav(a, b) {
  const r = Math.PI / 180, la1 = +a.lat * r, la2 = +b.lat * r, dLa = la2 - la1, dLo = (+b.lon - +a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Estimated distance along the streets, in metres.
export const dist = (a, b) => hav(a, b) * DETOUR;

// Minutes to cover `metres` by bike or on foot.
export const minutes = (metres, mode) => metres / (SPEED_KMH[mode] * 1000 / 60);

// Minutes spent at a stop: a city board is quick, a building means finding the desk or the notice board.
export const stopMinutes = place => (place.type === "boards" ? 3 : 5);

// The item of `list` nearest to `p`, within `max` metres, leaving out what `skip` says: {item, m} or null.
export function nearest(p, list, { max = Infinity, skip = () => false } = {}) {
  let best = null;
  for (const item of list) {
    if (skip(item)) continue;
    const m = hav(p, item);
    if (m <= max && (!best || m < best.m)) best = { item, m };
  }
  return best;
}

// ---------- Following a route line (navigation) ----------
// A line is [[lat, lon], …]. Street-scale maths on a flat projection: metres east (x) and north (y).
const M_PER_DEG = 111320;
const flat = (lat, lon, lat0) => [lon * M_PER_DEG * Math.cos(lat0 * Math.PI / 180), lat * M_PER_DEG];

// Where on the line I am: the nearest point, as {i, t, off}: on segment i (from point i to i+1),
// fraction t along it, and `off` = how many metres I am away from the line.
export function nearestOnLine(p, line) {
  const [px, py] = flat(+p.lat, +p.lon, +p.lat);
  let best = { i: 0, t: 0, off: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = flat(line[i][0], line[i][1], +p.lat), [bx, by] = flat(line[i + 1][0], line[i + 1][1], +p.lat);
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const off = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (off < best.off) best = { i, t, off };
  }
  return best;
}

// Metres along the line from that nearest point to the end.
export function lineLeft(line, { i, t }) {
  const seg = k => hav({ lat: line[k][0], lon: line[k][1] }, { lat: line[k + 1][0], lon: line[k + 1][1] });
  let m = line.length > 1 ? seg(i) * (1 - t) : 0;
  for (let k = i + 1; k < line.length - 1; k++) m += seg(k);
  return m;
}
