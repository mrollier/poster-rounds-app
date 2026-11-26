import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { orderStops, tripTime, computeWay, buildZones } from "../js/routes.js";
import { stars, eventWeights } from "../js/logic.js";
import { readTab, DATA } from "./csv.js";

const places = readTab("places");
const weights = eventWeights(readTab("types"), "AI Safety");
const stops = places.filter(p => stars(p, weights) > 0);
const racks = JSON.parse(fs.readFileSync(path.join(DATA, "racks-gent.json"), "utf8")).racks.map(([lat, lon]) => ({ lat, lon }));
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

test("buildZones on the seed data: deterministic, every walking loop fits the time", () => {
  const opts = { gap: 600, maxMin: 60 };
  const z1 = buildZones(stops, opts, racks, []), z2 = buildZones(stops, opts, racks, []);
  assert.deepEqual(z1, z2);
  // With straight line × 1.3 distances (the prototype used a street matrix and got ~74 / 33)
  assert.equal(z1.length, 61);
  assert.equal(z1.filter(z => z.ids.length === 1).length, 27);
  assert.equal(z1.reduce((n, z) => n + z.ids.length, 0), stops.length); // every stop in exactly one zone
  for (const z of z1) if (z.ids.length > 1) assert.ok(z.mins <= 60, `${z.id} takes ${z.mins} min`);
  // A smaller walking distance gives more, smaller zones
  assert.ok(buildZones(stops, { gap: 200, maxMin: 60 }, racks, []).length > z1.length);
});

test("buildZones: names from the nearest neighbourhood, repeats numbered", () => {
  const two = [{ place_id: "a", name: "A", lat: 51.05, lon: 3.72, posters: 1, type: "sci" },
               { place_id: "b", name: "B", lat: 51.0501, lon: 3.7201, posters: 1, type: "sci" },
               { place_id: "c", name: "C", lat: 51.07, lon: 3.72, posters: 1, type: "sci" },
               { place_id: "d", name: "D", lat: 51.0701, lon: 3.7201, posters: 1, type: "sci" }];
  const z = buildZones(two, { gap: 300, maxMin: 60 }, [], [{ name: "Centrum", lat: 51.06, lon: 3.72 }]);
  assert.deepEqual(z.map(q => q.name).sort(), ["Centrum", "Centrum 2"]);
});
