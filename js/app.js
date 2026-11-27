// Entry point: holds the app's state, wires the buttons, and keeps results in sync with the team.
import { store, bootstrap, fetchResults, postWrite, BackendError } from "./data.js";
import { initMap, showCity, drawPins, closePopup, setHome, setMe, setFollow, onUserPan, pickPoint, cancelPick, drawRoute, fitTo,
  drawZones, zoneLabelsFromZoom } from "./map.js";
import { watchWhileVisible, restartWatching, lastPosition } from "./location.js";
import { setup, toast, ask, $, same } from "./ui.js";
import { placeStars, eventTypes, eventWeights, cleanBoot, num, cycleStart, brusselsToday, cycleFor, resultKey, STATUS_LABEL, chunkLinks, esc, statusOf } from "./logic.js";
import { mergeResults, withPending, createQueue } from "./sync.js";
import { dist, minutes, nearest } from "./geo.js";
import { tripTime, orderStops, parkAt, sectorOf, ZONE_MINUTES } from "./routes.js";
import { openTrain } from "./train.js";
import { computeWayIds, planWay, zonesNow, zoneState, byId, done } from "./modes.js";
import { addPlace } from "./addplace.js";
import { startNav, stopNav, navUpdate, navigating, navTarget, onNavChange } from "./nav.js";
import { pinOf, nextCardHtml, rowHtml, statsHtml, seg, linksHtml, zoneRowHtml, typesHtml, setPopupExtra } from "./views.js";

initMap($("map"));
zoneLabelsFromZoom(15);

let settings = store.get("settings", null); // {name, code, role, home}
let boot = store.get("boot", null);         // last bootstrap answer, so the app opens without network
// Results as the server last told us: {campaign_id, map: {key: row}, serverTime}
let synced = store.get("results", null);

function save() { store.set("settings", settings); store.set("boot", boot); }
const saveResults = () => store.set("results", synced);

// ---------- Derived data ----------

const campaign = () => boot?.campaigns[0] || null; // the code's campaign (the backend sends just that one)
const city = () => boot.cities.find(c => same(c.city, campaign()?.city));
// The current board-cleaning cycle (a date), worked out fresh each time: the app may stay open past midnight.
const boardCycle = () => cycleStart(city()?.board_cleaning, brusselsToday());
const keyOf = place => resultKey({ campaign_id: boot.campaign_id, place_id: place.place_id, cycle: cycleFor(place, boardCycle()) });

// The kind of event we plan for: picked in Filters, else the campaign's own, else the first the sheet knows.
const events = () => eventTypes(boot.types);
// Matched without caring about case or spaces: "poetry " in the sheet still means "Poetry".
const evMatch = e => events().find(x => same(x, e));
const currentEvent = () => [filters.event, campaign()?.event_type, events()[0]].map(evMatch).find(Boolean) || "";

// The learned star set (from swipes, see README "How the stars are made"): only for the campaign's own
// kind of event. Picking another kind in Filters uses the type rule for that kind instead.
const learnedSet = () => (boot.set && same(currentEvent(), campaign()?.event_type) ? boot.set : null);
// An admin's override (pending ones from the outbox included) wins over everything.
function overrides() {
  const out = { ...(boot.overrides || {}) };
  for (const { body } of queue.items) {
    if (body.action === "override") { if (body.stars === "") delete out[body.place_id]; else out[body.place_id] = body.stars; }
  }
  return out;
}

// All stops of this campaign with their stars, type and latest result (ours not yet sent included).
function stops() {
  const w = eventWeights(boot.types, currentEvent()), types = Object.fromEntries(boot.types.map(t => [t.type, t]));
  const results = withPending(synced.map, queue.items, settings.name);
  const how = { set: learnedSet(), overrides: overrides(), weights: w, places: boot.places };
  return boot.places
    .map(place => ({ place, stars: placeStars(place, how), type: types[place.type] || { label: place.type, color: "#444" },
                     pinned: settings?.role === "admin" && how.overrides[place.place_id] !== undefined, // set by hand
                     res: results[keyOf(place)] || null }))
    // 0★ places are hidden; an admin still sees a place they set by hand, so they can change it back.
    .filter(s => s.stars > 0 || s.pinned);
}
const findStop = id => stops().find(s => s.place.place_id === id);

// Where "nearest" is measured from: my live position, else home, else the city centre.
function origin() {
  const c = city(), centre = c && { lat: num(c.centre_lat), lon: num(c.centre_lon) };
  const p0 = boot.places[0];
  return lastPosition() || settings.home || (centre?.lat && centre?.lon ? centre : p0 && { lat: p0.lat, lon: p0.lon }) || { lat: 51.05, lon: 3.72 };
}

// ---------- View state (saved on this phone) ----------

const view = { mode: "all", zone: null, ...store.get("view", {}) };
if (!["all", "way", "zones"].includes(view.mode)) view.mode = "all";
const filters = { min: "1", skip: [], skipFor: null, event: null, travel: "bike", zsize: "M", ...store.get("filters", {}) };
let way = { budget: 15, ...store.get("way", {}) };       // On my way: {from, to, budget, ids, extra}
let zonesSaved = null;                                   // Zones: {key, zones}, rebuilt in a few ms when needed
let fitted = "";                                         // re-zoom the map only when the view changes
let routeTravel = "bike", finishedDest = null, zonePark = null; // for the Navigate buttons
const saveView = () => { store.set("view", view); store.set("filters", filters); };

const skip = () => new Set(filters.skip);
const passes = s => s.pinned || (!skip().has(s.place.type) && s.stars >= +filters.min);
const filterKey = () => JSON.stringify([boot.campaign_id, currentEvent(), filters.min, [...filters.skip].sort()]);

// Each kind of event comes with its preset of place types (weight above 0). Switching to another kind
// (or a campaign with another default) ticks that preset again; within one kind, your own ticks stay.
// With a learned set the stars already say which places matter, so every type is ticked.
function syncPreset() {
  const ev = currentEvent(), key = learnedSet() ? `${ev}:learned` : ev;
  if (filters.skipFor === key) return;
  const w = eventWeights(boot.types, ev);
  filters.skip = ev && !learnedSet() ? boot.types.filter(t => !w[t.type]).map(t => t.type) : [];
  filters.skipFor = key;
  saveView();
}
const distText = m => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const homeLabel = () => (lastPosition() ? "your position" : settings.home ? "home" : "the city centre");

// ---------- Drawing ----------

function render() {
  const c = campaign();
  if (!c) {
    $("next").innerHTML = "<p>No active campaign. The organiser can set one to active in the sheet.</p>";
    $("sheet").classList.remove("booting");
    return;
  }
  $("campaign-name").textContent = `Campaign: ${c.name}`;
  $("sheet").classList.remove("booting");
  if (!boot.places.length) { // e.g. the campaign says "Ghent" and the places say "Gent"
    $("next").innerHTML = `<p>No places in the sheet for the city "${esc(c.city)}". The organiser can check that the
      campaign's city is spelled the same as in the Places tab.</p>`;
    return;
  }
  $("modes").querySelector(`input[value="${view.mode}"]`).checked = true;
  setHome(settings.home);
  renderSync();
  syncPreset();
  const all = stops(), kept = all.filter(passes);
  $("zone-chip").hidden = true; // shown again below only while a zone is open
  if (view.mode === "zones") return renderZones(kept, all);
  drawZones(null);
  if (view.mode === "way") renderWay(kept); else renderAll(kept);
}

// All left: no route, just every open stop on the map. The card is the nearest stop to where you are,
// and the list runs from near to far. It re-sorts as you move (see startLocation: every 50 m).
function renderAll(kept) {
  const from = origin(), home = settings.home || null;
  routeTravel = filters.travel;
  finishedDest = home ? { ...home, name: "home" } : null;
  const away = s => dist(from, s.place);
  const open = kept.filter(s => !done(s)).sort((a, b) => away(a) - away(b));
  const doneOnes = kept.filter(done);
  // A stop marked "come back later" waits until nothing else is left.
  const next = open.find(s => !s.res?.status) || open[0] || null;

  $("mode-box").innerHTML = `<div class="mode-line"><span><b>${open.length}</b> to do · nearest to ${homeLabel()}</span></div>`;
  $("next").innerHTML = nextCardHtml(next, `Nearest stop · ${open.length} left`, {
    finished: !kept.length ? { text: "No stops match these filters. Change them with the filter button (top right)." }
      : home ? { text: "All stops done. On to home!", label: "Navigate home", dest: finishedDest }
      : { text: "All stops done with these filters. Well done!" } });
  if (!navigating()) $("mini").textContent = next ? `${distText(away(next))} · ${next.place.name}` : "All stops done";

  $("stats").innerHTML = statsHtml([
    [`${doneOnes.length}/${kept.length}`, "stops done"],
    [`${kept.reduce((n, s) => n + (s.res?.status === "posted" ? +s.res.posters || 0 : 0), 0)}`, "posters hung"],
    [`${open.length}`, "left"],
  ]);
  $("links").innerHTML = "";
  $("list-title").textContent = "All left, nearest first";
  listButton(`All ${kept.length} stops`);
  const mins = s => Math.round(minutes(away(s), filters.travel));
  $("stops").innerHTML = listVisible() ? open.map(s => rowHtml(s, `${s.stars}★`, mins(s))).join("")
    + doneOnes.map(s => rowHtml(s, "✓", null)).join("") : "";

  drawPins(kept.map(s => done(s) ? { ...pinOf(s, ""), cls: "faded" } : pinOf(s, `${s.stars}★`)));
  if (!navigating()) drawRoute(null);
  const key = JSON.stringify(["all", filterKey()]);
  // Zoom to you and your nearest 15 stops: all of them would zoom out to the harbour and beyond.
  if (key !== fitted) { fitted = key; fitTo([from, ...open.slice(0, 15).map(s => s.place)]); }
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
    if (!navigating()) $("mini").textContent = "On my way: set where you start and end";
    clearRoute(kept, s => wayButtons(s));
    return;
  }
  renderRoute({ kept, route: plan.route, scope: plan.route, start: way.from, end: way.to, endLabel: "your destination",
    travel: filters.travel, heading: (k, n) => `Next stop on your way · ${k} of ${n}`,
    title: "Stops on the way, in order", showOthers: true, pinExtra: wayButtons,
    endPins: [{ ...way.from, label: "A" }, { ...way.to, label: "B" }],
    finished: { text: plan.route.length ? "All stops on the way done. On to your destination!"
      : `No stop fits in ${way.budget} extra minutes. Allow more time, or pick other ends.`,
      label: "Navigate to your destination", dest: { ...way.to, name: way.to.label } },
    fitKey: JSON.stringify(["way", way.from, way.to, way.budget, filterKey()]) });
}
const wayButtons = s => `<button type="button" class="popbtn alt" data-act="from" data-id="${esc(s.place.place_id)}">Start here</button>
  <button type="button" class="popbtn alt" data-act="to" data-id="${esc(s.place.place_id)}">End here</button>`;

// Draws any planned trip: card, stats, Google Maps links, list, pins and line.
function renderRoute(o) {
  routeTravel = o.travel;
  finishedDest = o.finished.dest || null;
  const remaining = o.route.filter(s => !done(s));
  const next = remaining.find(s => !statusOf(s)) || remaining.find(s => statusOf(s) === "later");
  const k = next ? o.route.indexOf(next) + 1 : 0;
  $("next").innerHTML = nextCardHtml(next, o.heading(k, o.route.length), { finished: o.finished });
  if (!navigating()) $("mini").textContent = next ? `${distText(dist(lastPosition() || o.start, next.place))} · ${next.place.name}` : o.finished.text;

  // Times: from where I am now (or the trip's start) through what's left. A zone's walking loop
  // always counts from the bike spot: you bike there first.
  const from = o.fromBikeSpot ? o.start : lastPosition() || o.start;
  const trip = tripTime(from, remaining.map(s => s.place), o.end, o.travel);
  const eta = new Map(remaining.map((s, i) => [s, trip.arrive[i]]));
  const doneN = o.scope.filter(done).length;
  $("stats").innerHTML = statsHtml([
    [`${doneN}/${o.scope.length}`, "stops done"],
    [`${o.scope.reduce((n, s) => n + (statusOf(s) === "posted" ? +s.res.posters || 0 : 0), 0)}`, "posters hung"],
    [(trip.metres / 1000).toFixed(1), "km to go"],
    [`${Math.floor(trip.minutes / 60)}:${String(Math.round(trip.minutes % 60)).padStart(2, "0")}`, "hours to go"],
  ]);

  // Google Maps: what's left of the trip (and its end) in parts of 4 stops.
  const targets = [...remaining.map(s => s.place), ...(o.end ? [o.end] : [])];
  $("links").innerHTML = linksHtml(chunkLinks(targets, o.travel), o.end ? o.endLabel : null, targets.length);

  $("list-title").textContent = o.title;
  listButton(`All ${o.route.length} stops`);
  // The list (up to ~200 rows) is only built while it's visible: keeps the phone quick.
  $("stops").innerHTML = listVisible() ? o.route.map((s, i) => rowHtml(s, i + 1, eta.get(s) ?? null)).join("") : "";

  // Pins: the trip's stops numbered; other open stops small (in "On my way", so they can be an end).
  const pos = new Map(o.route.map((s, i) => [s, i + 1]));
  const pins = o.kept.filter(s => pos.has(s) || done(s) || o.showOthers !== false)
    .map(s => pos.has(s) ? pinOf(s, pos.get(s), o.pinExtra?.(s) || "") : { ...pinOf(s, "", o.pinExtra?.(s) || ""), cls: done(s) ? "faded" : "dim" });
  for (const e of o.endPins || []) pins.push({ lat: +e.lat, lon: +e.lon, label: e.label, cls: "way", color: "#1a73e8", title: e.label, popup: esc(e.label), z: 3000 });
  drawPins(pins);
  // The line shows the planned trip from its start (not from where I am now): it stays put while I move,
  // so the route server isn't asked again every few steps and the line doesn't flicker.
  if (!navigating()) drawRoute([o.start, ...targets], o.travel);
  if (o.fitKey !== fitted) {
    fitted = o.fitKey;
    fitTo(o.fitPoints || [o.start, ...remaining.slice(0, 12).map(s => s.place), ...(o.end ? [o.end] : [])].filter(Boolean));
  }
}

// No trip yet: plain pins, nothing else.
function clearRoute(kept, pinExtra) {
  $("stats").innerHTML = ""; $("links").innerHTML = ""; $("stops").innerHTML = "";
  listButton("");
  if (!navigating()) drawRoute(null);
  drawPins(kept.filter(s => !done(s)).map(s => pinOf(s, `${s.stars}★`, pinExtra(s))));
}

// ---------- Zones ----------

let racks = null, sectors = null, geoCity = null;
// Bike racks and statistical sectors (the zones' building blocks). Without a sectors file there are no
// zones; without racks the bike spot is simply the middle of the zone.
async function loadCityFiles(cityName) {
  const get = f => fetch(f).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const slug = cityName.toLowerCase();
  const [r, sc] = await Promise.all([get(`data/racks-${slug}.json`), get(`data/sectors-${slug}.json`)]);
  racks = (r?.racks || []).map(([lat, lon]) => ({ lat, lon }));
  sectors = sc?.sectors || null;
  geoCity = cityName;
}

function renderZones(kept, all) {
  const cityName = campaign().city;
  if (geoCity !== cityName) {
    $("next").innerHTML = nextCardHtml(null, "", { finished: { text: "Working out the zones…" } });
    loadCityFiles(cityName).then(render);
    return;
  }
  if (!sectors) {
    $("mode-box").innerHTML = ""; listButton(""); drawPins([]); drawZones(null);
    $("stats").innerHTML = ""; $("links").innerHTML = ""; $("stops").innerHTML = "";
    $("next").innerHTML = nextCardHtml(null, "", { finished: { text: `Zones aren't available for ${esc(cityName)} yet (no sectors file).` } });
    return;
  }
  const key = JSON.stringify([filterKey(), filters.zsize, kept.map(s => s.place.place_id)]);
  if (zonesSaved?.key !== key) zonesSaved = zonesNow(kept, key, sectors, filters.zsize);
  // An open zone belongs to one set of zones (ids are just positions): if the zones changed since,
  // or it was saved by an older version, go back to the overview rather than open some other zone.
  if (view.zone && view.zoneKey !== key) { view.zone = null; saveView(); }
  const allById = byId(all), zs = zonesSaved.zones.map(z => zoneState(z, allById));
  const z = zs.find(q => q.id === view.zone);
  if (z) return renderZone(kept, z);

  // Overview: all zones, biggest first.
  const stopsIn = zs.flatMap(q => q.stops);
  $("mode-box").innerHTML = `<div class="mode-line"><span><b>${zs.length}</b> zones · ${SIZE_NAME[filters.zsize]},
    about ${ZONE_MINUTES[filters.zsize]} min each</span></div>`;
  $("next").innerHTML = nextCardHtml(null, "", { finished: { text: zs.length
    ? "Pick a zone: tap it on the map, or open it from the list. You get a bike spot (P) in its middle and a walking loop."
    : "No stops with these filters." } });
  if (!navigating()) $("mini").textContent = `${zs.length} zones: tap one on the map`;
  $("stats").innerHTML = statsHtml([[`${stopsIn.filter(done).length}/${stopsIn.length}`, "stops done"],
    [String(zs.filter(q => q.done === q.total).length), "zones finished"], [String(zs.filter(q => q.done < q.total).length), "zones left"]]);
  $("links").innerHTML = "";
  $("list-title").textContent = "Zones (biggest first)";
  listButton(`All ${zs.length} zones`);
  $("stops").innerHTML = zs.map(zoneRowHtml).join("");
  drawPins([]); if (!navigating()) drawRoute(null);
  drawZones(zs.map(q => zoneShape(q, true)), openZone);
  const fitKey = JSON.stringify(["zones", filterKey()]); // a new zone size keeps the map where it is
  if (fitted !== fitKey) { // the 12 zones nearest to you: the whole city would make every zone tiny
    fitted = fitKey;
    const from = origin();
    fitTo([...zs].sort((a, b) => dist(from, a.centre) - dist(from, b.centre)).slice(0, 12).flatMap(q => q.stops.map(s => s.place)));
  }
}
const SIZE_NAME = { S: "Small", M: "Medium", L: "Large" };
// What the map needs of a zone: its area, its name and progress, and (on the overview) its stops as dots.
const zoneShape = (q, dots) => ({ id: q.id, name: dots ? q.name : "", rings: q.rings, centre: q.centre, mins: q.mins,
  done: q.done, total: q.total, stops: dots ? q.stops.map(s => ({ lat: +s.place.lat, lon: +s.place.lon, color: s.type.color, done: done(s) })) : [] });

function renderZone(kept, z) {
  const single = z.total === 1;
  // The bike spot: the bike rack nearest the middle of the zone's stops (or the middle itself).
  const p = single ? null : parkAt(z.stops.map(s => s.place), racks || []);
  const park = p && { lat: p.lat, lon: p.lon, label: "P" };
  zonePark = park;
  $("mode-box").innerHTML = `<div class="mode-line"><button type="button" class="btn small" data-ui="zone-back">← All zones</button>
    <span><b>${esc(z.name)}</b>${single ? "" : ` · ${z.total} stops · loop about ${z.mins} min`}</span></div>
    ${single ? "" : `<button type="button" class="btn bike" data-ui="nav-park">Bike to the P${p.rack ? " (bike rack)" : ""}</button>`}`;
  drawZones([zoneShape(z, false)], openZone); // just this zone's border, under the stops' pins
  // The way out, always in view on the map: "✕ Kouter · 5/8 left".
  $("zone-chip").textContent = `✕ ${z.name} · ${z.total - z.done}/${z.total} left`;
  $("zone-chip").hidden = false;
  renderRoute({ kept, route: single ? z.stops : orderStops(park, z.stops.map(s => s.place), park).map(p => z.stops.find(s => s.place === p)),
    scope: z.stops, start: single ? origin() : park, end: park,
    fromBikeSpot: !single,
    endLabel: "back to the P", travel: single ? filters.travel : "walk",
    heading: (k, n) => (single ? `Single stop · ${z.name}` : `Stop ${k} of ${n} · ${z.name}`),
    title: single ? "The stop" : "Walking loop, in order (back to the P at the end)", showOthers: false,
    endPins: single ? [] : [park],
    finished: single ? { text: "Done here. Pick the next zone." }
      : { text: "All stops in this zone done. Walk back to your bike.", label: "Walk back to the P", dest: { ...park, name: "your bike (P)" } },
    fitKey: JSON.stringify(["zone", z.id]), // The outline, plus the stops and the P: a stop just over the city line lies outside its sector's outline.
    fitPoints: [...z.rings.flat().map(([lat, lon]) => ({ lat, lon })), ...z.stops.map(s => s.place), park].filter(Boolean) });
}

function openZone(id) { view.zone = id; view.zoneKey = zonesSaved?.key; saveView(); closeSheet(); render(); } // close the list: show the zone on the map
function closeZone() { view.zone = null; saveView(); fitted = ""; render(); }
$("zone-chip").onclick = closeZone;

// ---------- Mode, filters and route controls ----------

$("modes").addEventListener("change", e => {
  cancelPick(); toast(""); // a "Tap the map" for the old mode no longer applies
  view.mode = e.target.value; saveView(); render();
});

function setWay(patch) {
  way = computeWayIds(stops().filter(passes), { ...way, ...patch }, filters.travel);
  store.set("way", way);
  render();
}

// Filters changed: routes that depend on them recalculate (Zones and All left notice it by their key).
function filtersChanged() {
  saveView();
  if (way.from && way.to) setWay({}); else render();
  renderFilters();
}

function renderFilters() {
  syncPreset();
  const all = stops(), counts = {};
  all.filter(s => s.stars >= +filters.min).forEach(s => { counts[s.place.type] = (counts[s.place.type] || 0) + 1; });
  $("f-event-box").hidden = !events().length;
  $("f-event").innerHTML = seg("event", events().map(e => [e, e]), currentEvent());
  $("f-travel").innerHTML = seg("travel", [["bike", "Bike"], ["walk", "On foot"]], filters.travel);
  $("f-min").innerHTML = seg("min", [["1", "All"], ["2", "★★ and up"], ["3", "★★★"]], filters.min);
  $("f-zsize").innerHTML = seg("zsize", Object.entries(SIZE_NAME), filters.zsize);
  $("f-types").innerHTML = typesHtml(boot.types, counts, skip());
  const shown = boot.types.filter(t => counts[t.type]), off = shown.filter(t => skip().has(t.type)).length;
  $("types-sum").textContent = `Types of place: ${shown.length - off} of ${shown.length} included`;
}
$("filter-btn").onclick = () => { if (!boot) return; renderFilters(); $("filters").showModal(); };
$("f-travel").addEventListener("change", e => { filters.travel = e.target.value; filtersChanged(); });
$("f-min").addEventListener("change", e => { filters.min = e.target.value; filtersChanged(); });
$("f-zsize").addEventListener("change", e => { filters.zsize = e.target.value; filtersChanged(); });
$("f-event").addEventListener("change", e => { filters.event = e.target.value; filtersChanged(); });
$("types-preset").onclick = () => { filters.skipFor = null; filtersChanged(); };
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
  toast(end === "from" ? "Tap the map where you start." : "Tap the map where you're going.", 0, { label: "Cancel", run: cancelPick });
  const p = await pickPoint();
  if (!p) return; // cancelled (or another pick took over: leave its message up)
  toast("");
  setWay({ [end]: { ...p, label: "Point on the map" } });
}

$("sheet").addEventListener("click", e => {
  const el = e.target.closest("[data-ui]");
  if (!el) return;
  const ui = el.dataset.ui;
  if (ui === "way") wayEnd(el.dataset.end, el.dataset.how);
  if (ui === "recalc") setWay({});
  if (ui === "zone-open") openZone(el.dataset.zone);
  if (ui === "nav-end" && finishedDest) beginNav(finishedDest, routeTravel);
  if (ui === "nav-park" && zonePark) beginNav({ ...zonePark, name: "the P (bike spot)" }, "bike");
  if (ui === "zone-back") closeZone();
});
$("sheet").addEventListener("change", e => {
  if (e.target.name === "budget") setWay({ budget: +e.target.value });
});

function renderSync() {
  const n = queue.items.length;
  $("sync-btn").hidden = !n;
  $("sync-btn").textContent = `${n} waiting to sync`;
  $("sync-btn").setAttribute("aria-label", `${n} change${n === 1 ? "" : "s"} waiting to sync. Tap to try now.`);
}

// ---------- Bottom sheet: min (a strip, to see the whole map), peek (the next stop), half, full ----------
// Tap the handle to open or close the list; drag it to any height and it snaps to the nearest of the four.

let snap = "peek", peekH = 300, dragged = false;
const MIN_H = 64; // the strip: handle + one line
const isOpen = to => to === "half" || to === "full";
const listVisible = () => isOpen(snap) || snap === "dragging" || window.innerWidth >= 900; // desktop: side panel
function setSheet(to) {
  const wasOpen = isOpen(snap);
  snap = to;
  $("sheet").dataset.snap = to;
  $("sheet").classList.remove("dragging");
  $("sheet-body").style.height = "";
  if (!isOpen(to)) $("sheet-body").scrollTop = 0; // closed: show the top again (mode line, card)
  $("sheet-more").hidden = !isOpen(to);
  $("sheet-toggle").setAttribute("aria-expanded", String(isOpen(to)));
  $("sheet-toggle-text").textContent = isOpen(to) ? "Hide the list" : "Show the list";
  paintListButton();
  if (!wasOpen && isOpen(to) && boot) render(); // build the list now that it shows
}
const closeSheet = () => setSheet("peek");
// The row under the card that opens the list: "All 161 stops ▾" / "Hide the list ▴". Empty text: no list, no row.
let listText = "";
function listButton(text) { listText = text; paintListButton(); }
function paintListButton() {
  const b = $("list-btn"), open = isOpen(snap);
  b.hidden = !listText;
  b.textContent = open ? "Hide the list ▴" : `${listText} ▾`;
  b.setAttribute("aria-expanded", String(open));
}
$("list-btn").onclick = () => setSheet(isOpen(snap) ? "peek" : "half");
// Tap: from the strip back to the card; from the card to the list; from the list back to the card.
$("sheet-toggle").onclick = () => { if (!dragged) setSheet(snap === "peek" ? "half" : "peek"); dragged = false; };

$("sheet-toggle").addEventListener("pointerdown", e => {
  const body = $("sheet-body"), startY = e.clientY, startH = body.offsetHeight;
  if (snap === "peek") peekH = startH;
  const full = window.innerHeight - document.querySelector(".bar").getBoundingClientRect().bottom - 8; // up to the bar
  dragged = false;
  $("sheet-toggle").setPointerCapture(e.pointerId);
  const move = ev => {
    const dy = ev.clientY - startY;
    if (!dragged && Math.abs(dy) < 8) return; // a tap, not a drag
    if (!dragged) { // the drag starts: show everything, the height decides how much you see
      if (!isOpen(snap)) { snap = "dragging"; render(); } // build the list as it comes into view
      $("sheet").dataset.snap = "dragging";
      $("sheet").classList.add("dragging");
      $("sheet-more").hidden = false;
    }
    dragged = true;
    body.style.height = `${Math.max(MIN_H, Math.min(full, startH - dy))}px`;
  };
  const up = () => {
    $("sheet-toggle").removeEventListener("pointermove", move);
    if (!dragged) return;
    const h = body.offsetHeight, targets = { min: MIN_H, peek: peekH, half: window.innerHeight * 0.62, full };
    setSheet(Object.keys(targets).reduce((a, b) => (Math.abs(targets[b] - h) < Math.abs(targets[a] - h) ? b : a)));
  };
  $("sheet-toggle").addEventListener("pointermove", move);
  $("sheet-toggle").addEventListener("pointerup", up, { once: true });
  $("sheet-toggle").addEventListener("pointercancel", up, { once: true });
});


// ---------- Results: write locally at once, send in the background ----------

const queue = createQueue({
  load: () => store.get("queue", []),
  save: items => store.set("queue", items),
  send: body => postWrite(settings.code, settings.name, body),
  onSent: (item, reply) => {
    if (item.body.action === "addPlace") { // the new place, with its id from the sheet: show it right away
      boot.places.push(reply.place); save();
      toast(`"${reply.place.name}" is added. The others see it next time their app refreshes.`);
    } else if (item.body.action === "override") { // keep it once it has left the outbox
      boot.overrides = { ...(boot.overrides || {}), [item.body.place_id]: item.body.stars };
      if (item.body.stars === "") delete boot.overrides[item.body.place_id];
      save();
    } else if (item.body.action === "swipe") {
      return; // nothing to show: the swipe is in the sheet
    } else {
      mergeResults(synced.map, [reply.result]); saveResults();
      // Tapped while offline, but a teammate saved this stop later: the server kept theirs.
      if (reply.stale) toast(`${reply.result.by} updated ${findStop(reply.result.place_id)?.place.name || "a stop"} after you: their result is kept.`, 8000);
    }
    render();
  },
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
  else if (r === "stopped") toast("Changes can't be sent: the code is not right. Check it in Settings (☰).");
  renderSync();
}

// After a result the card shows the next stop, with its buttons in the same place: a double tap would
// tick that one off too. So result buttons ignore taps for a moment, and a message says what was saved.
let quietUntil = 0;
function write(place, patch) {
  if (navTarget()?.id === place.place_id) endNav(); // a result for the place I navigated to: navigation done
  queue.add({ action: "result", campaign_id: boot.campaign_id, place_id: place.place_id,
              cycle: cycleFor(place, boardCycle()), ...patch, tapped_at: new Date().toISOString() });
  if (patch.status) {
    quietUntil = Date.now() + 800;
    const what = patch.status === "posted" ? `Posted ${patch.posters}` : STATUS_LABEL[patch.status];
    toast(`${what}: ${place.name}`, 6000, { label: "Undo", run: () => write(place, { status: "", posters: 0 }) });
  }
  render();
  flush();
}

async function markPosted(s) {
  const planned = +s.place.posters || 1;
  let n = planned;
  if (planned > 1) {
    const typed = await ask(`${s.place.name}: how many posters did you hang?`, { value: planned });
    if (typed === null) return;
    n = parseInt(typed, 10);
    n = Number.isNaN(n) ? planned : Math.max(0, n); // an empty box means "as planned", not 0
  }
  write(s.place, { status: "posted", posters: n });
}

async function markOther(s, status) { // not possible, refused, full, closed, come back later
  const msg = status === "nope" ? `${s.place.name}: not possible. Reason (optional):` : `${STATUS_LABEL[status]}. Note (optional):`;
  const note = await ask(msg, { value: s.res?.note || "", ok: "Save", cancel: "Cancel" });
  if (note === null) return; // Cancel or Escape: nothing saved (the reason is optional, Save with an empty box)
  write(s.place, { status, posters: 0, note: note.trim() });
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
  const act = el.dataset.act;
  if ((act === "posted" || act === "nope") && Date.now() < quietUntil) return; // a double tap (see write)
  closePopup();
  if (act === "posted") await markPosted(s);
  if (act === "nope") await markOther(s, "nope");
  if (act === "undo") write(s.place, { status: "", posters: 0 });
  if (act === "note") await editNote(s);
  if (act === "nav") beginNav({ lat: +s.place.lat, lon: +s.place.lon, name: s.place.name, id: s.place.place_id }, routeTravel);
  if (act === "from" || act === "to") setWay({ [act]: { lat: +s.place.lat, lon: +s.place.lon, label: s.place.name } });
  if (act === "ovr") { // admin: set this place's stars for the campaign
    const n = el.dataset.stars === "" ? "" : +el.dataset.stars; // "" = clear: back to the learned/type stars
    queue.add({ action: "override", campaign_id: boot.campaign_id, place_id: s.place.place_id, stars: n });
    toast(n === "" ? `${s.place.name}: back to its own stars.` : `${s.place.name}: ${n}★ for this campaign.`, 4000);
    render(); flush();
  }
}

// Admins: under every pop-up, "Stars for AI Safety: 0 1 2 3" to fix a place directly (wins over everything).
setPopupExtra(s => {
  if (settings?.role !== "admin") return "";
  const cur = overrides()[s.place.place_id];
  return `<div class="ovr">Stars for ${esc(currentEvent() || "this event")}:<div class="ovr-btns">${[0, 1, 2, 3].map(n =>
    `<button type="button" class="popbtn alt${cur === n ? " on" : ""}" data-act="ovr" data-stars="${n}" data-id="${esc(s.place.place_id)}"
      aria-label="${n} stars">${n}</button>`).join("")}${cur === undefined ? ""
      : `<button type="button" class="popbtn alt" data-act="ovr" data-stars="" data-id="${esc(s.place.place_id)}">Clear</button>`}</div></div>`;
});
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
$("sync-btn").onclick = async () => {
  await flush();
  if (queue.items.length) toast(navigator.onLine ? "The server isn't answering yet. The app keeps trying."
    : "No connection. The app sends your changes as soon as you're back online.");
};

let adding = false; // one "Add place" at a time: a double tap would otherwise add the place twice
$("add-btn").onclick = async () => {
  if (adding || !boot) return;
  if (!campaign()) return toast("No active campaign: the organiser can set one to active in the sheet.");
  closePopup(); closeSheet();
  adding = true;
  const body = await addPlace({ types: boot.types, campaign: campaign(), event: currentEvent(), places: boot.places }).finally(() => { adding = false; });
  if (!body) return;
  // ponytail: if the answer is lost after the sheet saved the place, a retry adds it twice; delete the copy in the sheet.
  queue.add(body);
  toast(navigator.onLine ? "Saving the place…" : "Saved on this phone; it will be sent when you're back online.");
  flush();
};

// ---------- Polling: see the other volunteers' ticks ----------

let polling = false;
async function poll() {
  if (polling || document.hidden || !settings?.code || !boot?.campaign_id) return;
  polling = true;
  try {
    // Ask from a minute before the last answer: a write that landed while that answer was being made
    // could otherwise slip through. Getting a row twice is harmless (last write wins).
    const since = new Date(Date.parse(synced.serverTime) - 60000).toISOString();
    const r = await fetchResults(settings.code, since);
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
// Results every 30 s; everything (so also places other volunteers added) every 5 minutes and when the
// app comes back on screen.
let ticks = 0;
setInterval(() => (++ticks % 10 === 0 ? refresh() : poll()), 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && settings?.code) refresh(); });
window.addEventListener("focus", poll);
window.addEventListener("online", flush);

// ---------- Settings and loading ----------

// Take a (fresh or saved) bootstrap answer: reset results when the campaign changed, then merge.
function useBoot(recentre) {
  const cleaned = cleanBoot(boot);
  boot = cleaned.boot;
  if (cleaned.skipped.length) console.warn("Places left out (fix them in the sheet):\n" + cleaned.skipped.join("\n"));
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
  const before = settings;
  ({ settings, boot } = await setup(settings || {}, boot));
  if (settings === before) return; // cancelled
  save();
  useBoot(true);
  flush();
}

// Fetch fresh data in the background; the saved copy is already on screen.
async function refresh(loud = false) { // loud: say so when offline (only at start, not every 5 minutes)
  try {
    boot = await bootstrap(settings.code);
    settings.role = boot.role; // the organiser may change a code's role in the sheet
    save();
    useBoot(false);
    flush();
  } catch (e) {
    if (!(e instanceof BackendError)) throw e;
    if (e.offline) { if (loud) toast("Offline: showing the data saved on this phone."); }
    else toast(e.message);
    if (e.stop) openSettings(); // the code was changed or the campaign closed: ask for the new one
  }
}

// ---------- Live location ----------

const LOW_ACCURACY = 100; // metres: above this, say the blue dot may be off
let follow = false, locationStarted = false, lastRenderFrom = null;
let blocked = false, lowHidden = false; // location permission refused; "Hide" tapped on the low-accuracy note

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
  setTimeout(() => { if (!lastPosition() && !blocked)
    locMessage("No location fix yet. Step outside or wait a moment."); }, 15000);
  watchWhileVisible(pos => {
    blocked = false;
    setMe(pos);
    navUpdate(pos);
    const rough = pos.accuracy > LOW_ACCURACY;
    if (!rough) lowHidden = false;
    locMessage(rough && !lowHidden ? `Low accuracy (±${pos.accuracy} m): the blue dot may be off.` : "");
    // "Nearest stop" depends on where I am: re-sort after moving 50 m or more. A rough fix doesn't count,
    // and neither does drift within the fix's own accuracy: the card shouldn't change while you read it.
    if (!lastRenderFrom || (!rough && dist(lastRenderFrom, pos) > Math.max(50, pos.accuracy))) { lastRenderFrom = pos; render(); }
  }, (code, msg) => {
    if (code === 2 && lastPosition()) return; // a short GPS hiccup: keep showing the last position
    if (code === 1) blocked = true;
    locMessage(msg, { bad: true, retry: code === 1 });
  });
}

function setFollowing(on, zoom) {
  follow = on;
  $("follow-btn").setAttribute("aria-pressed", String(on));
  setFollow(on, lastPosition(), zoom);
  if (on && !lastPosition() && !blocked) locMessage("Waiting for your location…");
}
$("follow-btn").onclick = () => setFollowing(!follow);
onUserPan(() => { if (follow) setFollowing(false); }); // panning by hand means "let me look around"
$("loc-hide").onclick = () => { lowHidden = true; locMessage(""); };
$("loc-retry").onclick = () => { locMessage("Finding your location…"); restartWatching(); };

// ---------- In-app navigation ----------


function beginNav(dest, travel) {
  if (blocked) return toast("Location is blocked, so the app can't guide you. Use the Google Maps link instead.", 8000);
  closePopup();
  setSheet("min");                 // the whole screen for the map
  drawRoute(null);                 // the trip's line makes way for the route to this place
  startLocation();
  setFollowing(true, 17);
  startNav(dest, travel, lastPosition());
}
function endNav() {
  stopNav();
  setFollowing(false);             // follow-me was for the navigation: the map is yours again
  render();                        // the trip's line comes back
}

onNavChange(st => {
  $("nav").hidden = !st;
  if (!st) return;
  // Arrived somewhere that isn't a stop (the bike spot, home, your destination): nothing to tick off,
  // so navigation simply ends and the trip's line comes back (e.g. the zone's walking loop).
  if (st.arrived && !st.id) { toast(`You're at ${st.name}.`); return endNav(); }
  $("nav-to").textContent = st.arrived ? `You're at ${st.name}` : `To ${st.name}`;
  $("nav-left").textContent = st.waiting ? "Waiting for your location…"
    : st.arrived ? "" : `${distText(st.metres)} · ${st.mins < 1 ? "<1" : Math.round(st.mins)} min`;
  $("nav").classList.toggle("arrived", !!st.arrived);
  $("mini").textContent = `${st.arrived ? "Arrived" : $("nav-left").textContent} · ${st.name}`;
  // Arrived at a stop: tick it off right here. Built only when that changes, not on every GPS fix:
  // rebuilding the buttons under a finger would swallow the tap.
  const target = st.id && findStop(st.id);
  // (A teammate may have ticked it off meanwhile: then there's nothing left to tap.)
  const acts = st.arrived && target && !done(target)
    ? `<button type="button" class="done" data-act="posted" data-id="${esc(st.id)}">Posted ✓</button>
       <button type="button" data-act="nope" data-id="${esc(st.id)}">Can't ✗</button>` : "";
  if ($("nav-acts").dataset.html !== acts) { $("nav-acts").innerHTML = acts; $("nav-acts").dataset.html = acts; }
  // The zoom buttons and the sync chip move down below the banner (its height changes on arrival).
  document.body.style.setProperty("--nav-h", `${$("nav").offsetHeight}px`);
});
$("nav").addEventListener("click", onAction);
$("nav-stop").onclick = endNav;

// ---------- Start ----------

// ☰: volunteers go straight to Settings; admins choose between Settings and "Train the stars".
$("menu-btn").onclick = () => {
  if (settings?.role !== "admin") return openSettings();
  const d = $("menu-dlg");
  d.returnValue = "";
  d.showModal();
  d.addEventListener("close", () => { if (d.returnValue === "train") startTrain(); if (d.returnValue === "settings") openSettings(); }, { once: true });
};

// A location line for a swipe card, so look-alike places (city boards) can be told apart:
// "Overpoort · 80 m from Campus Ufo" (the sector, and the nearest place that isn't a city board).
function describe(p) {
  const sector = sectors ? sectors[sectorOf(p, sectors)].name : "";
  const best = nearest(p, boot.places, { max: 300, skip: q => q.place_id === p.place_id || q.type === "boards" });
  const near = best && (best.m < 25 ? `next to ${best.item.name}` : `${distText(best.m)} from ${best.item.name}`);
  return [sector, near].filter(Boolean).join(" · ");
}
async function startTrain() {
  if (geoCity !== campaign().city) await loadCityFiles(campaign().city); // the sectors, for the location lines
  openTrain({ campaignId: boot.campaign_id, event: currentEvent(), name: settings.name, places: boot.places, types: boot.types,
    swipes: boot.swipes, describe, send: body => { queue.add({ ...body, campaign_id: boot.campaign_id }); flush(); } });
}

if (settings?.code && boot) { useBoot(true); refresh(true); startLocation(); }
else openSettings().then(startLocation);

// Offline support (sw.js). Browsers allow this only on https:// and localhost.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* app still works online */ });
