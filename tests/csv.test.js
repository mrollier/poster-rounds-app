import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV } from "./csv.js";

// tools/fit-set.mjs reads exports of the live sheet: a note can hold commas, quotes and line breaks.
test("parseCSV: quoted commas, doubled quotes, line breaks inside quotes, CRLF, blank lines", () => {
  const text = 'id,note\r\nA1,"Ask at the desk, then ""Room 2"""\r\nA2,"two\nlines"\n\nA3,plain\n';
  assert.deepEqual(parseCSV(text), [["id", "note"], ["A1", 'Ask at the desk, then "Room 2"'], ["A2", "two\nlines"], ["A3", "plain"]]);
  assert.deepEqual(parseCSV("a,,b\n"), [["a", "", "b"]]); // an empty field stays
});
