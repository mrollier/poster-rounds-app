// The planned modes (On my way, Zones) as "plans" the screen can draw. Works on stops: {place, stars, type, res}.
// (All left has no plan: it just sorts by distance, in app.js.)
// On my way is remembered on the phone and only recalculated when its inputs change, so the order doesn't
// jump around while you are cycling; zones are rebuilt in a few ms when their inputs change.
import { computeWay, buildZones, ZONE_MINUTES } from "./routes.js";
import { isDone, statusOf } from "./logic.js";

export const done = s => isDone(statusOf(s));
export const byId = stops => new Map(stops.map(s => [s.place.place_id, s]));

// ---------- On my way ----------

// way: {from, to, budget, ids}. from/to: {lat, lon, label}. Recalculate with computeWayIds().
export function computeWayIds(kept, way, travel) {
  if (!way.from || !way.to) return { ...way, ids: [], extra: 0 };
  const w = computeWay(way.from, way.to, kept.filter(s => !done(s)).map(s => s.place), way.budget, travel);
  return { ...way, ids: w.stops.map(p => p.place_id), extra: w.extra };
}

export function planWay(kept, way) {
  const all = byId(kept);
  return { route: (way.ids || []).map(id => all.get(id)).filter(Boolean) };
}

// ---------- Zones ----------

// Zones from all stops that pass the filters, done ones included: ticking stops off doesn't move any
// border, a finished zone just turns grey. size: "S", "M" or "L". Returns {key, zones}.
export function zonesNow(kept, key, sectors, size) {
  return { key, zones: buildZones(kept.map(s => s.place), sectors, ZONE_MINUTES[size] || ZONE_MINUTES.M) };
}

// A zone with its live stops and progress.
export function zoneState(z, all) {
  const stops = z.ids.map(id => all.get(id)).filter(Boolean);
  return { ...z, stops, done: stops.filter(done).length, total: stops.length };
}
