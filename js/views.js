// HTML for the next-stop card, the list rows and the pin popups. Only builds strings; app.js wires the buttons.
// A "stop" here is {place, stars, type: {label, color}, res} where res is the latest result row (or null).
// Buttons carry data-act="posted|nope|undo|note" and data-id="<place_id>"; one click handler serves them all.
import { esc } from "./map.js";
import { isDone, FAILED, STATUS_LABEL, gmapsUrl, starText } from "./logic.js";

const statusOf = s => s.res?.status || "";
const plural = (n, word) => `${esc(n)} ${word}${+n === 1 ? "" : "s"}`;
const accessText = p => (p.access === "ask" ? "ask first" : "hang freely");
const clock = iso => (Number.isNaN(Date.parse(iso)) ? "" : new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
// "★★☆", read out as "Importance 2 of 3".
const starsHtml = n => `<span class="stars" role="img" aria-label="Importance ${n} of 3">${starText(n)}</span>`;
const btn = (act, id, label, cls = "") => `<button type="button" class="${cls}" data-act="${act}" data-id="${esc(id)}">${label}</button>`;

// Pin colour: the type's colour while to do; grey when posted; red when it failed (refused, full, …).
export function pinOf(s, label, extraButtons = "") {
  const st = statusOf(s);
  return {
    lat: +s.place.lat, lon: +s.place.lon, label, title: s.place.name,
    color: FAILED.includes(st) ? "#b00020" : isDone(st) ? "#8a8a8a" : s.type.color,
    cls: isDone(st) ? "faded" : st === "later" ? "later" : "",
    z: isDone(st) ? -1000 : s.stars * 100,
    popup: popupHtml(s, extraButtons),
  };
}

// "Posted 2 · Thomas 14:05", plus the note, for a stop that has a result.
function resultLine(s) {
  const r = s.res;
  if (!r || (!r.status && !r.note)) return "";
  const what = r.status === "posted" ? `Posted ${esc(r.posters)}` : STATUS_LABEL[r.status] || "No result yet";
  const who = r.pending ? "waiting to sync" : `${esc(r.by)} ${clock(r.at)}`;
  return `<div class="res ${FAILED.includes(r.status) ? "bad" : ""}">${what} · ${who}</div>
    ${r.note ? `<div class="own-note">${esc(r.note)}</div>` : ""}`;
}

function popupHtml(s, extraButtons) {
  const p = s.place, st = statusOf(s);
  return `<div class="pop"><b>${esc(p.name)}</b><br>${esc(p.address)}<br>
    ${starsHtml(s.stars)} · ${esc(s.type.label)}<br>${plural(p.posters, "poster")}, ${accessText(p)}
    ${resultLine(s)}
    <div class="pop-btns">${isDone(st)
      ? btn("undo", p.place_id, "Undo ↺", "popbtn alt")
      : btn("posted", p.place_id, "Posted ✓", "popbtn") + btn("nope", p.place_id, "Can't ✗", "popbtn alt")}
      ${btn("nav", p.place_id, "Navigate", "popbtn alt")}${extraButtons}</div></div>`;
}

// The big yellow card at the bottom: the stop to do now. `finished`: {text, label, dest} when nothing is left
// (dest: where "label" navigates to, e.g. home).
export function nextCardHtml(s, heading, { travel = "bike", finished = null } = {}) {
  if (!s) {
    const f = finished || { text: "Nothing left to do with these filters." };
    return `<div class="next finished"><b>${esc(f.text)}</b>
      ${f.dest ? `<button type="button" class="go navgo" data-ui="nav-end">${esc(f.label)}</button>` : ""}</div>`;
  }
  const p = s.place;
  return `<div class="next">
    <div class="next-head">${esc(heading)}${statusOf(s) === "later" ? " (come back later)" : ""}</div>
    <div class="what">${esc(p.name)}</div>
    <div class="addr">${starsHtml(s.stars)} · ${esc(p.address)} · ${plural(p.posters, "poster")} ·
      <span class="${p.access === "ask" ? "ask" : ""}">${accessText(p)}</span></div>
    ${p.notes ? `<div class="stop-notes">${esc(p.notes)}</div>` : ""}
    ${resultLine(s) /* e.g. "Come back later · Thomas 14:05" and its note: why it was put off */}
    <div class="go-row">${btn("nav", p.place_id, "Navigate", "go navgo")}
      ${btn("posted", p.place_id, "Posted ✓", "go posted")}${btn("nope", p.place_id, "Can't ✗", "go nope")}</div>
    <a class="gmaps" href="${gmapsUrl(p, { mode: travel })}" target="_blank" rel="noopener">Google Maps ↗</a>
  </div>`;
}

// One row of the list: badge, name, details, result, and the result menu / note / undo.
export function rowHtml(s, label, eta = null, travel = "bike") {
  const p = s.place, st = statusOf(s);
  const cls = st === "posted" ? "is-done" : FAILED.includes(st) ? "is-done is-failed" : st === "later" ? "is-later" : "";
  const options = [["", "No result yet"], ...Object.entries(STATUS_LABEL)]
    .map(([k, l]) => `<option value="${k}" ${k === st ? "selected" : ""}>${l}</option>`).join("");
  return `<li class="${cls}">
    <div class="badge" style="background:${s.type.color}">${esc(label)}</div>
    <div>
      <div class="stop-name">${esc(p.name)}</div>
      <div class="stop-meta">${starsHtml(s.stars)} · ${esc(p.address)} · ${plural(p.posters, "poster")} ·
        <span class="${p.access === "ask" ? "ask" : ""}">${accessText(p)}</span></div>
      ${eta === null ? "" : `<div class="stop-meta">About ${eta} min from now</div>`}
      ${p.notes ? `<div class="stop-notes">${esc(p.notes)}</div>` : ""}
      ${resultLine(s)}
      <div class="acts">
        <select data-act="status" data-id="${esc(p.place_id)}" aria-label="Result for ${esc(p.name)}">${options}</select>
        ${btn("note", p.place_id, s.res?.note ? "Edit note" : "Add note")}
        ${st ? btn("undo", p.place_id, "Undo ↺", "undo") : ""}
        ${btn("nav", p.place_id, "Navigate")}
        <a href="${gmapsUrl(p, { mode: travel })}" target="_blank" rel="noopener">Google Maps ↗</a>
      </div>
    </div>
  </li>`;
}

// stats: [[big text, small text], …]
export const statsHtml = stats => stats.map(([b, t]) => `<div><b>${esc(b)}</b><small>${esc(t)}</small></div>`).join("");

// Segmented control (radio buttons that look like one bar of buttons). options: [[value, label]].
export const seg = (name, options, current) => options.map(([v, l]) =>
  `<label><input type="radio" name="${name}" value="${esc(v)}" ${String(v) === String(current) ? "checked" : ""}><span>${esc(l)}</span></label>`).join("");

// Google Maps links for a trip cut into parts. links: [{from, to, url}], `last` = label of the trip's end.
export function linksHtml(links, endLabel, total) {
  return links.map(l => {
    const toEnd = endLabel && l.to === total;
    const last = toEnd ? l.to - 1 : l.to; // the trip's end isn't a numbered stop
    const range = l.from === last ? `stop ${l.from}` : `stops ${l.from}–${last}`;
    const text = toEnd && l.from === l.to ? `Google Maps: ${endLabel}`
      : `Google Maps: ${range}${toEnd ? `, then ${endLabel}` : ""}`;
    return `<a class="btn" href="${l.url}" target="_blank" rel="noopener">${esc(text)}</a>`;
  }).join("");
}

// One zone in the zones list.
export function zoneRowHtml(z) {
  const left = z.total - z.done;
  return `<li class="${left ? "" : "is-done"}"><div class="badge square" style="background:${left ? "var(--brand)" : "#8a8a8a"}">${left || "✓"}</div>
    <div><div class="stop-name">${esc(z.name)}</div>
      <div class="stop-meta">${z.total > 1 ? `${left}/${z.total} stops to do · about ${z.mins} min`
        : `Single stop · ${esc(z.stops[0]?.place.address || "")}`}</div>
      <div class="acts"><button type="button" data-ui="zone-open" data-zone="${esc(z.id)}">Open</button></div></div></li>`;
}

// The list of types in the filter, with colour, count and a tick when included.
export const typesHtml = (types, counts, skip) => types.filter(t => counts[t.type]).map(t =>
  `<label><input type="checkbox" value="${esc(t.type)}" ${skip.has(t.type) ? "" : "checked"}>
    <span class="swatch" style="background:${esc(t.color)}"></span><span>${esc(t.label)} <small>${counts[t.type]}</small></span></label>`).join("");
