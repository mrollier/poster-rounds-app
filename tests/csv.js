// Tiny CSV reader for the seed files in data/ (tests and the mock server only).
import fs from "node:fs";
import path from "node:path";

export const DATA = path.join(import.meta.dirname, "..", "data");

// Returns rows as arrays of strings. Handles quoted fields with commas; the seed has no embedded newlines.
export function parseCSV(text) {
  return text.trim().split(/\r?\n/).map(line => {
    const row = []; let cur = "", quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { row.push(cur); cur = ""; }
      else cur += ch;
    }
    row.push(cur);
    return row;
  });
}

// One tab as a list of objects keyed by the header row, like the backend's rows_().
export function readTab(name) {
  const [head, ...rows] = parseCSV(fs.readFileSync(path.join(DATA, name + ".csv"), "utf8"));
  return rows.map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
}
