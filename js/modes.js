// The planned modes (On my way, Zones) as "plans" the screen can draw. Works on stops: {place, stars, type, res}.
// (All left has no plan: it just sorts by distance, in app.js.)
// Each mode remembers its result on the phone and only recalculates when its inputs change,
// so the order doesn't jump around while you are cycling.
import { computeWay, buildZones } from "./routes.js";
import { isDone } from "./logic.js";

export const statusOf = s => s.res?.status || "";
export const done = s => isDone(statusOf(s));
const idsOf = stops => stops.map(s => s.place.place_id);
const byId = stops => new Map(stops.map(s => [s.place.place_id, s]));

// ---------- On my way ----------

// way: {from, to, budget, ids}. from/to: {lat, lon, label}. Recalculate with computeWayIds().
export function computeWayIds(kept, way, travel) {
  if (!way.from || !way.to) return { ...way, ids: [], extra: 0, direct: 0 };
  const w = computeWay(way.from, way.to, kept.filter(s => !done(s)).map(s => s.place), way.budget, travel);
  return { ...way, ids: w.stops.map(p => p.place_id), extra: w.extra, direct: w.direct };
}

export function planWay(kept, way) {
  const all = byId(kept);
  return { route: (way.ids || []).map(id => all.get(id)).filter(Boolean) };
}

// ---------- Zones ----------

// saved: {key, zones}. Zones are rebuilt only when the settings or filters change (the key), or on
// "Rebuild zones": stops being ticked off just fade their zone, they don't reshuffle the map.
export function zonesNow(kept, saved, key, opts, racks, labels, force = false) {
  if (!force && saved?.key === key && Array.isArray(saved.zones)) return saved;
  const zones = buildZones(kept.filter(s => !done(s)).map(s => s.place), opts, racks, labels);
  return { key, zones };
}

// Progress colour: dark slate for an untouched zone, fading to light grey as its stops get done.
export function zoneColor(fraction) {
  const a = [31, 41, 51], b = [200, 200, 200];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * fraction)).join(",")})`;
}

// A zone with its live stops and progress.
export function zoneState(z, i, all) {
  const stops = z.ids.map(id => all.get(id)).filter(Boolean);
  const d = stops.filter(done).length;
  return { ...z, number: i + 1, stops, done: d, total: stops.length, color: zoneColor(stops.length ? d / stops.length : 1) };
}
export { idsOf, byId };
