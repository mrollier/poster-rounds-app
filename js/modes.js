// The planned modes (On my way, Zones) as "plans" the screen can draw. Works on stops: {place, stars, type, res}.
// (All left has no plan: it just sorts by distance, in app.js.)
// Each mode remembers its result on the phone and only recalculates when its inputs change,
// so the order doesn't jump around while you are cycling.
import { computeWay, buildZones, ZONE_MINUTES } from "./routes.js";
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

// Zones from all stops that pass the filters, done ones included: ticking stops off doesn't move any
// border, a finished zone just turns grey. size: "S", "M" or "L". Returns {key, zones}.
export function zonesNow(kept, key, sectors, size, labels) {
  return { key, zones: buildZones(kept.map(s => s.place), sectors, ZONE_MINUTES[size] || ZONE_MINUTES.M, labels) };
}

// A zone with its live stops and progress.
export function zoneState(z, i, all) {
  const stops = z.ids.map(id => all.get(id)).filter(Boolean);
  const d = stops.filter(done).length;
  return { ...z, number: i + 1, stops, done: d, total: stops.length };
}
export { idsOf, byId };
