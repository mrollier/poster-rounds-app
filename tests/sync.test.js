import test from "node:test";
import assert from "node:assert/strict";
import { mergeResults, withPending, createQueue } from "../js/sync.js";

const C = "camp";
const row = (place, status, at, by = "A") => ({ campaign_id: C, place_id: place, cycle: "", status, posters: 1, note: "", by, at });

test("mergeResults: last write wins, by time (mixed ISO formats)", () => {
  const map = {};
  assert.equal(mergeResults(map, [row("P1", "posted", "2026-11-25T10:00:00+00:00")]), true);
  // older row (written earlier) loses
  assert.equal(mergeResults(map, [row("P1", "nope", "2026-11-25T09:59:59.000Z")]), false);
  assert.equal(map[`${C}|P1|`].status, "posted");
  // newer row wins
  assert.equal(mergeResults(map, [row("P1", "", "2026-11-25T10:00:01.500Z", "B")]), true);
  assert.equal(map[`${C}|P1|`].status, "");
  // the same row again changes nothing (polling overlaps)
  assert.equal(mergeResults(map, [row("P1", "", "2026-11-25T10:00:01.500Z", "B")]), false);
});

test("mergeResults: board cycles are separate results", () => {
  const map = {};
  mergeResults(map, [{ ...row("B1", "posted", "2026-11-25T10:00:00Z"), cycle: "2026-11-20" },
                     { ...row("B1", "", "2026-12-05T10:00:00Z"), cycle: "2026-12-04" }]);
  assert.equal(Object.keys(map).length, 2);
});

test("withPending: our unsent writes show on top and keep untouched fields", () => {
  const map = { [`${C}|P1|`]: { ...row("P1", "posted", "2026-11-25T10:00:00Z"), note: "side door" } };
  const items = [
    { body: { campaign_id: C, place_id: "P1", cycle: "", status: "", posters: 0 }, at: "2026-11-25T11:00:00Z" },
    { body: { campaign_id: C, place_id: "P2", cycle: "", status: "nope", posters: 0, note: "closed" }, at: "2026-11-25T11:01:00Z" },
  ];
  const out = withPending(map, items, "Me");
  assert.equal(out[`${C}|P1|`].status, "");
  assert.equal(out[`${C}|P1|`].note, "side door");
  assert.equal(out[`${C}|P2|`].status, "nope");
  assert.equal(out[`${C}|P2|`].by, "Me");
  assert.equal(map[`${C}|P1|`].status, "posted"); // the server map itself is untouched
});

// A fake phone storage + a fake network that can be switched off.
function setup() {
  let saved = null, online = true;
  const sent = [], refused = [], acked = [];
  const q = createQueue({
    load: () => saved, save: items => { saved = items; },
    send: async body => {
      if (!online) throw Object.assign(new Error("offline"), { offline: true });
      if (body.place_id === "BAD") throw new Error("unknown place");
      sent.push(body.place_id); return { ok: true };
    },
    onSent: item => acked.push(item.body.place_id), onRefused: item => refused.push(item.body.place_id),
  });
  return { q, sent, refused, acked, setOnline: v => { online = v; }, saved: () => saved };
}

test("queue: offline keeps writes in order, then sends them all when back online", async () => {
  const s = setup();
  s.setOnline(false);
  s.q.add({ place_id: "P1" }); s.q.add({ place_id: "P2" }); s.q.add({ place_id: "P3" });
  assert.equal(await s.q.flush(), "offline");
  assert.equal(s.q.items.length, 3);
  assert.equal(s.saved().length, 3); // survives closing the app
  s.setOnline(true);
  assert.equal(await s.q.flush(), "done");
  assert.deepEqual(s.sent, ["P1", "P2", "P3"]);
  assert.equal(s.q.items.length, 0);
});

test("queue: a refused write is dropped, the rest still go", async () => {
  const s = setup();
  s.q.add({ place_id: "P1" }); s.q.add({ place_id: "BAD" }); s.q.add({ place_id: "P2" });
  assert.equal(await s.q.flush(), "done");
  assert.deepEqual(s.sent, ["P1", "P2"]);
  assert.deepEqual(s.refused, ["BAD"]);
});

test("queue: two flushes at once don't send twice", async () => {
  const s = setup();
  s.q.add({ place_id: "P1" });
  const [a, b] = await Promise.all([s.q.flush(), s.q.flush()]);
  assert.deepEqual([a, b].sort(), ["busy", "done"]);
  assert.deepEqual(s.sent, ["P1"]);
});

test("mergeResults: a row with an unreadable time (typed by hand) doesn't block later changes", () => {
  const map = { "c|p|": { campaign_id: "c", place_id: "p", cycle: "", status: "later", at: "26/11/2026 10:00" } };
  assert.equal(mergeResults(map, [{ campaign_id: "c", place_id: "p", cycle: "", status: "posted", at: "2026-11-26T11:00:00Z" }]), true);
  assert.equal(map["c|p|"].status, "posted");
});

test("withPending: only result writes show as results (not swipes, overrides or new places)", async () => {
  const { withPending } = await import("../js/sync.js");
  const items = [{ body: { action: "swipe", campaign_id: "c", left_id: "a", right_id: "b", outcome: "left" }, at: "2026-11-27T10:00:00Z" },
                 { body: { action: "addPlace", campaign_id: "c", place_name: "X" }, at: "2026-11-27T10:00:01Z" },
                 { body: { action: "result", campaign_id: "c", place_id: "p1", cycle: "", status: "posted" }, at: "2026-11-27T10:00:02Z" }];
  assert.deepEqual(Object.keys(withPending({}, items, "Me")), ["c|p1|"]);
});
