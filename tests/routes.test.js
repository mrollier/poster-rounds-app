import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { orderStops, tripTime, computeWay, buildZones, sectorOf, zoneOutline, parkAt, compactness, ZONE_MINUTES } from "../js/routes.js";
import { stars, eventWeights } from "../js/logic.js";
import { readTab, DATA } from "./csv.js";

const places = readTab("places");
const weights = eventWeights(readTab("types"), "AI Safety");
const stops = places.filter(p => stars(p, weights) > 0);
const racks = JSON.parse(fs.readFileSync(path.join(DATA, "racks-gent.json"), "utf8")).racks.map(([lat, lon]) => ({ lat, lon }));
const sectors = JSON.parse(fs.readFileSync(path.join(DATA, "sectors-gent.json"), "utf8")).sectors;
const centre = { lat: 51.0543, lon: 3.7174 };

// A fixed "random" shuffle (same every run), so the test can't flake.
function shuffled(xs, seed = 42) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { seed = (seed * 16807) % 2147483647; const j = seed % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

test("orderStops: visits every stop once, and beats a random order by far", () => {
  const order = orderStops(centre, stops, centre);
  assert.equal(order.length, stops.length);
  assert.equal(new Set(order.map(s => s.place_id)).size, stops.length);
  const planned = tripTime(centre, order, centre, "bike").metres;
  const random = tripTime(centre, shuffled(stops), centre, "bike").metres;
  assert.ok(planned < random / 3, `planned ${Math.round(planned)} m vs random ${Math.round(random)} m`);
});

test("orderStops: without an end, the trip doesn't come back", () => {
  const a = { place_id: "a", lat: 51.0, lon: 3.70 }, b = { place_id: "b", lat: 51.0, lon: 3.71 }, c = { place_id: "c", lat: 51.0, lon: 3.72 };
  assert.deepEqual(orderStops({ lat: 51.0, lon: 3.69 }, [c, a, b]).map(s => s.place_id), ["a", "b", "c"]);
});

test("computeWay: stays within the extra-time budget", () => {
  const from = { lat: 51.0362, lon: 3.7104 }, to = { lat: 51.0607, lon: 3.7291 }; // Sint-Pieters → Dampoort-ish
  for (const budget of [5, 15, 30, 60]) {
    const w = computeWay(from, to, stops, budget, "bike");
    assert.ok(w.extra <= budget, `budget ${budget}: extra ${w.extra}`);
    if (budget >= 15) assert.ok(w.stops.length > 0);
  }
  assert.ok(computeWay(from, to, stops, 60, "bike").stops.length > computeWay(from, to, stops, 15, "bike").stops.length);
});

test("sectors-gent.json: the Lambert → GPS conversion puts places in the right sector", () => {
  const name = p => sectors[sectorOf(p, sectors)].name;
  assert.equal(name(places.find(p => p.name === "City board Overpoort 6")), "Overpoort");
  assert.equal(name({ lat: 51.0545, lon: 3.7215 }), "Kuip"); // Korenmarkt, in the old centre ("de Kuip")
});

test("buildZones on the seed data: deterministic, every stop in one zone, zones near the target size", () => {
  const z1 = buildZones(stops, sectors, ZONE_MINUTES.M), z2 = buildZones(stops, sectors, ZONE_MINUTES.M);
  assert.deepEqual(z1, z2);
  assert.deepEqual(z1.flatMap(z => z.ids).sort(), stops.map(s => s.place_id).sort());
  // Merged zones stay under target × 1.3; a single busy sector may be longer (it is never cut).
  for (const z of z1) if (sectorsOf(z).size > 1) assert.ok(z.mins <= ZONE_MINUTES.M * 1.3, `${z.id} takes ${z.mins} min`);
  const small = buildZones(stops, sectors, ZONE_MINUTES.S), large = buildZones(stops, sectors, ZONE_MINUTES.L);
  assert.ok(small.length > z1.length && z1.length > large.length, `${small.length} / ${z1.length} / ${large.length}`);
});

// A 3 × 3 grid of square "sectors", 0.01° apart, named by row and column ("00" … "22").
const d = x => Math.round(x * 1e5) / 1e5; // like the data file: 5 decimals, so shared corners are equal
const sq = (r, c) => [[d(51 + r / 100), d(3.7 + c / 100)], [d(51 + r / 100), d(3.71 + c / 100)],
  [d(51.01 + r / 100), d(3.71 + c / 100)], [d(51.01 + r / 100), d(3.7 + c / 100)]];
const grid = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => ({ id: `${r}${c}`, rings: [sq(r, c)] })));
const at = (id, r, c, type = "sci") => ({ place_id: id, name: id, lat: 51.005 + r / 100, lon: 3.705 + c / 100, type });

// The sectors (by name) that a zone's stops lie in.
const byPlace = new Map(stops.map(p => [p.place_id, p]));
const sectorsOf = z => new Set(z.ids.map(id => sectors[sectorOf(byPlace.get(id), sectors)].name));
// How many separate loops an outline has: 1 = one connected area.
function loops(segs) {
  const up = new Map(), find = k => { while (up.get(k) !== k) k = up.get(k); return k; };
  for (const [a, b] of segs) for (const k of [a.join(), b.join()]) if (!up.has(k)) up.set(k, k);
  for (const [a, b] of segs) up.set(find(a.join()), find(b.join()));
  return new Set([...up.keys()].map(find)).size;
}

test("buildZones: zones only merge across a shared border, never via a corner or an empty sector", () => {
  const row = [0, 1, 2, 3].map(c => ({ id: `0${c}`, name: `0${c}`, rings: [sq(0, c)] })); // 4 squares in a row
  assert.equal(buildZones([at("a", 0, 0), at("b", 0, 1)], row, 999).length, 1); // side by side: merge
  assert.equal(buildZones([at("a", 0, 0), at("b", 0, 2)], row, 999).length, 2); // an empty square between
  assert.equal(buildZones([at("a", 0, 0), at("b", 1, 1)], grid, 999).length, 2); // corners touch only
  assert.equal(buildZones([at("a", 0, 0), at("b", 0, 1)], grid, 1).length, 2);   // small target: no merge
});

test("buildZones: every zone on the Ghent data is one connected area", () => {
  for (const size of ["S", "M", "L"]) {
    for (const z of buildZones(stops, sectors, ZONE_MINUTES[size])) assert.equal(loops(zoneOutline(z.rings)), 1, `${size} ${z.name}`);
  }
});

test("buildZones: a busy sector stays one zone", () => {
  const busy = stops.filter(p => sectors[sectorOf(p, sectors)].name === "Boekentoren").map(p => p.place_id);
  assert.ok(busy.length > 5);
  const z = buildZones(stops, sectors, ZONE_MINUTES.S).filter(q => q.ids.some(id => busy.includes(id)));
  assert.equal(z.length, 1);
});

test("buildZones: a zone is named after the sector holding most of its stops", () => {
  for (const z of buildZones(stops, sectors, ZONE_MINUTES.M)) {
    const stop = byPlace.get(z.ids[0]).name; // a one-stop zone: its stop's name (maybe + " 2")
    if (z.ids.length === 1) { assert.ok(z.name === stop || z.name.startsWith(`${stop} `), z.name); continue; }
    const count = {};
    for (const id of z.ids) { const n = sectors[sectorOf(byPlace.get(id), sectors)].name; count[n] = (count[n] || 0) + 1; }
    const most = Math.max(...Object.values(count));
    assert.ok(count[z.name.replace(/ \d+$/, "")] === most, `${z.name}: ${JSON.stringify(count)}`);
  }
});

test("compactness: a square beats a strip of three squares", () => {
  const strip = [sq(0, 0), sq(0, 1), sq(0, 2)];
  assert.ok(compactness([sq(0, 0)]) > compactness(strip));
  assert.ok(compactness([sq(0, 0)]) > 0.7 && compactness([sq(0, 0)]) <= Math.PI / 4 + 1e-9);
});

test("zoneOutline: two squares side by side have 6 border edges (the shared one is inside)", () => {
  assert.equal(zoneOutline([sq(0, 0)]).length, 4);
  assert.equal(zoneOutline([sq(0, 0), sq(0, 1)]).length, 6);
});

test("parkAt: the bike rack nearest the middle, else the middle", () => {
  const st = [{ lat: 51.015, lon: 3.705 }, { lat: 51.015, lon: 3.715 }]; // middle: 51.015, 3.71
  const near = { lat: 51.015, lon: 3.7101 }, far = { lat: 51.015, lon: 3.704 };
  assert.deepEqual(parkAt(st, [far, near]), { ...near, rack: true });
  assert.deepEqual(parkAt(st, [{ lat: 51.0177, lon: 3.71 }]), { lat: 51.015, lon: 3.71, rack: false }); // 300 m away
  assert.deepEqual(parkAt(st, []), { lat: 51.015, lon: 3.71, rack: false });
});
