// In-app navigation to one place: the route line from where you are, and how far and how long it still is.
// Kept simple on purpose: no turn-by-turn instructions (the card has a small Google Maps link for those).
//   - a new route when you leave the line (more than 50 m off, twice in a row, at most every 20 s);
//   - "you're there" within 30 m;
//   - offline: a straight dashed line, and the straight distance × 1.3.
import { route } from "./router.js";
import { hav, dist, minutes, nearestOnLine, lineLeft } from "./geo.js";
import { drawNavLine } from "./map.js";

const OFF_ROUTE = 50, ARRIVED = 30, REROUTE_EVERY = 20000;

let nav = null;          // {dest: {lat, lon, name, id?}, travel, line, total, seconds, off, routedAt, pos, arrived}
let show = () => {};     // the app's banner: show(state) or show(null)

export const navigating = () => !!nav;
export const navTarget = () => nav?.dest || null;
export function onNavChange(fn) { show = fn; }

export function startNav(dest, travel, pos) {
  nav = { dest, travel, line: null, total: 0, seconds: 0, off: 0, routedAt: 0, pos: null, arrived: false };
  drawNavLine(null);
  navUpdate(pos);
}

export function stopNav() {
  nav = null;
  drawNavLine(null);
  show(null);
}

async function reroute() {
  const n = nav;
  n.routedAt = Date.now();
  n.off = 0;
  const r = await route([n.pos, n.dest], n.travel);
  if (nav !== n) return; // stopped (or another destination) while the route was on its way
  n.line = r?.coords || null;
  n.seconds = r?.seconds || 0;
  n.total = n.line ? lineLeft(n.line, { i: 0, t: 0 }) : 0;
  drawNavLine(n.line || [[n.pos.lat, n.pos.lon], [+n.dest.lat, +n.dest.lon]], !n.line);
  navUpdate(n.pos);
}

// Every new GPS position comes here.
export function navUpdate(pos) {
  const n = nav;
  if (!n) return;
  if (!pos) return show({ name: n.dest.name, waiting: true });
  n.pos = pos;
  if (hav(pos, n.dest) < ARRIVED) n.arrived = true;
  const late = Date.now() - n.routedAt > REROUTE_EVERY;
  if (!n.routedAt || (!n.line && late)) { reroute(); } // first route, or offline before: try again
  let metres, mins;
  if (n.line) {
    const near = nearestOnLine(pos, n.line);
    n.off = near.off > OFF_ROUTE ? n.off + 1 : 0;
    if (n.off >= 2 && late && !n.arrived) reroute(); // wandered off the route: a new one from here
    metres = lineLeft(n.line, near);
    mins = n.total ? (n.seconds / 60) * (metres / n.total) : minutes(metres, n.travel);
  } else {
    metres = dist(pos, n.dest);
    mins = minutes(metres, n.travel);
  }
  show({ name: n.dest.name, id: n.dest.id, metres, mins, arrived: n.arrived });
}
