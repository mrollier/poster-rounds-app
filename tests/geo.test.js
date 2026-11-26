import test from "node:test";
import assert from "node:assert/strict";
import { nearestOnLine, lineLeft, hav } from "../js/geo.js";

// An L-shaped route in Ghent: 3 points, two legs of roughly 200 m.
const line = [[51.0500, 3.7200], [51.0518, 3.7200], [51.0518, 3.7229]];
const total = lineLeft(line, { i: 0, t: 0 });

test("lineLeft: the whole line from its start, nothing from its end", () => {
  const legs = hav({ lat: 51.05, lon: 3.72 }, { lat: 51.0518, lon: 3.72 }) + hav({ lat: 51.0518, lon: 3.72 }, { lat: 51.0518, lon: 3.7229 });
  assert.ok(Math.abs(total - legs) < 0.01);
  assert.ok(Math.abs(total - 400) < 10, `about 400 m, got ${total}`);
  assert.equal(lineLeft(line, { i: 1, t: 1 }), 0);
});

test("nearestOnLine: halfway the first leg, on the line", () => {
  const n = nearestOnLine({ lat: 51.0509, lon: 3.7200 }, line);
  assert.equal(n.i, 0);
  assert.ok(Math.abs(n.t - 0.5) < 0.01);
  assert.ok(n.off < 1);
  assert.ok(Math.abs(lineLeft(line, n) - (total - 100)) < 3);
});

test("nearestOnLine: 70 m beside the second leg counts as off the route", () => {
  const n = nearestOnLine({ lat: 51.0518 + 70 / 111320, lon: 3.7215 }, line);
  assert.equal(n.i, 1);
  assert.ok(Math.abs(n.off - 70) < 2, `about 70 m off, got ${n.off}`);
});
