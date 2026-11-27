// Pure business rules: no DOM, no network, no localStorage. Everything here is unit-tested in tests/.
import { hav } from "./geo.js";
import { starsFromScore } from "./rank.js";

// ---------- Importance stars and event types (spec §2.1) ----------

// The Types tab has one column per kind of event, e.g. "ev:Music", with a weight 0–3 per type of place:
// how well that type of place reaches the audience of that kind of event. 0 = not in that event's preset.
export const eventTypes = types => Object.keys(types[0] || {}).filter(k => k.startsWith("ev:")).map(k => k.slice(3));
export const eventWeights = (types, ev) => Object.fromEntries(types.map(t => [t.type, Number(t["ev:" + ev]) || 0]));

// Stars (1–3) for a place at this kind of event. Audience first:
//   - the type's weight for this event (0–3) sets the stars: does this kind of place reach the people who'd come?
//   - the place's own importance (1–3) only says whether MANY people pass by. A quiet spot (importance 1)
//     loses one star; a busy spot of the wrong kind still stays low.
// A type outside the preset (weight 0) that you tick by hand in Filters counts as weight 1.
// 0 stars only for a place without importance: it stays hidden.
export function stars(place, weights) {
  const imp = Math.round(Number(place.importance)) || 0;
  if (imp < 1) return 0;
  const fit = Math.min(3, Math.max(1, Number(weights[place.type]) || 0));
  return imp === 1 && fit > 1 ? fit - 1 : fit;
}
export const starText = n => "★".repeat(n) + "☆".repeat(3 - n);

// The stars a place shows, in order of what wins:
//   1. an admin's override for this campaign (overrides: {place_id: 0–3});
//   2. a learned set (set: {t3, t2, t1, scores}): the place's score against the 3/2/1-star lines (see
//      js/rank.js); a place without a score (added later) gets the average of similar places (fillScore);
//   3. otherwise today's rule from the type's weight and the place's importance (stars above).
export function placeStars(place, { set = null, overrides = {}, weights = {}, places = [] } = {}) {
  if (overrides && overrides[place.place_id] !== undefined) return overrides[place.place_id];
  if (set) return starsFromScore(set.scores[place.place_id] ?? fillScore(place, set, places), set);
  return stars(place, weights);
}

// A score for a place the set doesn't know yet: the average score of places of the same type and
// importance, else of the same type, else the 1★ line.
export function fillScore(place, set, places) {
  const avgOf = list => { const xs = list.map(p => set.scores[p.place_id]).filter(x => x !== undefined);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const sameType = places.filter(p => p.type === place.type);
  return avgOf(sameType.filter(p => Math.round(+p.importance) === Math.round(+place.importance))) ?? avgOf(sameType) ?? set.t1;
}

// ---------- Board cleaning cycles (spec §2.2) ----------

// Today's date in Ghent as "YYYY-MM-DD", whatever time zone the phone is set to.
// The en-CA locale happens to format dates as YYYY-MM-DD.
export const brusselsToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(now);

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// The date of the most recent cleaning day on or before `today`, or "" if boards are never cleaned.
// rule: "nth-weekday FRI 1,3" = 1st and 3rd Friday of each month; "none" (or empty) = never.
// Dates are handled in UTC on purpose: they are calendar days, so no daylight-saving surprises.
export function cycleStart(rule, today) {
  const m = /^nth-weekday\s+([A-Z]{3})\s+([\d,]+)$/i.exec(String(rule || "").trim());
  if (!m) return "";
  const weekday = WEEKDAYS.indexOf(m[1].toUpperCase());
  const nths = m[2].split(",").map(Number);
  const [y, mo, d] = today.split("-").map(Number);
  for (let back = 0; back < 40; back++) {
    const day = new Date(Date.UTC(y, mo - 1, d - back));
    // the 1st Friday falls on day 1–7, the 2nd on 8–14, …: so "nth" = ceil(day of month / 7)
    if (day.getUTCDay() === weekday && nths.includes(Math.ceil(day.getUTCDate() / 7))) {
      return day.toISOString().slice(0, 10);
    }
  }
  return today; // rule never matches (e.g. "5th" only): treat today as the start
}

// ---------- Results (spec §2.3) ----------

export const STATUS_LABEL = {
  posted: "Posted", nope: "Not possible here", refused: "Refused", full: "Board full",
  closed: "Closed", later: "Come back later",
};
export const FAILED = ["nope", "refused", "full", "closed"];

// A stop is done for anything but "" (no result) and "later" (come back later).
export const isDone = status => !!status && status !== "later";
// A stop's result status ("" when nothing is saved yet). Stops: {place, stars, type, res}.
export const statusOf = s => s.res?.status || "";

// Text from the sheet goes into HTML only through this, so a name like "<b>" can't break the page.
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// City boards are cleaned, so their result is per cleaning cycle; everything else per campaign ("").
export const cycleFor = (place, boardCycle) => (place.type === "boards" ? boardCycle : "");

export const resultKey = r => `${r.campaign_id}|${r.place_id}|${r.cycle || ""}`;

// ---------- Google Maps links (spec §4.9) ----------

const GMODE = { bike: "bicycling", walk: "walking" };

// Where to send Google Maps: places matched to the official address register navigate by address
// (Google finds the entrance); hand-placed or approximate pins navigate to the exact pin.
// A plain {lat, lon} point (home, my position, a bike spot) always goes by coordinates.
export function navTarget(p) {
  if (p.location_source === "basisregisters" && p.address) return `${p.address}, ${p.city}, Belgium`;
  return `${p.lat},${p.lon}`;
}

// The place itself in Google Maps (its card, with Directions there if you want them).
export const gmapsPlaceUrl = p => "https://www.google.com/maps/search/?" + new URLSearchParams({ api: "1", query: navTarget(p) });

// One directions link (for a trip of several stops). Without an origin, Google Maps starts from where the phone is.
export function gmapsUrl(dest, { origin = null, waypoints = [], mode = "bike" } = {}) {
  const q = new URLSearchParams({ api: "1", destination: navTarget(dest), travelmode: GMODE[mode] || mode });
  if (origin) q.set("origin", navTarget(origin));
  if (waypoints.length) q.set("waypoints", waypoints.map(navTarget).join("|"));
  return "https://www.google.com/maps/dir/?" + q;
}

// Phones' Google Maps takes at most 3 waypoints + a destination per link, so longer trips are cut into
// parts of 4. The first part starts wherever the phone is; each next part starts at the previous end.
// Returns [{from, to, url}] with from/to as 1-based positions in `targets`.
export function chunkLinks(targets, mode, per = 4) {
  const out = [];
  for (let i = 0; i < targets.length; i += per) {
    const part = targets.slice(i, i + per);
    out.push({ from: i + 1, to: i + part.length,
      url: gmapsUrl(part[part.length - 1], { origin: i ? targets[i - 1] : null, waypoints: part.slice(0, -1), mode }) });
  }
  return out;
}

// ---------- Cleaning what comes from the sheet ----------

// The sheet is typed by hand, so expect "51,05" (a Belgian decimal comma), spaces, "Boards" for "boards",
// a colour like "red\"><img …" and copied rows. cleanBoot fixes what it safely can and leaves out the
// rest, so one bad row can't break the map for everyone. Returns {boot, skipped: [reasons]}.
export const num = v => Number(String(v ?? "").trim().replace(",", "."));
const COLOUR = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export function cleanBoot(boot) {
  const skipped = [];
  const types = boot.types.map(t => ({ ...t, type: String(t.type).trim(), color: COLOUR.test(String(t.color).trim()) ? String(t.color).trim() : "#444" }));
  const typeKey = Object.fromEntries(types.map(t => [t.type.toLowerCase(), t.type]));
  let places = boot.places.map(p => ({ ...p, lat: num(p.lat), lon: num(p.lon),
    type: typeKey[String(p.type).trim().toLowerCase()] || String(p.type).trim(),
    importance: Math.round(num(p.importance)) || 0, posters: Math.max(1, parseInt(p.posters, 10) || 1) }));
  // A position that isn't a number, is 0,0, or lies far (50 km) from where most places are: left out.
  const ok = p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && (p.lat || p.lon);
  const mid = { lat: median(places.filter(ok).map(p => p.lat)), lon: median(places.filter(ok).map(p => p.lon)) };
  const seen = new Set();
  places = places.filter(p => {
    const why = !ok(p) ? "no valid lat/lon" : hav(p, mid) > 50000 ? "lat/lon far from the other places"
      : seen.has(p.place_id) ? "duplicate place_id" : "";
    seen.add(p.place_id);
    if (why) skipped.push(`${p.place_id} ${p.name}: ${why}`);
    return !why;
  });
  return { boot: { ...boot, types, places }, skipped };
}
