// Makes data/sectors-<city>.json: the city's statistical sectors (Statbel), the building blocks of Zones.
// Sectors are Belgium's smallest official areas; their borders follow streets, railways and waterways.
//
//   1. Download "Statistical sectors" (GeoJSON, Lambert 2008 = EPSG:3812) from
//      https://statbel.fgov.be/en/open-data/statistical-sectors-2025 and unzip it.
//   2. node tools/make-sectors.js <the .geojson> <NIS code> <city slug>
//      e.g. node tools/make-sectors.js sh_statbel_statistical_sectors_3812_20250101.geojson 44021 gent
//
// No libraries: it converts Lambert 2008 to GPS coordinates and thins the borders itself. Neighbouring
// sectors keep exactly the same border points, so the app can tell which sectors touch.
import fs from "node:fs";
import path from "node:path";

const [file, nis, slug] = process.argv.slice(2);
if (!slug) { console.error("usage: node tools/make-sectors.js <file.geojson> <NIS code> <city slug>"); process.exit(1); }
const TOLERANCE = 8; // metres: a border point closer than this to the straight line between its neighbours goes

// ---------- Lambert 2008 (EPSG:3812) → latitude/longitude (GRS80; ETRS89 = GPS within a metre) ----------
// The standard inverse Lambert conformal conic projection (Snyder, Map Projections, p. 107).
const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f), rad = Math.PI / 180;
const m = p => Math.cos(p) / Math.sqrt(1 - (e * Math.sin(p)) ** 2);
const t = p => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
const p1 = (49 + 50 / 60) * rad, p2 = (51 + 10 / 60) * rad;
const p0 = (50 + 47 / 60 + 52.134 / 3600) * rad, l0 = (4 + 21 / 60 + 33.177 / 3600) * rad;
const FE = 649328, FN = 665262;
const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
const F = m(p1) / (n * t(p1) ** n), r0 = a * F * t(p0) ** n;
function toLatLon([x, y]) {
  const dx = x - FE, dy = r0 - (y - FN), r = Math.hypot(dx, dy), tt = (r / (a * F)) ** (1 / n);
  let lat = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 8; i++) lat = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(lat)) / (1 + e * Math.sin(lat))) ** (e / 2));
  const lon = Math.atan2(dx, dy) / n + l0;
  return [+(lat / rad).toFixed(5), +(lon / rad).toFixed(5)];
}

// ---------- Read the city's sectors ----------
const all = JSON.parse(fs.readFileSync(file, "utf8")).features;
const feats = all.filter(q => q.properties.cd_munty_refnis === nis);
if (!feats.length) { console.error(`no sectors with NIS code ${nis}`); process.exit(1); }
const title = s => s.toLowerCase().replace(/(^|[\s\-'(])\p{L}/gu, c => c.toUpperCase());
// Every ring of every sector (outer rings and holes alike), without the repeated closing point.
const sectors = feats.map(q => ({
  id: q.properties.cd_sector, name: title(q.properties.tx_sector_descr_nl),
  rings: (q.geometry.type === "Polygon" ? [q.geometry.coordinates] : q.geometry.coordinates).flat().map(r => r.slice(0, -1)),
}));

// ---------- Thin the borders, the same way on both sides of every shared border ----------
const key = p => `${p[0]},${p[1]}`;
const owners = new Map(); // border point → the sectors it belongs to
sectors.forEach((s, i) => s.rings.forEach(r => r.forEach(p => {
  const k = key(p); if (!owners.has(k)) owners.set(k, new Set()); owners.get(k).add(i);
})));
const who = p => [...owners.get(key(p))].sort().join(" ");

// Douglas–Peucker: keep the point farthest from the line between the ends if it's off by more than TOLERANCE.
function dp(pts) {
  if (pts.length < 3) return pts;
  const [A, B] = [pts[0], pts[pts.length - 1]], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len ? Math.abs((B[0] - A[0]) * (A[1] - p[1]) - (A[0] - p[0]) * (B[1] - A[1])) / len : Math.hypot(p[0] - A[0], p[1] - A[1]);
    if (d > far) { far = d; at = i; }
  }
  return far <= TOLERANCE ? [A, B] : [...dp(pts.slice(0, at + 1)).slice(0, -1), ...dp(pts.slice(at))];
}
// A piece of border between two "corners" is thinned in one fixed direction, so the sector on the
// other side (which walks it the other way round) ends up with exactly the same points.
function thin(piece) {
  const flip = key(piece[0]) > key(piece[piece.length - 1]);
  const out = dp(flip ? [...piece].reverse() : piece);
  return flip ? out.reverse() : out;
}
for (const s of sectors) {
  s.rings = s.rings.map(r => {
    // Corners: where the set of neighbouring sectors changes (and always 2 fixed points, for islands).
    const corner = r.map((p, i) => who(p) !== who(r[(i + 1) % r.length]) || who(p) !== who(r[(i - 1 + r.length) % r.length]));
    let ks = corner.flatMap((c, i) => c ? [i] : []);
    if (ks.length < 2) { // an island or a ring with one neighbour all round: pin its two "smallest" points
      const order = r.map((p, i) => i).sort((i, j) => (key(r[i]) < key(r[j]) ? -1 : 1));
      ks = [...new Set([...ks, order[0], order[1]])].sort((i, j) => i - j);
    }
    const out = [];
    ks.forEach((k, j) => {
      const end = ks[(j + 1) % ks.length], piece = [];
      for (let i = k; ; i = (i + 1) % r.length) { piece.push(r[i]); if (i === end && piece.length > 1) break; }
      out.push(...thin(piece).slice(0, -1));
    });
    return out.map(toLatLon).filter((p, i, xs) => i === 0 || key(p) !== key(xs[i - 1]));
  }).filter(r => r.length >= 3);
}

const out = {
  source: "Statbel, statistical sectors 2025 (https://statbel.fgov.be/en/open-data/statistical-sectors-2025), "
    + "open data licence; borders thinned to ~8 m by tools/make-sectors.js",
  city: slug, sectors,
};
const dest = path.join(import.meta.dirname, "..", "data", `sectors-${slug}.json`);
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`${sectors.length} sectors, ${sectors.reduce((n, s) => n + s.rings.flat().length, 0)} points, `
  + `${Math.round(fs.statSync(dest).size / 1024)} KB → ${dest}`);
