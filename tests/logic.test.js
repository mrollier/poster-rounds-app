import test from "node:test";
import assert from "node:assert/strict";
import { stars, placeStars, fillScore, eventTypes, eventWeights, starText, cycleStart, brusselsToday, isDone, cycleFor, gmapsUrl, cleanBoot } from "../js/logic.js";
import { readTab } from "./csv.js";

const places = readTab("places");
const types = readTab("types");

test("stars on the seed data: 3★ only for the right audience (AI Safety: science campuses, startups, makers)", () => {
  const w = eventWeights(types, "AI Safety"), count = { 0: 0, 1: 0, 2: 0, 3: 0 };
  places.forEach(p => count[stars(p, w)]++);
  assert.deepEqual(count, { 0: 0, 1: 124, 2: 42, 3: 32 });
  assert.ok(places.filter(p => stars(p, w) === 3).every(p => w[p.type] === 3));
});

test("event types come from the ev: columns of the Types tab", () => {
  assert.deepEqual(eventTypes(types), ["AI Safety", "Animal Welfare", "Music", "Poetry"]);
  assert.deepEqual(eventTypes([]), []);
  assert.equal(eventWeights(types, "Poetry").startups, 0);
  assert.equal(eventWeights(types, "Music").stages, 3);
});

test("stars: the type's fit sets them, a quiet spot loses one; a type outside the preset counts as 1", () => {
  const w = { a: 3, b: 1, c: 0, d: 2 };
  assert.equal(stars({ type: "a", importance: "3" }, w), 3); // right audience, busy spot
  assert.equal(stars({ type: "a", importance: "2" }, w), 3); // right audience, normal spot
  assert.equal(stars({ type: "a", importance: "1" }, w), 2); // right audience, quiet spot
  assert.equal(stars({ type: "d", importance: "3" }, w), 2); // busy spot, so-so audience: not lifted
  assert.equal(stars({ type: "d", importance: "1" }, w), 1);
  assert.equal(stars({ type: "b", importance: "3" }, w), 1); // busy spot, wrong audience
  assert.equal(stars({ type: "b", importance: "1" }, w), 1); // never below 1
  assert.equal(stars({ type: "c", importance: "3" }, w), 1); // ticked by hand: weight 1
  assert.equal(stars({ type: "zzz", importance: "2" }, w), 1);
  assert.equal(stars({ type: "a", importance: "" }, w), 0);  // no importance: hidden
  assert.equal(stars({ type: "a", importance: "-1" }, w), 0);
  assert.equal(stars({ type: "a", importance: "7" }, { a: 9 }), 3); // never more than 3
  assert.equal(starText(2), "★★☆");
});

test("cycleStart: 1st and 3rd Friday", () => {
  const rule = "nth-weekday FRI 1,3";
  // Dec 2026: Fridays are 4, 11, 18, 25 → cleaning on the 4th and the 18th.
  assert.equal(cycleStart(rule, "2026-12-04"), "2026-12-04"); // the cleaning day itself
  assert.equal(cycleStart(rule, "2026-12-09"), "2026-12-04");
  assert.equal(cycleStart(rule, "2026-12-17"), "2026-12-04");
  assert.equal(cycleStart(rule, "2026-12-18"), "2026-12-18");
  assert.equal(cycleStart(rule, "2026-12-31"), "2026-12-18");
  // month boundary: Jan 2027's first Friday is the 1st; before that, Dec 18 still counts
  assert.equal(cycleStart(rule, "2027-01-01"), "2027-01-01");
  // Nov 2026: Fridays 6, 13, 20, 27 → Nov 20 is the 3rd; Nov 25 falls in that cycle
  assert.equal(cycleStart(rule, "2026-11-25"), "2026-11-20");
  // Year boundary backwards: 2026-01-01 is a Thursday; last cleaning was 3rd Friday of Dec 2025 (19th)
  assert.equal(cycleStart(rule, "2026-01-01"), "2025-12-19");
  assert.equal(cycleStart("nth-weekday MON 2", "2026-11-25"), "2026-11-09");
});

test("cycleStart: none / empty", () => {
  assert.equal(cycleStart("none", "2026-12-09"), "");
  assert.equal(cycleStart("", "2026-12-09"), "");
});

test("brusselsToday uses Ghent's date, not UTC", () => {
  // 23:30 UTC on 31 Dec is already 1 Jan in Brussels (UTC+1 in winter)
  assert.equal(brusselsToday(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
});

test("isDone and cycleFor", () => {
  assert.equal(isDone(""), false);
  assert.equal(isDone("later"), false);
  assert.equal(isDone("posted"), true);
  assert.equal(isDone("closed"), true);
  assert.equal(cycleFor({ type: "boards" }, "2026-12-04"), "2026-12-04");
  assert.equal(cycleFor({ type: "sci" }, "2026-12-04"), "");
});

test("gmapsUrl: register addresses by name, other pins by coordinates", () => {
  const reg = { address: "Sint-Salvatorstraat 5", city: "Gent", lat: "51.06", lon: "3.72", location_source: "basisregisters" };
  const osm = { address: "x", city: "Gent", lat: "51.05", lon: "3.71", location_source: "osm" };
  const u = new URL(gmapsUrl(reg, { origin: { lat: 51, lon: 3.7 }, waypoints: [osm], mode: "walk" }));
  assert.equal(u.searchParams.get("destination"), "Sint-Salvatorstraat 5, Gent, Belgium");
  assert.equal(u.searchParams.get("origin"), "51,3.7");
  assert.equal(u.searchParams.get("waypoints"), "51.05,3.71");
  assert.equal(u.searchParams.get("travelmode"), "walking");
});

test("chunkLinks: 3 waypoints + destination per link, each part starts where the last ended", async () => {
  const { chunkLinks } = await import("../js/logic.js");
  const pts = Array.from({ length: 9 }, (_, i) => ({ lat: 51, lon: i }));
  const links = chunkLinks(pts, "bike");
  assert.deepEqual(links.map(l => [l.from, l.to]), [[1, 4], [5, 8], [9, 9]]);
  const second = new URL(links[1].url).searchParams;
  assert.equal(second.get("origin"), "51,3");
  assert.equal(second.get("waypoints"), "51,4|51,5|51,6");
  assert.equal(second.get("destination"), "51,7");
  assert.equal(new URL(links[0].url).searchParams.get("origin"), null);
});

test("cleanBoot: fixes what the sheet gets wrong, leaves out what it can't", () => {
  const P = (id, lat, lon, extra = {}) => ({ place_id: id, name: id, type: "boards", lat, lon, importance: "2", posters: "1", ...extra });
  const raw = {
    types: [{ type: "boards", color: "#000" }, { type: "cafes", color: 'red"><img src=x onerror=alert(1)>' }],
    places: [P("a", "51.05", "3.72"), P("b", "51,06", " 3,73 ", { type: " Boards" }), P("c", "", ""), P("d", "3.72", "51.05"),
             P("a", "51.05", "3.72"), P("e", "51.04", "3.71", { importance: "2,6", posters: "<b>" })],
  };
  const { boot, skipped } = cleanBoot(raw);
  assert.deepEqual(boot.places.map(p => p.place_id), ["a", "b", "e"]);
  assert.deepEqual([boot.places[1].lat, boot.places[1].lon, boot.places[1].type], [51.06, 3.73, "boards"]);
  assert.deepEqual([boot.places[2].importance, boot.places[2].posters], [3, 1]);
  assert.equal(boot.types[1].color, "#444");
  assert.equal(skipped.length, 3); // c (no position), d (swapped: far away), the second a (duplicate)
});

test("placeStars: an override wins; then the learned set; else the type rule", () => {
  const set = { t3: 2, t2: 1, t1: 0, scores: { a: 2.5, b: 0.5, c: -1 } };
  const w = { sci: 3 }, p = (id, type = "sci", importance = "2") => ({ place_id: id, type, importance });
  assert.equal(placeStars(p("a"), { set, weights: w }), 3);
  assert.equal(placeStars(p("b"), { set, weights: w }), 1);
  assert.equal(placeStars(p("c"), { set, weights: w }), 0);          // below the 1★ line: hidden
  assert.equal(placeStars(p("a"), { set, overrides: { a: 1 }, weights: w }), 1);
  assert.equal(placeStars(p("c"), { set, overrides: { c: 0 }, weights: w }), 0);
  assert.equal(placeStars(p("a"), { weights: w }), 3);              // no set: today's rule
  assert.equal(placeStars(p("a"), { overrides: { a: 2 }, weights: w }), 2);
});

test("fillScore: a place without a score gets the average of its type and importance, else of its type", () => {
  const set = { t3: 2, t2: 1, t1: 0, scores: { a: 2, b: 1, c: -1 } };
  const places = [{ place_id: "a", type: "sci", importance: "2" }, { place_id: "b", type: "sci", importance: "2" },
                  { place_id: "c", type: "sci", importance: "1" }];
  assert.equal(fillScore({ place_id: "new", type: "sci", importance: "2" }, set, places), 1.5);
  assert.equal(fillScore({ place_id: "new", type: "sci", importance: "3" }, set, places), 2 / 3);
  assert.equal(fillScore({ place_id: "new", type: "cafes", importance: "3" }, set, places), 0); // nothing similar: the 1★ line
  assert.equal(placeStars({ place_id: "new", type: "sci", importance: "2" }, { set, places }), 2);
});
