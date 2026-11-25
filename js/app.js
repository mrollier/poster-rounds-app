// Entry point: holds the app's state, wires the buttons, and keeps results in sync with the team.
import { store, bootstrap, fetchResults, postWrite, BackendError } from "./data.js";
import { initMap, showCity, drawPins, closePopup, setHome, setMe, setFollow, onUserPan } from "./map.js";
import { watchWhileVisible, restartWatching, lastPosition } from "./location.js";
import { setup, toast, ask, $ } from "./ui.js";
import { priority, cycleStart, brusselsToday, cycleFor, resultKey, isDone, STATUS_LABEL } from "./logic.js";
import { mergeResults, withPending, createQueue } from "./sync.js";
import { dist, pt } from "./geo.js";
import { pinOf, nextCardHtml, rowHtml, statsHtml } from "./views.js";

initMap($("map"));

let settings = store.get("settings", null); // {name, code, home, campaign}
let boot = store.get("boot", null);         // last bootstrap answer, so the app opens without network
// Results as the server last told us: {campaign_id, map: {key: row}, serverTime}
let synced = store.get("results", null);

function save() { store.set("settings", settings); store.set("boot", boot); }
const saveResults = () => store.set("results", synced);

// ---------- Derived data ----------

const campaign = () => boot?.campaigns.find(c => c.campaign_id === boot.campaign_id) || null;
const city = () => boot.cities.find(c => c.city === campaign()?.city);
// The current board-cleaning cycle (a date), worked out fresh each time: the app may stay open past midnight.
const boardCycle = () => cycleStart(city()?.board_cleaning, brusselsToday());
const keyOf = place => resultKey({ campaign_id: boot.campaign_id, place_id: place.place_id, cycle: cycleFor(place, boardCycle()) });

// All stops of this campaign with their type and latest result (ours not yet sent included).
function stops() {
  const c = campaign(), types = Object.fromEntries(boot.types.map(t => [t.type, t]));
  const results = withPending(synced.map, queue.items, settings.name);
  return boot.places
    .map(place => ({ place, prio: priority(place, c), type: types[place.type] || { label: place.type, color: "#444" },
                     res: results[keyOf(place)] || null }))
    .filter(s => s.prio > 0);
}
const findStop = id => stops().find(s => s.place.place_id === id);

// Where "nearest" is measured from: my live position, else home, else the city centre.
function origin() {
  const c = city();
  return lastPosition() || settings.home || (c && { lat: +c.centre_lat, lon: +c.centre_lon });
}

// ---------- Drawing ----------

function render() {
  const c = campaign();
  if (!c) {
    $("next").innerHTML = "<p>No active campaign. The organiser can set one to active in the sheet.</p>";
    return;
  }
  $("campaign-name").textContent = c.name;
  const all = stops(), from = origin();
  // Until the route modes arrive (next step), the list is simply "nearest first".
  const order = all.map(s => ({ s, d: dist(from, pt(s.place)) })).sort((a, b) => a.d - b.d).map(x => x.s);
  const st = s => s.res?.status || "";
  const next = order.find(s => !st(s)) || order.find(s => st(s) === "later");

  drawPins(all.map(s => pinOf(s, s.prio)));
  setHome(settings.home);
  $("next").innerHTML = nextCardHtml(next, "Nearest stop to do");
  $("stats").innerHTML = statsHtml({
    done: all.filter(s => isDone(st(s))).length, total: all.length,
    hung: all.reduce((n, s) => n + (st(s) === "posted" ? +s.res.posters || 0 : 0), 0),
    planned: all.reduce((n, s) => n + (+s.place.posters || 0), 0),
  });
  $("list-title").textContent = "All stops, nearest first";
  $("stops").innerHTML = order.map(s => rowHtml(s, s.prio)).join("");
  renderSync();
}

function renderSync() {
  const n = queue.items.length;
  $("sync-btn").hidden = !n;
  $("sync-btn").textContent = `${n} waiting to sync`;
  $("sync-btn").setAttribute("aria-label", `${n} change${n === 1 ? "" : "s"} waiting to sync. Tap to try now.`);
}

$("sheet-toggle").onclick = () => {
  const open = $("sheet-more").hidden;
  $("sheet-more").hidden = !open;
  $("sheet-toggle").setAttribute("aria-expanded", String(open));
  $("sheet-toggle-text").textContent = open ? "Hide the list" : "Show all stops";
  $("sheet").classList.toggle("open", open);
};

// ---------- Results: write locally at once, send in the background ----------

const queue = createQueue({
  load: () => store.get("queue", []),
  save: items => store.set("queue", items),
  send: body => postWrite(settings.code, settings.name, body),
  onSent: (item, reply) => { mergeResults(synced.map, [reply.result]); saveResults(); render(); },
  onRefused: (item, e) => { toast(`A change could not be saved: ${e.message}`); render(); },
});

let retryDelay = 2000, retryTimer = null;
async function flush() {
  clearTimeout(retryTimer);
  const r = await queue.flush();
  if (r === "offline") { // no connection: try again later, waiting longer each time (max 1 minute)
    retryTimer = setTimeout(flush, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  } else if (r === "done") retryDelay = 2000;
  else if (r === "stopped") toast("Changes can't be sent: the team code is not right. Check it in Settings (☰).");
  renderSync();
}

function write(place, patch) {
  queue.add({ action: "result", campaign_id: boot.campaign_id, place_id: place.place_id,
              cycle: cycleFor(place, boardCycle()), ...patch });
  render();
  flush();
}

async function markPosted(s) {
  const planned = +s.place.posters || 1;
  let n = planned;
  if (planned > 1) {
    const typed = await ask(`${s.place.name}: how many posters did you hang?`, { value: planned });
    if (typed === null) return;
    n = Math.max(0, parseInt(typed, 10) || 0);
  }
  write(s.place, { status: "posted", posters: n });
}

async function markOther(s, status) { // not possible, refused, full, closed, come back later
  const msg = status === "nope" ? `${s.place.name}: not possible. Reason (optional):` : `${STATUS_LABEL[status]}. Note (optional):`;
  const note = await ask(msg, { value: s.res?.note || "", ok: "Save", cancel: "Skip" });
  write(s.place, { status, posters: 0, ...(note !== null ? { note: note.trim() } : {}) });
}

async function editNote(s) {
  const note = await ask(`Note for ${s.place.name}:`, { value: s.res?.note || "", ok: "Save" });
  if (note !== null) write(s.place, { note: note.trim() });
}

// One handler for every result button: next-stop card, list rows, and map popups.
async function onAction(e) {
  const el = e.target.closest("[data-act]");
  if (!el || el.tagName === "SELECT") return;
  const s = findStop(el.dataset.id);
  if (!s) return;
  closePopup();
  const act = el.dataset.act;
  if (act === "posted") await markPosted(s);
  if (act === "nope") await markOther(s, "nope");
  if (act === "undo") write(s.place, { status: "", posters: 0 });
  if (act === "note") await editNote(s);
}
$("sheet").addEventListener("click", onAction);
$("map").addEventListener("click", onAction);
$("stops").addEventListener("change", async e => {
  if (e.target.dataset.act !== "status") return;
  const s = findStop(e.target.dataset.id), status = e.target.value;
  if (status === "posted") await markPosted(s);
  else if (status) await markOther(s, status);
  else write(s.place, { status: "", posters: 0 });
  render(); // also resets the menu if the dialog was cancelled
});
$("sync-btn").onclick = flush;

// ---------- Polling: see the other volunteers' ticks ----------

let polling = false;
async function poll() {
  if (polling || document.hidden || !settings?.code || !boot?.campaign_id) return;
  polling = true;
  try {
    // Ask from a minute before the last answer: a write that landed while that answer was being made
    // could otherwise slip through. Getting a row twice is harmless (last write wins).
    const since = new Date(Date.parse(synced.serverTime) - 60000).toISOString();
    const r = await fetchResults(settings.code, boot.campaign_id, since);
    synced.serverTime = r.serverTime;
    if (mergeResults(synced.map, r.results)) render();
    saveResults();
  } catch (e) {
    if (!(e instanceof BackendError)) throw e; // offline: just try again next time
  } finally {
    polling = false;
  }
  if (queue.items.length) flush();
}
setInterval(poll, 30000);
document.addEventListener("visibilitychange", poll);
window.addEventListener("focus", poll);
window.addEventListener("online", flush);

// ---------- Settings and loading ----------

// Take a (fresh or saved) bootstrap answer: reset results when the campaign changed, then merge.
function useBoot(recentre) {
  if (!synced || synced.campaign_id !== boot.campaign_id) {
    synced = { campaign_id: boot.campaign_id, map: {}, serverTime: boot.serverTime };
  }
  mergeResults(synced.map, boot.results);
  if (Date.parse(boot.serverTime) > Date.parse(synced.serverTime)) synced.serverTime = boot.serverTime;
  saveResults();
  render();
  if (recentre) showCity(city());
}

async function openSettings() {
  ({ settings, boot } = await setup(settings || {}, boot));
  save();
  useBoot(true);
  flush();
}

// Fetch fresh data in the background; the saved copy is already on screen.
async function refresh() {
  try {
    boot = await bootstrap(settings.code, settings.campaign);
    settings.campaign = boot.campaign_id;
    save();
    useBoot(false);
    flush();
  } catch (e) {
    if (!(e instanceof BackendError)) throw e;
    toast(e.offline ? "Offline: showing the data saved on this phone." : e.message);
    if (e.stop) openSettings(); // the team code was changed: ask for the new one
  }
}

// ---------- Live location ----------

const LOW_ACCURACY = 100; // metres: above this, say the blue dot may be off
let follow = false, locationStarted = false, lastRenderFrom = null;

function locMessage(text, { bad = false, retry = false } = {}) {
  $("loc-msg").hidden = !text;
  $("loc-msg").classList.toggle("bad", bad);
  $("loc-text").textContent = text;
  $("loc-retry").hidden = !retry;
}

function startLocation() {
  if (locationStarted) return;
  locationStarted = true;
  locMessage("Finding your location…");
  setTimeout(() => { if (!lastPosition() && !$("loc-msg").classList.contains("bad"))
    locMessage("No location fix yet. Step outside or wait a moment."); }, 15000);
  watchWhileVisible(pos => {
    setMe(pos);
    locMessage(pos.accuracy > LOW_ACCURACY ? `Low accuracy (±${pos.accuracy} m): the blue dot may be off.` : "");
    // "Nearest stop" depends on where I am: re-sort after moving 50 m or more.
    if (!lastRenderFrom || dist(lastRenderFrom, pos) > 50) { lastRenderFrom = pos; render(); }
  }, (code, msg) => {
    if (code === 2 && lastPosition()) return; // a short GPS hiccup: keep showing the last position
    locMessage(msg, { bad: true, retry: code === 1 });
  });
}

function setFollowing(on) {
  follow = on;
  $("follow-btn").setAttribute("aria-pressed", String(on));
  setFollow(on, lastPosition());
  if (on && !lastPosition()) locMessage("Waiting for your location…");
}
$("follow-btn").onclick = () => setFollowing(!follow);
onUserPan(() => { if (follow) setFollowing(false); }); // panning by hand means "let me look around"
$("loc-hide").onclick = () => locMessage("");
$("loc-retry").onclick = () => { locMessage("Finding your location…"); restartWatching(); };

// ---------- Start ----------

$("menu-btn").onclick = openSettings;

if (settings?.code && boot) { useBoot(true); refresh(); startLocation(); }
else openSettings().then(startLocation);
