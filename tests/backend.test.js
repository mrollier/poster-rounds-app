// backend/Code.gs against a fake of the Google Sheet (tests/fake-sheet.js). The tests share one fake and
// run in order: later ones build on what earlier ones wrote.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeBackend } from "./fake-sheet.js";

const { tabs, get, post } = fakeBackend();
const C = "2026-12-ai-safety-lecture", A = "admin-secret";

test("codes: one campaign and one role per code; codes never come back", () => {
  assert.deepEqual(get({ action: "ping" }), { ok: true });
  assert.equal(get({ action: "bootstrap", code: "wrong" }).error, "wrong code");
  const boot = get({ action: "bootstrap", code: " secret " }); // stray spaces from a phone keyboard
  assert.equal(boot.places.length, 198); assert.equal(boot.results.length, 35); assert.equal(boot.campaign_id, C);
  assert.equal(boot.role, "volunteer");
  assert.equal(get({ action: "bootstrap", code: A }).role, "admin");
  assert.ok(boot.campaigns.every(c => !("admin_code" in c) && !("volunteer_code" in c)), "codes leaked");
  assert.ok(boot.names.length > 0 && boot.names.every(n => !/^Claude/.test(n)), JSON.stringify(boot.names));
  assert.equal(get({ action: "bootstrap", code: "Secret" }).error, "wrong code"); // case-sensitive
});

test("codes: a closed campaign, and a sheet without code columns", () => {
  const hd = tabs.Campaigns[0], saved = tabs.Campaigns.map(r => r.slice());
  const closed = tabs.Campaigns[1].slice();
  closed[hd.indexOf("campaign_id")] = "old-campaign"; closed[hd.indexOf("active")] = "FALSE";
  closed[hd.indexOf("admin_code")] = "old-admin"; closed[hd.indexOf("volunteer_code")] = "old-vol";
  tabs.Campaigns.push(closed);
  assert.equal(get({ action: "bootstrap", code: "old-vol" }).error, "campaign closed");
  // Without the code columns nobody gets in (and certainly not with the code "undefined").
  const ai = hd.indexOf("admin_code");
  tabs.Campaigns = saved.map(r => r.filter((_, j) => j < ai));
  assert.equal(get({ action: "bootstrap", code: "undefined" }).error, "wrong code");
  tabs.Campaigns = saved;
});

test("results: upsert, merge, undo, formulas neutralised, the Log in its own column order", () => {
  let r = post({ code: "secret", name: "Test", action: "result", campaign_id: C, place_id: "T06", cycle: "", status: "posted", posters: 2 });
  assert.ok(r.ok, JSON.stringify(r));
  r = post({ code: "secret", name: "Test", action: "result", campaign_id: C, place_id: "T06", cycle: "", note: '=HYPERLINK("x")' });
  assert.equal(r.result.status, "posted"); assert.equal(r.result.note[0], "'"); // note merged, formula neutralised
  r = post({ code: "secret", name: "Test", action: "result", campaign_id: C, place_id: " T06 ", cycle: "", status: "" });
  assert.equal(r.result.status, ""); // undo (and stray spaces around the id are fine)
  assert.equal(tabs.Results.filter(x => x[1] === "T06").length, 1); // upsert, not a duplicate
  const log = tabs.Log, last = log.at(-1), col = k => log[0].indexOf(k);
  assert.equal(last[col("action")], "undo"); assert.equal(last[col("place_id")], "T06"); assert.equal(last[col("by")], "Test");
});

test("results: a late offline tap doesn't overwrite a teammate's newer result", () => {
  const beforeEve = new Date(Date.now() - 5000).toISOString();
  post({ code: "secret", name: "Eve", action: "result", campaign_id: C, place_id: "T06", cycle: "", status: "posted", posters: 1 });
  let r = post({ code: "secret", name: "Dana", action: "result", campaign_id: C, place_id: "T06", cycle: "", status: "later", tapped_at: beforeEve });
  assert.ok(r.stale); assert.equal(r.result.status, "posted"); assert.equal(r.result.by, "Eve");
  r = post({ code: "secret", name: "Dana", action: "result", campaign_id: C, place_id: "T06", cycle: "", status: "", tapped_at: new Date(Date.now() + 1000).toISOString() });
  assert.ok(!r.stale); assert.equal(r.result.status, ""); // a newer tap still wins
});

test("writes: refused for unknown places and bad values; always in the code's campaign", () => {
  assert.equal(post({ code: "secret", name: "Test", action: "result", place_id: "NOPE", cycle: "", status: "posted" }).error, "unknown place");
  assert.equal(post({ code: "secret", name: "Test", action: "result", place_id: "B19", cycle: "2026-12-04", status: "weird" }).error, "bad status");
  assert.equal(post({ code: "secret", name: "", action: "result", place_id: "T06" }).error, "name missing");
  assert.equal(post("x".repeat(6000)).error, "request too large");
  const r = post({ code: "secret", name: "Test", action: "result", campaign_id: "other", place_id: "T07", cycle: "", status: "posted", posters: 1 });
  assert.equal(r.result.campaign_id, C);
  assert.ok(get({ action: "results", code: "secret", since: new Date(Date.now() - 60000).toISOString() }).results.some(x => x.place_id === "T07"));
});

test("addPlace: a new place gets an id and shows up for everyone", () => {
  const r = post({ code: "secret", name: "Test", action: "addPlace", city: "Gent", place_name: "Café X", type: "stages", tags: "culture", lat: 51.05, lon: 3.72, location_source: "gps" });
  assert.ok(r.ok, JSON.stringify(r)); assert.ok(r.place.place_id.startsWith("X-"));
  assert.equal(get({ action: "bootstrap", code: "secret" }).places.length, 199);
  assert.equal(tabs.Log.at(-1)[tabs.Log[0].indexOf("campaign_id")], C);
});

test("swipes and overrides: admins only, checked, appended", () => {
  assert.equal(post({ code: "secret", name: "Vol", action: "swipe", left_id: "T06", right_id: "T07", outcome: "left" }).error, "admin only");
  const r = post({ code: A, name: "Ann", action: "swipe", deck_version: "v1", round: 1, left_id: "T06", right_id: "T07", outcome: "left" });
  assert.ok(r.ok && r.swipe_id, JSON.stringify(r));
  const sw = tabs.Swipes.at(-1), sh = tabs.Swipes[0];
  assert.equal(sw[sh.indexOf("campaign_id")], C); assert.equal(sw[sh.indexOf("by")], "Ann"); assert.equal(sw[sh.indexOf("outcome")], "left");
  assert.equal(post({ code: A, name: "Ann", action: "swipe", left_id: "T06", right_id: "T07", outcome: "maybe" }).error, "bad outcome");
  for (const outcome of ["both_high", "both_mid", "both_low"]) assert.ok(post({ code: A, name: "Ann", action: "swipe", deck_version: "v1", round: 1, left_id: "T06", right_id: "T07", outcome }).ok, outcome);
  assert.equal(post({ code: A, name: "Ann", action: "swipe", left_id: "T06", right_id: "NOPE", outcome: "left" }).error, "unknown place");
  assert.ok(post({ code: A, name: "Ann", action: "swipe", left_id: "T06", right_id: "T07", outcome: "undo", undo_of: r.swipe_id }).ok);
  assert.equal(post({ code: "secret", name: "Vol", action: "override", place_id: "T06", stars: 3 }).error, "admin only");
  assert.ok(post({ code: A, name: "Ann", action: "override", place_id: "T06", stars: 3 }).ok);
  assert.ok(post({ code: A, name: "Ann", action: "override", place_id: "T06", stars: 1 }).ok);
  assert.ok(post({ code: A, name: "Ann", action: "override", place_id: "T07", stars: 2 }).ok);
  assert.ok(post({ code: A, name: "Ann", action: "override", place_id: "T07", stars: "" }).ok); // cleared
  assert.equal(post({ code: A, name: "Ann", action: "override", place_id: "T06", stars: 7 }).error, "bad stars");
  assert.equal(post({ code: A, name: "Ann", action: "override", place_id: "NOPE", stars: 2 }).error, "unknown place");
  const bootA = get({ action: "bootstrap", code: A }), bootV = get({ action: "bootstrap", code: "secret" });
  assert.deepEqual(bootA.overrides, { T06: 1 }); // the latest wins; a cleared one is gone
  assert.equal(bootA.swipes.length, 5); assert.equal(bootV.swipes, undefined); // only admins get swipes
});

test("learned star sets: none yet → the rule; the event's default; the campaign's own set wins", () => {
  assert.equal(get({ action: "bootstrap", code: "secret" }).set, null);
  tabs.Sets.push(["default:AI Safety", "AI Safety", "2", "1", "0", "Claude", "2026-11-27", ""]);
  tabs.Scores.push(["default:AI Safety", "T06", "2.5", "predicted", "claude", "0", "2026-11-27"], ["default:AI Safety", "T07", "-1", "swiped", "bt", "5", "2026-11-27"]);
  assert.deepEqual(get({ action: "bootstrap", code: "secret" }).set, { set_id: "default:AI Safety", t3: 2, t2: 1, t1: 0, scores: { T06: 2.5, T07: -1 } });
  tabs.Sets.push([C, "AI Safety", "3", "2", "1", "Ann", "2026-11-28", "trained for the lecture"]);
  tabs.Scores.push([C, "T06", "0.5", "swiped", "bt", "4", "2026-11-28"]);
  assert.equal(get({ action: "bootstrap", code: "secret" }).set.set_id, C);
});
