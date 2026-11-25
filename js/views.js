// HTML for the next-stop card, the list rows and the pin popups. Only builds strings; app.js wires the buttons.
// A "stop" here is {place, prio, type: {label, color}, res} where res is the latest result row (or null).
// Buttons carry data-act="posted|nope|undo|note" and data-id="<place_id>"; one click handler serves them all.
import { esc } from "./map.js";
import { isDone, FAILED, STATUS_LABEL, gmapsUrl } from "./logic.js";

const statusOf = s => s.res?.status || "";
const plural = (n, word) => `${n} ${word}${+n === 1 ? "" : "s"}`;
const accessText = p => (p.access === "ask" ? "ask first" : "hang freely");
const clock = iso => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const btn = (act, id, label, cls = "") => `<button type="button" class="${cls}" data-act="${act}" data-id="${esc(id)}">${label}</button>`;

// Pin colour: the type's colour while to do; grey when posted; red when it failed (refused, full, …).
export function pinOf(s, label) {
  const st = statusOf(s);
  return {
    lat: +s.place.lat, lon: +s.place.lon, label, title: s.place.name,
    color: FAILED.includes(st) ? "#b00020" : isDone(st) ? "#8a8a8a" : s.type.color,
    cls: isDone(st) ? "faded" : st === "later" ? "later" : "",
    z: isDone(st) ? -1000 : (4 - s.prio) * 100,
    popup: popupHtml(s),
  };
}

// "Posted 2 · Thomas 14:05", plus the note, for a stop that has a result.
function resultLine(s) {
  const r = s.res;
  if (!r || (!r.status && !r.note)) return "";
  const what = r.status === "posted" ? `Posted ${r.posters}` : STATUS_LABEL[r.status] || "No result yet";
  const who = r.pending ? "waiting to sync" : `${esc(r.by)} ${clock(r.at)}`;
  return `<div class="res ${FAILED.includes(r.status) ? "bad" : ""}">${what} · ${who}</div>
    ${r.note ? `<div class="own-note">${esc(r.note)}</div>` : ""}`;
}

function popupHtml(s) {
  const p = s.place, st = statusOf(s);
  return `<div class="pop"><b>${esc(p.name)}</b><br>${esc(p.address)}<br>
    ${esc(s.type.label)} · priority ${s.prio}<br>${plural(p.posters, "poster")}, ${accessText(p)}
    ${resultLine(s)}
    <div class="pop-btns">${isDone(st)
      ? btn("undo", p.place_id, "Undo ↺", "popbtn alt")
      : btn("posted", p.place_id, "Posted ✓", "popbtn") + btn("nope", p.place_id, "Not possible ✗", "popbtn alt")}
      <a class="popbtn alt" href="${gmapsUrl(p)}" target="_blank" rel="noopener">Navigate</a></div></div>`;
}

// The big yellow card at the bottom: the stop to do now.
export function nextCardHtml(s, heading) {
  if (!s) return `<div class="next finished"><b>Nothing left to do with these filters.</b></div>`;
  const p = s.place;
  return `<div class="next">
    <div class="next-head">${esc(heading)}${statusOf(s) === "later" ? " (come back later)" : ""}</div>
    <div class="what">${esc(p.name)}</div>
    <div class="addr">${esc(p.address)} · ${plural(p.posters, "poster")} ·
      <span class="${p.access === "ask" ? "ask" : ""}">${accessText(p)}</span></div>
    ${p.notes ? `<div class="stop-notes">${esc(p.notes)}</div>` : ""}
    <a class="go" href="${gmapsUrl(p)}" target="_blank" rel="noopener">Navigate</a>
    <div class="go-row">${btn("posted", p.place_id, "Posted ✓", "go posted")}${btn("nope", p.place_id, "Not possible ✗", "go nope")}</div>
  </div>`;
}

// One row of the list: badge, name, details, result, and the result menu / note / undo.
export function rowHtml(s, label) {
  const p = s.place, st = statusOf(s);
  const cls = st === "posted" ? "is-done" : FAILED.includes(st) ? "is-done is-failed" : st === "later" ? "is-later" : "";
  const options = [["", "No result yet"], ...Object.entries(STATUS_LABEL)]
    .map(([k, l]) => `<option value="${k}" ${k === st ? "selected" : ""}>${l}</option>`).join("");
  return `<li class="${cls}">
    <div class="badge" style="background:${s.type.color}">${esc(label)}</div>
    <div>
      <div class="stop-name">${esc(p.name)}</div>
      <div class="stop-meta">${esc(p.address)} · ${plural(p.posters, "poster")} ·
        <span class="${p.access === "ask" ? "ask" : ""}">${accessText(p)}</span></div>
      ${p.notes ? `<div class="stop-notes">${esc(p.notes)}</div>` : ""}
      ${resultLine(s)}
      <div class="acts">
        <select data-act="status" data-id="${esc(p.place_id)}" aria-label="Result for ${esc(p.name)}">${options}</select>
        ${btn("note", p.place_id, s.res?.note ? "Edit note" : "Add note")}
        ${st ? btn("undo", p.place_id, "Undo ↺", "undo") : ""}
        <a href="${gmapsUrl(p)}" target="_blank" rel="noopener">Directions</a>
      </div>
    </div>
  </li>`;
}

export function statsHtml({ done, total, hung, planned }) {
  return [[`${done}/${total}`, "stops done"], [`${hung}/${planned}`, "posters hung"]]
    .map(([b, t]) => `<div><b>${b}</b><small>${t}</small></div>`).join("");
}
