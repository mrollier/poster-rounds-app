// Local dev server: serves the app and a fake backend at /exec that runs the real backend/Code.gs
// against an in-memory copy of the seed CSVs. Nothing is saved: restart = fresh seed data.
//
//   node tests/mock-server.js        → http://localhost:8787   (codes: secret = volunteer, admin-secret = admin)
//
// config.js points the app at /exec when it runs on a port from 8787 to 8799 (PORT=8791 node tests/mock-server.js).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fakeBackend } from "./fake-sheet.js";

const ROOT = path.join(import.meta.dirname, "..");
const PORT = Number(process.env.PORT) || 8787; // 8787–8799: config.js then uses this mock
const backend = fakeBackend(); // the real Code.gs on an in-memory copy of the seed CSVs

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
        const reply = req.method === "POST" ? backend.post(body) : backend.get(Object.fromEntries(url.searchParams));
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(reply));
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
