// A small CSV reader for the seed files in data/ (tests, the mock server) and for sheet exports
// (tools/fit-set.mjs).
import fs from "node:fs";
import path from "node:path";

export const DATA = path.join(import.meta.dirname, "..", "data");

// Returns rows as arrays of strings. Quoted fields may hold commas, line breaks and doubled quotes ("");
// blank lines are skipped. (What Google Sheets' "Download as CSV" produces.)
export function parseCSV(text) {
  const rows = [];
  let row = [], cur = "", quoted = false;
  const endRow = () => { row.push(cur); if (row.length > 1 || row[0] !== "") rows.push(row); row = []; cur = ""; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (text[i + 1] === '"') { cur += '"'; i++; } // "" inside quotes is one quote
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") endRow();
    else if (ch !== "\r") cur += ch;
  }
  endRow();
  return rows;
}

// One tab as a list of objects keyed by the header row, like the backend's rows_().
export function readTab(name) {
  const [head, ...rows] = parseCSV(fs.readFileSync(path.join(DATA, name + ".csv"), "utf8"));
  return rows.map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
}
