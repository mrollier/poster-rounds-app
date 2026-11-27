// Local dev server: serves the app and a fake backend at /exec that runs the real backend/Code.gs
// against an in-memory copy of the seed CSVs. Nothing is saved: restart = fresh seed data.
//
//   node tests/mock-server.js        → http://localhost:8787   (codes: secret = volunteer, admin-secret = admin)
//
// config.js points the app at /exec when it runs on a port from 8787 to 8799 (PORT=8791 node tests/mock-server.js).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { parseCSV, DATA } from "./csv.js";

const ROOT = path.join(import.meta.dirname, "..");
const PORT = Number(process.env.PORT) || 8787; // 8787–8799: config.js then uses this mock

// Fake Google Sheet: each tab is an array of rows (header first), same shape getDisplayValues() returns.
const tabs = Object.fromEntries(["Places", "Campaigns", "Results", "Cities", "Types"].map(t =>
  [t, parseCSV(fs.readFileSync(path.join(DATA, t.toLowerCase() + ".csv"), "utf8"))]));
tabs.Log = [["at", "campaign_id", "place_id", "cycle", "action", "status", "posters", "note", "by"]];
tabs.Swipes = [["swipe_id", "at", "by", "campaign_id", "deck_version", "round", "left_id", "right_id", "outcome", "undo_of"]];
tabs.Overrides = [["campaign_id", "place_id", "stars", "by", "at"]];
tabs.Scores = [["set_id", "place_id", "score", "source", "rater", "n", "updated_at"]];
tabs.Sets = [["set_id", "event", "t3", "t2", "t1", "made_by", "made_at", "note"]];
const sheet = name => tabs[name] && {
  getDataRange: () => ({ getDisplayValues: () => tabs[name].map(r => r.map(String)) }),
  getLastColumn: () => tabs[name][0].length,
  getRange: (r, c, nr, nc) => ({
    getDisplayValues: () => tabs[name].slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc).map(String)),
    setValues: v => { tabs[name][r - 1] = v[0].map(String); },
  }),
  appendRow: row => tabs[name].push(row.map(String)),
};
let reply = null;
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: sheet }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: s => ({ setMimeType() { reply = s; } }), MimeType: { JSON: "json" } },
  Utilities: { formatDate: d => d.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-") },
  console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "backend", "Code.gs"), "utf8"), ctx);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".csv": "text/csv" };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/exec") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      // MOCK_DELAY=2000 node tests/mock-server.js → every backend call takes 2 s, like bad mobile data.
      setTimeout(() => {
        if (req.method === "POST") ctx.doPost({ postData: { contents: body } });
        else ctx.doGet({ parameter: Object.fromEntries(url.searchParams) });
        res.writeHead(200, { "Content-Type": "application/json" }).end(reply);
      }, Number(process.env.MOCK_DELAY) || 0);
    });
    return;
  }
  const file = path.join(ROOT, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""));
  const target = file.endsWith(path.sep) ? path.join(file, "index.html") : file;
  if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404).end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
}).listen(PORT, () => console.log(`Mock backend + app on http://localhost:${PORT} (codes: secret, admin-secret)`));
