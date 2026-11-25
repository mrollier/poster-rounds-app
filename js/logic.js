// Pure business rules: no DOM, no network, no localStorage. Everything here is unit-tested in tests/.

// ---------- Priority (spec §2.1) ----------

// A place's tags are a space- (or comma-) separated list, e.g. "students-science entrepreneurs".
export const tagsOf = place => String(place.tags || "").split(/[\s,]+/).filter(Boolean);

// score = best (campaign weight of a tag × place importance). Unknown tags weigh 0.
export function priority(place, campaign) {
  const imp = Number(place.importance) || 0;
  const score = Math.max(0, ...tagsOf(place).map(tag => (Number(campaign["w:" + tag]) || 0) * imp));
  if (score >= 6) return 1;
  if (score >= 3) return 2;
  if (score >= 1) return 3;
  return 0; // 0 = not relevant for this campaign: hidden
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
