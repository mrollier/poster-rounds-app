// Keeping results in sync between phones: merging what the server sends, and a queue of our own writes
// that survives going offline (and closing the app). Pure logic, no DOM: tested in tests/sync.test.js.
import { resultKey } from "./logic.js";

// Merge result rows from the server into `map` (key -> row). Last write wins, by the row's `at` time.
// Returns true if anything changed. (Times are compared as dates: the sheet has both "+00:00" and "Z" forms.)
export function mergeResults(map, rows) {
  let changed = false;
  for (const row of rows) {
    const key = resultKey(row), old = map[key], was = Date.parse(old?.at);
    // A row whose time can't be read (typed by hand in the sheet) must not block every later change.
    if (!old || Number.isNaN(was) || Date.parse(row.at) >= was) {
      if (!old || JSON.stringify(old) !== JSON.stringify(row)) changed = true;
      map[key] = row;
    }
  }
  return changed;
}

// What the screen should show: the server's rows with our not-yet-sent writes laid on top, in order.
// A write only carries the fields it changes (like the backend's upsert), so the rest are kept.
export function withPending(map, items, myName) {
  const out = { ...map };
  for (const { body, at } of items) {
    if (body.action && body.action !== "result") continue; // swipes, overrides and new places wait in the same outbox
    const key = resultKey(body), base = out[key] || { campaign_id: body.campaign_id, place_id: body.place_id,
      cycle: body.cycle || "", status: "", posters: 0, note: "" };
    const patch = Object.fromEntries(["status", "posters", "note"].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
    out[key] = { ...base, ...patch, by: myName, at, pending: true };
  }
  return out;
}

// The outbox. Writes are sent one at a time, oldest first, so the sheet ends up in the order you tapped.
//   load()/save(items)  keep the list on the phone
//   send(body)          posts one write; throws {offline: true} when there is no connection,
//                       {stop: true} when sending makes no sense now (e.g. a wrong code), else a refusal
//   onSent(item, reply) / onRefused(item, error)
export function createQueue({ load, save, send, onSent, onRefused }) {
  let items = load() || [];
  let busy = false;
  return {
    get items() { return items; },
    add(body, at = new Date().toISOString()) {
      items.push({ body, at });
      save(items);
    },
    // Returns "done" (all sent), "offline" / "stopped" (try again later) or "busy" (already sending).
    async flush() {
      if (busy) return "busy";
      busy = true;
      try {
        while (items.length) {
          const item = items[0];
          let reply;
          try {
            reply = await send(item.body);
          } catch (e) {
            if (e.offline) return "offline";
            if (e.stop) return "stopped";
            items = items.slice(1); save(items); // the server refused this one: it will never succeed
            onRefused(item, e);
            continue;
          }
          items = items.slice(1); save(items);
          onSent(item, reply);
        }
        return "done";
      } finally {
        busy = false;
      }
    },
  };
}
