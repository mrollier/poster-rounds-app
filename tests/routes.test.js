import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { orderStops, tripTime, computeWay, buildZones, sectorOf, zoneOutline, parkFor, ZONE_MINUTES } from "../js/routes.js";
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
  // Merged zones stay under target × 1.3, and busy sectors are cut up: only a single stop can be longer.
  for (const z of z1) if (z.ids.length > 1) assert.ok(z.mins <= ZONE_MINUTES.M * 1.3, `${z.id} takes ${z.mins} min`);
  const small = buildZones(stops, sectors, ZONE_MINUTES.S), large = buildZones(stops, sectors, ZONE_MINUTES.L);
  assert.ok(small.length > z1.length && z1.length > large.length, `${small.length} / ${z1.length} / ${large.length}`);
});

// A 3 × 3 grid of square "sectors", 0.01° apart, named by row and column ("00" … "22").
const d = x => Math.round(x * 1e5) / 1e5; // like the data file: 5 decimals, so shared corners are equal
const sq = (r, c) => [[d(51 + r / 100), d(3.7 + c / 100)], [d(51 + r / 100), d(3.71 + c / 100)],
  [d(51.01 + r / 100), d(3.71 + c / 100)], [d(51.01 + r / 100), d(3.7 + c / 100)]];
const grid = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => ({ id: `${r}${c}`, rings: [sq(r, c)] })));
const at = (id, r, c, type = "sci") => ({ place_id: id, name: id, lat: 51.005 + r / 100, lon: 3.705 + c / 100, type });

test("buildZones: only touching sectors merge; an empty sector in between still connects", () => {
  const row = [0, 1, 2, 3].map(c => ({ id: `0${c}`, rings: [sq(0, c)] })); // 4 squares in a row
  // 00 and 02 both touch the empty 01, so they merge; 00 and 03 have two empty squares between them.
  assert.equal(buildZones([at("a", 0, 0), at("b", 0, 2)], row, 999).length, 1);
  assert.equal(buildZones([at("a", 0, 0), at("b", 0, 3)], row, 999).length, 2);
  // a small target: nothing merges
  assert.equal(buildZones([at("a", 0, 0), at("b", 0, 1)], grid, 1).length, 2);
});

test("buildZones: a sector with too much work is cut in two halfway between its farthest stops", () => {
  const one = [{ id: "x", name: "X", rings: [sq(0, 0)] }];
  const st = [at("a", 0, -0.4), at("b", 0, -0.35), at("c", 0, 0.35), at("d", 0, 0.4)];
  const z = buildZones(st, one, 12); // 4 stops × 5 min > 12 × 1.3: two halves of 2 stops
  assert.deepEqual(z.map(q => q.ids.sort()).sort(), [["a", "b"], ["c", "d"]]);
  // the two halves meet at lon 3.705: the cut points are the same, so each half's outline is a closed box
  for (const q of z) assert.equal(zoneOutline(q.rings).length, 4);
  assert.ok(z.every(q => q.rings[0].some(p => p[1] === 3.705)));
});

test("zoneOutline: two squares side by side have 6 border edges (the shared one is inside)", () => {
  assert.equal(zoneOutline([sq(0, 0)]).length, 4);
  assert.equal(zoneOutline([sq(0, 0), sq(0, 1)]).length, 6);
});

test("parkFor: the bike rack on the side you come from", () => {
  const st = [at("a", 1, 1), at("b", 1, 1.2)];
  const west = { lat: 51.015, lon: 3.711 }, east = { lat: 51.015, lon: 3.7225 };
  const fromWest = { lat: 51.015, lon: 3.6 }, fromEast = { lat: 51.015, lon: 3.8 };
  assert.deepEqual(parkFor(st, fromWest, [west, east]), { ...west, rack: true });
  assert.deepEqual(parkFor(st, fromEast, [west, east]), { ...east, rack: true });
  assert.deepEqual(parkFor(st, fromEast, []), { lat: st[1].lat, lon: st[1].lon, rack: false }); // no rack: nearest stop
});
