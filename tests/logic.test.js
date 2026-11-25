import test from "node:test";
import assert from "node:assert/strict";
import { priority, cycleStart, brusselsToday, isDone, cycleFor, gmapsUrl } from "../js/logic.js";
import { readTab } from "./csv.js";

const places = readTab("places");
const campaign = readTab("campaigns").find(c => c.campaign_id === "2026-12-ai-safety-lecture");

test("priority on the seed data gives 54 / 56 / 88 for the AI-safety lecture", () => {
  const count = { 0: 0, 1: 0, 2: 0, 3: 0 };
  places.forEach(p => count[priority(p, campaign)]++);
  assert.deepEqual(count, { 0: 0, 1: 54, 2: 56, 3: 88 });
});

test("priority: unknown tags weigh 0, best tag wins", () => {
  const c = { "w:a": "3", "w:b": "1" };
  assert.equal(priority({ tags: "zzz", importance: "3" }, c), 0);
  assert.equal(priority({ tags: "b a", importance: "2" }, c), 1); // 3 × 2 = 6
  assert.equal(priority({ tags: "b", importance: "3" }, c), 2);   // 1 × 3 = 3
  assert.equal(priority({ tags: "b", importance: "1" }, c), 3);   // 1 × 1 = 1
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
