// Entry point: holds the app's state, wires the buttons, and keeps results in sync with the team.
import { store, bootstrap, fetchResults, postWrite, BackendError } from "./data.js";
import { initMap, showCity, drawPins, closePopup, setHome, setMe, setFollow, onUserPan, pickPoint, drawRoute, fitTo,
  drawZones, zoneLabelsFromZoom, esc } from "./map.js";
import { watchWhileVisible, restartWatching, lastPosition } from "./location.js";
import { setup, toast, ask, $ } from "./ui.js";
import { priority, cycleStart, brusselsToday, cycleFor, resultKey, STATUS_LABEL, gmapsUrl, chunkLinks } from "./logic.js";
import { mergeResults, withPending, createQueue } from "./sync.js";
import { dist } from "./geo.js";
import { tripTime } from "./routes.js";
import { planAll, computeWayIds, planWay, zonesNow, zoneState, byId, done } from "./modes.js";
import { pinOf, nextCardHtml, rowHtml, statsHtml, seg, linksHtml, zoneRowHtml, typesHtml } from "./views.js";

initMap($("map"));
zoneLabelsFromZoom(15);

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

// ---------- View state (saved on this phone) ----------

const view = { mode: "all", zone: null, zgap: 600, ztime: 60, ...store.get("view", {}) };
if (!["all", "way", "zones"].includes(view.mode)) view.mode = "all";
const filters = { prio: "all", skip: [], travel: "bike", ...store.get("filters", {}) };
let allOrder = store.get("allOrder", null);              // Everything left: {key, ids}
let way = { budget: 15, ...store.get("way", {}) };       // On my way: {from, to, budget, ids, extra, direct}
let zonesSaved = store.get("zones", null);               // Zones: {key, zones}
let fitted = "";                                         // re-zoom the map only when the view changes
const saveView = () => { store.set("view", view); store.set("filters", filters); };

const skip = () => new Set(filters.skip);
const passes = s => !skip().has(s.place.type) && (filters.prio === "all" || s.prio <= +filters.prio);
const filterKey = () => JSON.stringify([boot.campaign_id, filters.prio, [...filters.skip].sort()]);
const homeLabel = () => (lastPosition() ? "your position" : settings.home ? "home" : "the city centre");

// ---------- Drawing ----------

function render() {
  const c = campaign();
  if (!c) {
    $("next").innerHTML = "<p>No active campaign. The organiser can set one to active in the sheet.</p>";
    return;
  }
  $("campaign-name").textContent = `Campaign: ${c.name}`;
  $("modes").innerHTML = seg("mode", [["all", "Everything left"], ["way", "On my way"], ["zones", "Zones"]], view.mode);
  setHome(settings.home);
  renderSync();
  const all = stops(), kept = all.filter(passes);
  if (view.mode === "zones") return renderZones(kept, all);
  drawZones(null);
  if (view.mode === "way") renderWay(kept); else renderAll(kept);
}

function renderAll(kept) {
  const start = origin(), home = settings.home || null;
  const plan = planAll(kept, allOrder, start, home, filterKey());
  if (plan.saved !== allOrder) { allOrder = plan.saved; store.set("allOrder", allOrder); }
  const left = plan.route.filter(s => !done(s)).length;
  $("mode-box").innerHTML = `<div class="mode-line"><span><b>${left}</b> to do, nearest first from ${homeLabel()}</span>
    <button type="button" class="btn small" data-ui="replan">Re-plan from here</button></div>`;
  renderRoute({ kept, route: plan.route, extra: plan.extra, scope: kept, start, end: home, endLabel: "home",
    travel: filters.travel, heading: (k, n) => `Next stop · ${k} of ${n}`, linkLimit: 12,
    title: "Everything left, in order", finished: home
      ? { text: "All stops done. On to home!", label: "Navigate home", url: gmapsUrl(home, { mode: filters.travel }) }
      : { text: "All stops done with these filters. Well done!" },
    fitKey: JSON.stringify(["all", filterKey()]) });
}

// Re-drawing the sheet would close a settings panel you just opened: keep it open (except that the
// "On my way" panel folds away once both ends are set, to show the trip).
const wasOpen = () => !!$("mode-box").querySelector("details")?.open;
let wayWasReady = false;

function renderWay(kept) {
  const ready = !!(way.from && way.to), plan = planWay(kept, way);
  const open = !ready || (wasOpen() && wayWasReady);
  wayWasReady = ready;
  const end = (k, label) => `<div class="way-end"><span>${label}: <b>${esc(way[k]?.label || "not set")}</b></span>
    <div class="btns">
      <button type="button" class="btn small" data-ui="way" data-end="${k}" data-how="gps">My position</button>
      ${settings.home ? `<button type="button" class="btn small" data-ui="way" data-end="${k}" data-how="home">Home</button>` : ""}
      <button type="button" class="btn small" data-ui="way" data-end="${k}" data-how="tap">Tap on the map</button></div></div>`;
  $("mode-box").innerHTML = `<details class="way" ${open ? "open" : ""}>
    <summary><span>${ready ? `From <b>${esc(way.from.label)}</b> to <b>${esc(way.to.label)}</b> · +${way.extra} of ${way.budget} min`
      : "Set where you start and where you're going"}</span></summary>
    ${end("from", "From")}${end("to", "To")}
    <fieldset><legend>Extra time you can spend</legend>
      <div class="seg" id="budget">${seg("budget", [5, 15, 30, 60].map(m => [m, `${m} min`]), way.budget)}</div></fieldset>
    <p class="hint">You can also tap a stop's pin and choose "Start here" or "End here".</p>
    ${ready ? `<button type="button" class="btn small" data-ui="recalc">Recalculate</button>` : ""}
  </details>`;
  if (!ready) {
    $("next").innerHTML = nextCardHtml(null, "", { finished: { text: "Set where you start and where you're going (above)." } });
    clearRoute(kept, s => wayButtons(s));
    return;
  }
  renderRoute({ kept, route: plan.route, extra: [], scope: plan.route, start: way.from, end: way.to, endLabel: "your destination",
    travel: filters.travel, heading: (k, n) => `Next stop on your way · ${k} of ${n}`, linkLimit: 99,
    title: "Stops on the way, in order", showOthers: true, pinExtra: wayButtons,
    endPins: [{ ...way.from, label: "A" }, { ...way.to, label: "B" }],
    finished: { text: plan.route.length ? "All stops on the way done. On to your destination!"
      : `No stop fits in ${way.budget} extra minutes. Allow more time, or pick other ends.`,
      label: "Navigate to your destination", url: gmapsUrl(way.to, { mode: filters.travel }) },
    fitKey: JSON.stringify(["way", way.from, way.to, way.budget, filterKey()]) });
}
const wayButtons = s => `<button type="button" class="popbtn alt" data-act="from" data-id="${esc(s.place.place_id)}">Start here</button>
  <button type="button" class="popbtn alt" data-act="to" data-id="${esc(s.place.place_id)}">End here</button>`;

// Draws any planned trip: card, stats, Google Maps links, list, pins and line.
function renderRoute(o) {
  const remaining = o.route.filter(s => !done(s));
  const st = s => s.res?.status || "";
  const next = remaining.find(s => !st(s)) || remaining.find(s => st(s) === "later");
  const k = next ? o.route.indexOf(next) + 1 : 0;
  $("next").innerHTML = nextCardHtml(next, o.heading(k, o.route.length), { travel: o.travel, finished: o.finished });

  // Times: from where I am now (or the trip's start) through what's left. A zone's walking loop
  // always counts from the bike spot: you bike there first.
  const from = (o.fromBikeSpot ? o.start : lastPosition() || o.start) || o.start;
  const trip = tripTime(from, remaining.map(s => s.place), o.end, o.travel);
  const eta = new Map(remaining.map((s, i) => [s, trip.arrive[i]]));
  const doneN = o.scope.filter(done).length;
  $("stats").innerHTML = statsHtml([
    [`${doneN}/${o.scope.length}`, "stops done"],
    [`${o.scope.reduce((n, s) => n + (st(s) === "posted" ? +s.res.posters || 0 : 0), 0)}`, "posters hung"],
    [(trip.metres / 1000).toFixed(1), "km to go"],
    [`${Math.floor(trip.minutes / 60)}:${String(Math.round(trip.minutes % 60)).padStart(2, "0")}`, "hours to go"],
  ]);

  // Google Maps: the next stops in parts of 4; the trip's end is added once it's within reach.
  const targets = remaining.slice(0, o.linkLimit).map(s => s.place);
  const withEnd = o.end && remaining.length <= o.linkLimit;
  if (withEnd) targets.push(o.end);
  const links = chunkLinks(targets, o.travel);
  $("links").innerHTML = linksHtml(links, withEnd ? o.endLabel : null, targets.length)
    + (o.linkLimit < remaining.length ? `<span class="muted">Later parts appear as you tick stops off.</span>` : "");

  $("list-title").textContent = o.title;
  $("stops").innerHTML = o.route.map((s, i) => rowHtml(s, i + 1, eta.get(s) ?? null, o.travel)).join("")
    + o.extra.map(s => rowHtml(s, "✓", null, o.travel)).join("");

  // Pins: the trip's stops numbered; other open stops small (in "On my way", so they can be an end).
  const pos = new Map(o.route.map((s, i) => [s, i + 1]));
  const pins = o.kept.filter(s => pos.has(s) || done(s) || o.showOthers !== false)
    .map(s => pos.has(s) ? pinOf(s, pos.get(s), o.pinExtra?.(s) || "") : { ...pinOf(s, "", o.pinExtra?.(s) || ""), cls: done(s) ? "faded" : "dim" });
  for (const e of o.endPins || []) pins.push({ lat: +e.lat, lon: +e.lon, label: e.label, cls: "way", color: "#1a73e8", title: e.label, popup: esc(e.label), z: 3000 });
  drawPins(pins);
  drawRoute([from, ...remaining.slice(0, o.linkLimit).map(s => s.place), ...(withEnd ? [o.end] : [])]);
  if (o.fitKey !== fitted) {
    fitted = o.fitKey;
    fitTo([o.start, ...remaining.slice(0, 12).map(s => s.place), ...(o.end ? [o.end] : [])].filter(Boolean));
  }
}

// No trip yet: plain pins, nothing else.
function clearRoute(kept, pinExtra) {
  $("stats").innerHTML = ""; $("links").innerHTML = ""; $("stops").innerHTML = "";
  drawRoute(null);
  drawPins(kept.filter(s => !done(s)).map(s => pinOf(s, s.prio, pinExtra(s))));
}

// ---------- Zones ----------

let racks = null, labels = null, geoCity = null;
async function loadCityFiles(cityName) { // bike racks and neighbourhood names; a city without files still works
  const get = f => fetch(f).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const slug = cityName.toLowerCase();
  const [r, n] = await Promise.all([get(`data/racks-${slug}.json`), get(`data/neighbourhoods-${slug}.json`)]);
  racks = (r?.racks || []).map(([lat, lon]) => ({ lat, lon }));
  labels = n?.places || [];
  geoCity = cityName;
}

function renderZones(kept, all) {
  const cityName = campaign().city;
  if (geoCity !== cityName) {
    $("next").innerHTML = nextCardHtml(null, "", { finished: { text: "Working out the zones…" } });
    loadCityFiles(cityName).then(render);
    return;
  }
  const key = JSON.stringify([filterKey(), view.zgap, view.ztime]);
  const z0 = zonesNow(kept, zonesSaved, key, { gap: view.zgap, maxMin: view.ztime }, racks, labels);
  if (z0 !== zonesSaved) { zonesSaved = z0; store.set("zones", z0); view.zone = null; saveView(); }
  const allById = byId(all), zs = zonesSaved.zones.map((z, i) => zoneState(z, i, allById));
  const z = zs.find(q => q.id === view.zone);
  if (z) return renderZone(kept, z);

  // Overview: all zones, biggest first.
  const stopsIn = zs.flatMap(q => q.stops);
  $("mode-box").innerHTML = `<details class="way" ${wasOpen() ? "open" : ""}><summary><span><b>${zs.length}</b> zones · ${zs.filter(q => q.total === 1).length} single stops · settings</span></summary>
    <label for="z-gap">Max walk between stops: <b id="z-gap-v">${view.zgap} m</b></label>
    <input type="range" id="z-gap" min="200" max="800" step="50" value="${view.zgap}">
    <fieldset><legend>Time per zone</legend><div class="seg" id="z-time">${seg("ztime", [20, 30, 45, 60].map(m => [m, `${m} min`]), view.ztime)}</div></fieldset>
    <button type="button" class="btn small" data-ui="rebuild">Rebuild zones</button></details>`;
  $("next").innerHTML = nextCardHtml(null, "", { finished: { text: zs.length
    ? "Pick a zone: tap it on the map, or open it from the list. Bike to the P, then walk the loop."
    : "No stops left with these filters." } });
  $("stats").innerHTML = statsHtml([[`${stopsIn.filter(done).length}/${stopsIn.length}`, "stops done"],
    [String(zs.filter(q => q.total > 1).length), "walking loops"], [String(zs.filter(q => q.done === q.total).length), "zones finished"]]);
  $("links").innerHTML = "";
  $("list-title").textContent = "Zones (biggest first)";
  $("stops").innerHTML = zs.map(zoneRowHtml).join("");
  drawPins([]); drawRoute(null);
  drawZones(zs.map(q => ({ id: q.id, number: q.number, name: q.name, centre: q.centre, mins: q.mins, color: q.color,
    done: q.done, total: q.total, stops: q.stops.map(s => ({ lat: +s.place.lat, lon: +s.place.lon, color: s.type.color, done: done(s) })) })), openZone);
  if (fitted !== key) { fitted = key; fitTo(stopsIn.map(s => s.place)); }
}

function renderZone(kept, z) {
  const single = z.total === 1;
  const bike = gmapsUrl(z.park, { mode: "bike" });
  $("mode-box").innerHTML = `<div class="mode-line"><button type="button" class="btn small" data-ui="zone-back">← All zones</button>
    <span><b>${z.number}. ${esc(z.name)}</b>${single ? "" : ` · ${z.total} stops · loop about ${z.mins} min`}</span></div>
    ${single ? "" : `<a class="btn bike" href="${bike}" target="_blank" rel="noopener">Bike to the P${z.rack ? " (bike rack)" : ""}</a>`}`;
  drawZones(null);
  const park = { ...z.park, label: "P" };
  renderRoute({ kept, route: z.stops, extra: [], scope: z.stops, start: single ? origin() : park, end: single ? null : park,
    fromBikeSpot: !single,
    endLabel: "back to the P", travel: single ? filters.travel : "walk",
    heading: (k, n) => (single ? `Single stop · ${z.name}` : `Stop ${k} of ${n} · ${z.name}`), linkLimit: 99,
    title: single ? "The stop" : "Walking loop, in order (back to the P at the end)", showOthers: false,
    endPins: single ? [] : [{ ...park, label: "P" }],
    finished: single ? { text: "Done here. Pick the next zone." }
      : { text: "All stops in this zone done. Walk back to your bike.", label: "Walk back to the P", url: gmapsUrl(park, { mode: "walk" }) },
    fitKey: JSON.stringify(["zone", z.id]) });
}

function openZone(id) { view.zone = id; saveView(); closeSheet(); render(); } // close the list: show the zone on the map

// ---------- Mode, filters and route controls ----------

$("modes").addEventListener("change", e => { view.mode = e.target.value; saveView(); render(); });

function setWay(patch) {
  way = computeWayIds(stops().filter(passes), { ...way, ...patch }, filters.travel);
  store.set("way", way);
  render();
}

// Filters changed: routes that depend on them recalculate (Zones and Everything left notice it by their key).
function filtersChanged() {
  saveView();
  if (way.from && way.to) setWay({}); else render();
  renderFilters();
}

function renderFilters() {
  const all = stops(), counts = {};
  all.filter(s => filters.prio === "all" || s.prio <= +filters.prio).forEach(s => { counts[s.place.type] = (counts[s.place.type] || 0) + 1; });
  $("f-travel").innerHTML = seg("travel", [["bike", "Bike"], ["walk", "On foot"]], filters.travel);
  $("f-prio").innerHTML = seg("prio", [["all", "All"], ["2", "1–2"], ["1", "1"]], filters.prio);
  $("f-types").innerHTML = typesHtml(boot.types, counts, skip());
  const shown = boot.types.filter(t => counts[t.type]), off = shown.filter(t => skip().has(t.type)).length;
  $("types-sum").textContent = `Types of place: ${off ? `${off} of ${shown.length} skipped` : `all ${shown.length} included`}`;
}
$("filter-btn").onclick = () => { renderFilters(); $("filters").showModal(); };
$("f-travel").addEventListener("change", e => { filters.travel = e.target.value; filtersChanged(); });
$("f-prio").addEventListener("change", e => { filters.prio = e.target.value; filtersChanged(); });
$("f-types").addEventListener("change", e => {
  const set = skip();
  if (e.target.checked) set.delete(e.target.value); else set.add(e.target.value);
  filters.skip = [...set]; filtersChanged();
});
$("types-all").onclick = () => { filters.skip = []; filtersChanged(); };
$("types-none").onclick = () => { filters.skip = boot.types.map(t => t.type); filtersChanged(); };

// Buttons and inputs in the sheet that steer the routes (data-ui="…").
async function wayEnd(end, how) {
  if (how === "home") return setWay({ [end]: { ...settings.home, label: "Home" } });
  if (how === "gps") {
    const p = lastPosition();
    if (!p) return toast("No location yet. Wait for the blue dot, or tap on the map instead.");
    return setWay({ [end]: { lat: p.lat, lon: p.lon, label: "My position" } });
  }
  closeSheet();
  toast(end === "from" ? "Tap the map where you start." : "Tap the map where you're going.", 0);
  const p = await pickPoint();
  toast("");
  setWay({ [end]: { ...p, label: "Point on the map" } });
}

$("sheet").addEventListener("click", e => {
  const el = e.target.closest("[data-ui]");
  if (!el) return;
  const ui = el.dataset.ui;
  if (ui === "replan") {
    if (!lastPosition()) toast(`No location yet: planned from ${homeLabel()}.`);
    allOrder = planAll(stops().filter(passes), null, origin(), settings.home || null, filterKey(), true).saved;
    store.set("allOrder", allOrder); fitted = ""; render();
  }
  if (ui === "way") wayEnd(el.dataset.end, el.dataset.how);
  if (ui === "recalc") setWay({});
  if (ui === "zone-open") openZone(el.dataset.zone);
  if (ui === "zone-back") { view.zone = null; saveView(); fitted = ""; render(); }
  if (ui === "rebuild") {
    zonesSaved = zonesNow(stops().filter(passes), null, zonesSaved?.key, { gap: view.zgap, maxMin: view.ztime }, racks, labels, true);
    store.set("zones", zonesSaved); fitted = ""; render();
  }
});
$("sheet").addEventListener("change", e => {
  if (e.target.name === "budget") setWay({ budget: +e.target.value });
  if (e.target.name === "ztime") { view.ztime = +e.target.value; saveView(); render(); }
  if (e.target.id === "z-gap") { view.zgap = +e.target.value; saveView(); render(); }
});
$("sheet").addEventListener("input", e => { if (e.target.id === "z-gap") $("z-gap-v").textContent = `${e.target.value} m`; });

function renderSync() {
  const n = queue.items.length;
  $("sync-btn").hidden = !n;
  $("sync-btn").textContent = `${n} waiting to sync`;
  $("sync-btn").setAttribute("aria-label", `${n} change${n === 1 ? "" : "s"} waiting to sync. Tap to try now.`);
}

// The sheet shows just the next stop ("peek") or, opened, the stats and the whole list.
function setSheet(open) {
  $("sheet-more").hidden = !open;
  $("sheet-toggle").setAttribute("aria-expanded", String(open));
  $("sheet-toggle-text").textContent = open ? "Hide the list" : "Show all stops";
  $("sheet").classList.toggle("open", open);
}
$("sheet-toggle").onclick = () => setSheet($("sheet-more").hidden);
const closeSheet = () => setSheet(false);


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
  if (act === "from" || act === "to") setWay({ [act]: { lat: +s.place.lat, lon: +s.place.lon, label: s.place.name } });
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
