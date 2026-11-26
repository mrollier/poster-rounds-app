// Pure business rules: no DOM, no network, no localStorage. Everything here is unit-tested in tests/.

// ---------- Importance stars and event types (spec §2.1) ----------

// The Types tab has one column per kind of event, e.g. "ev:Music", with a weight 0–3 per type of place:
// how well that type of place reaches the audience of that kind of event. 0 = not in that event's preset.
export const eventTypes = types => Object.keys(types[0] || {}).filter(k => k.startsWith("ev:")).map(k => k.slice(3));
export const eventWeights = (types, ev) => Object.fromEntries(types.map(t => [t.type, Number(t["ev:" + ev]) || 0]));

// Stars (1–3) for a place at this kind of event: the LOWER of two marks out of 3,
//   - the type's weight for this event (does this kind of place reach this audience?), and
//   - the place's own importance (is it a good spot: busy, visible, a real notice board?).
// So 3★ needs both: a great spot of the wrong kind (a music café for a poetry night) gets no more than its
// type's weight. A type outside the preset (weight 0) that you tick by hand in Filters counts as weight 1.
// 0 stars only for a place without importance: it stays hidden.
export function stars(place, weights) {
  const fit = Math.max(1, Number(weights[place.type]) || 0);
  return Math.max(0, Math.min(3, fit, Math.round(Number(place.importance)) || 0));
}
export const starText = n => "★".repeat(n) + "☆".repeat(3 - n);

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

// One directions link. Without an origin, Google Maps starts from where the phone is.
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
