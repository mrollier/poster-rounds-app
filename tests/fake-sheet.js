// The real backend/Code.gs, run against an in-memory fake of the Google Sheet filled from the seed CSVs in
// data/. Used by the backend tests and the local mock server. Nothing is saved: a new fake = fresh seed data.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { parseCSV, DATA } from "./csv.js";

// The tabs the backend writes to start with just their header row (as in a new sheet).
const EMPTY_TABS = {
  Log: ["at", "campaign_id", "place_id", "cycle", "action", "status", "posters", "note", "by"],
  Swipes: ["swipe_id", "at", "by", "campaign_id", "deck_version", "round", "left_id", "right_id", "outcome", "undo_of"],
  Overrides: ["campaign_id", "place_id", "stars", "by", "at"],
  Scores: ["set_id", "place_id", "score", "source", "rater", "n", "updated_at"],
  Sets: ["set_id", "event", "t3", "t2", "t1", "made_by", "made_at", "note"],
};

// Returns {tabs, get(params), post(body)}: tabs = {Places: [[header…], [row…], …], …}, get/post = the
// backend's answer as an object (what the app receives as JSON).
export function fakeBackend() {
  const tabs = Object.fromEntries(["Places", "Campaigns", "Results", "Cities", "Types"].map(t =>
    [t, parseCSV(fs.readFileSync(path.join(DATA, t.toLowerCase() + ".csv"), "utf8"))]));
  for (const [t, head] of Object.entries(EMPTY_TABS)) tabs[t] = [head];

  // Just the parts of SpreadsheetApp that Code.gs uses, with the same shapes (display values are strings).
  const sheet = name => tabs[name] && {
    getDataRange: () => ({ getDisplayValues: () => tabs[name].map(r => r.map(String)) }),
    getLastColumn: () => tabs[name][0].length,
    getLastRow: () => tabs[name].length,
    getRange: (r, c, nr, nc) => ({
      getDisplayValues: () => tabs[name].slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc).map(String)),
      setValues: v => { tabs[name][r - 1] = v[0].map(String); },
    }),
    appendRow: row => tabs[name].push(row.map(String)),
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: sheet }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }), MimeType: { JSON: "json" } },
    Utilities: { formatDate: d => d.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-") },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, "..", "backend", "Code.gs"), "utf8"), ctx);
  return {
    tabs,
    get: params => ctx.doGet({ parameter: params }),
    post: body => ctx.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }),
  };
}
