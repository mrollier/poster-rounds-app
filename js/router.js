// Real routes along the streets, from the free OSRM route server of FOSSGIS (OpenStreetMap data, no key).
// Used only to draw the line on the map and for navigation: the order of the stops is still worked out on
// the phone with straight-line distances × 1.3 (geo.js), which needs no network.
import { CONFIG } from "../config.js";

const PROFILE = { bike: "bike", walk: "foot" };
const MAX_POINTS = 25;       // waypoints per request; a longer trip is asked in parts
const cache = new Map();     // same points + same travel mode = same answer: ask once (also while it's on its way)

// points: [{lat, lon}], travel: "bike" | "walk".
// Resolves {coords: [[lat, lon], …], metres, seconds}, or null when offline or when there is no route.
export async function route(points, travel) {
  if (!points || points.length < 2) return null;
  const parts = [];
  for (let i = 0; i < points.length - 1; i += MAX_POINTS - 1) parts.push(points.slice(i, i + MAX_POINTS));
  const legs = await Promise.all(parts.map(p => cached(p, travel)));
  if (legs.some(l => !l)) return null;
  return {
    coords: legs.flatMap(l => l.coords),
    metres: legs.reduce((n, l) => n + l.metres, 0),
    seconds: legs.reduce((n, l) => n + l.seconds, 0),
  };
}

function cached(points, travel) {
  // OSRM wants "lon,lat;lon,lat;…". 5 decimals ≈ 1 m.
  const coords = points.map(p => `${(+p.lon).toFixed(5)},${(+p.lat).toFixed(5)}`).join(";");
  const key = `${travel}/${coords}`;
  if (!cache.has(key)) {
    if (cache.size > 200) cache.delete(cache.keys().next().value); // forget the oldest
    cache.set(key, ask(coords, travel).catch(() => { cache.delete(key); return null; })); // failed: try again next time
  }
  return cache.get(key);
}

async function ask(coords, travel) {
  const url = CONFIG.ROUTER_URL.replace("{profile}", PROFILE[travel] || "bike") + coords + "?overview=full&geometries=geojson";
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error(data.code || "no route");
  const r = data.routes[0];
  // GeoJSON gives [lon, lat]; Leaflet wants [lat, lon].
  return { coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]), metres: r.distance, seconds: r.duration };
}
