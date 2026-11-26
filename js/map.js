// The Leaflet map: base tiles, place pins, the home marker, and "tap a point on the map".
// Leaflet is loaded as a classic <script> (vendor/leaflet), so it is the global `L`.
import { CONFIG } from "../config.js";
import { route } from "./router.js";

const L = window.L;
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let map, placesLayer, homeMarker;

export function initMap(el) {
  map = L.map(el, { zoomControl: false, attributionControl: true }).setView([51.0543, 3.7174], 13);
  L.control.zoom({ position: "topright" }).addTo(map);
  // crossOrigin: fetch tiles as CORS images, so the service worker can store them compactly for offline use
  // (other ways, browsers count every stored tile as several MB).
  L.tileLayer(CONFIG.TILE_URL, { maxZoom: 19, attribution: CONFIG.TILE_ATTRIBUTION, crossOrigin: "anonymous" }).addTo(map);
  map.attributionControl.addAttribution(CONFIG.ROUTER_ATTRIBUTION);
  placesLayer = L.layerGroup().addTo(map);
  return map;
}

export function showCity(city) {
  if (city) map.setView([+city.centre_lat, +city.centre_lon], +city.zoom || 13);
}

// A round coloured pin; `text` goes inside (priority now, stop number later).
const pinIcon = (color, text, cls = "") => L.divIcon({
  className: "", iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -12],
  html: `<div class="pin ${cls}" style="background:${color}">${esc(text)}</div>`,
});

// pins: [{lat, lon, color, label, cls, title, popup (HTML), z}]. Redrawn only when something changed,
// so a popup you are reading doesn't close every time the app checks for news.
let lastPins = "";
export function drawPins(pins) {
  const sig = JSON.stringify(pins);
  if (sig === lastPins) return;
  lastPins = sig;
  placesLayer.clearLayers();
  for (const p of pins) {
    // keyboard: false keeps 200 pins out of the Tab order; the list has every stop with the same buttons.
    // The autopan padding keeps an opened popup clear of the top bar and the zoom buttons.
    L.marker([p.lat, p.lon], { icon: pinIcon(p.color, p.label, p.cls), title: p.title, zIndexOffset: p.z || 0, keyboard: false })
      .bindPopup(p.popup, { minWidth: 220, autoPanPaddingTopLeft: [12, 70], autoPanPaddingBottomRight: [60, 12] }).addTo(placesLayer);
  }
}

export const closePopup = () => map.closePopup();

export function setHome(home) {
  homeMarker?.remove();
  homeMarker = home ? L.marker([home.lat, home.lon], { icon: pinIcon("", "⌂", "home"), title: "Home", zIndexOffset: 2000 })
    .bindPopup("Home").addTo(map) : null;
}

// Wait for one tap on the map; resolves {lat, lon} rounded to ~10 cm.
// Wait for one tap on the map: resolves {lat, lon}, or null when cancelled (cancelPick, or a new pick).
let endPick = null;
export function pickPoint() {
  cancelPick(); // only one pick at a time: a second "Tap on the map" replaces the first
  return new Promise(resolve => {
    const done = value => {
      map.off("click", onTap);
      map.getContainer().classList.remove("picking");
      endPick = null;
      resolve(value);
    };
    const onTap = e => done({ lat: +e.latlng.lat.toFixed(6), lon: +e.latlng.lng.toFixed(6) });
    map.getContainer().classList.add("picking");
    map.on("click", onTap);
    endPick = () => done(null);
  });
}
export const cancelPick = () => endPick?.();

// ---------- Me: blue dot, accuracy circle, follow-me ----------

let meDot, meCircle, following = false;

// The blue dot lives in its own pane above the pins, so it is never hidden under a stop.
// The accuracy circle stays below the pins, so it never blocks a tap on one.
function mePane() {
  if (!map.getPane("me")) map.createPane("me").style.zIndex = 650; // pins 600, popups 700
  return "me";
}

export function setMe(pos) {
  if (!pos) return;
  const ll = [pos.lat, pos.lon];
  if (!meDot) {
    meCircle = L.circle(ll, { radius: pos.accuracy, color: "#1a73e8", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
    meDot = L.circleMarker(ll, { pane: mePane(), radius: 9, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 })
      .bindPopup("You are here").addTo(map);
  }
  meDot.setLatLng(ll);
  meCircle.setLatLng(ll).setRadius(pos.accuracy);
  // Keep the zoom you chose (you may have zoomed out to look ahead); only the first fix after
  // switching follow on zooms in.
  if (following) { map.setView(ll, zoomIn ? Math.max(map.getZoom(), zoomIn) : map.getZoom()); zoomIn = 0; }
}

// Follow-me: keep the map centred on the blue dot. Dragging the map yourself switches it off.
let zoomIn = 0;
export function setFollow(on, pos, zoom = 16) {
  following = on;
  zoomIn = on && !pos ? zoom : 0; // no position yet: zoom in when the first one comes
  if (on && pos) map.setView([pos.lat, pos.lon], Math.max(map.getZoom(), zoom));
}
export function onUserPan(cb) { map.on("dragstart", cb); }

// ---------- Route line and zones ----------

let routeLine = null, routeSig = "", navLine = null, zonesLayer = null, lastZones = "";

// A line along the streets: dark with a white edge, so it shows on any tile. `straight`: a dashed
// straight line instead, while the real route is on its way (or when offline).
function line(coords, straight) {
  if (straight) return L.polyline(coords, { color: "#1b5266", weight: 3, opacity: .8, dashArray: "6 8", interactive: false });
  return L.layerGroup([
    L.polyline(coords, { color: "#fff", weight: 9, opacity: .9, interactive: false }),
    L.polyline(coords, { color: "#1b5266", weight: 5, opacity: .95, interactive: false }),
  ]);
}

// The trip through its stops, by bike or on foot. points: [{lat, lon}] or null.
// Drawn straight at once, then replaced by the real route when the route server answers.
export function drawRoute(points, travel = "bike") {
  const sig = JSON.stringify([points, travel]);
  if (sig === routeSig) return; // unchanged: don't flicker on every refresh
  routeSig = sig;
  routeLine?.remove();
  routeLine = null;
  if (!points || points.length < 2) return;
  routeLine = line(points.map(p => [+p.lat, +p.lon]), true).addTo(map);
  route(points, travel).then(r => {
    if (!r || sig !== routeSig) return; // offline, or a newer trip was drawn meanwhile
    routeLine.remove();
    routeLine = line(r.coords, false).addTo(map);
  });
}

// Navigation's own line (coords [[lat, lon]]), or null to remove it.
export function drawNavLine(coords, straight = false) {
  navLine?.remove();
  navLine = coords ? line(coords, straight).addTo(map) : null;
}

// Zoom the map so all these points fit (used when you switch mode or open a zone, not on every tick).
// The bar and the sheet cover part of the map, so leave room for them.
export function fitTo(points) {
  if (!points.length) return;
  const sheet = document.getElementById("sheet").getBoundingClientRect(), side = sheet.width < window.innerWidth;
  map.fitBounds(L.latLngBounds(points.map(p => [+p.lat, +p.lon])), {
    paddingTopLeft: [side ? sheet.width + 30 : 30, 80], paddingBottomRight: [60, side ? 30 : Math.min(sheet.height, window.innerHeight * .6) + 10], maxZoom: 16 });
}

// Zones overview: each zone's stops as soft dark patches, and a numbered square badge in the middle.
// zones: [{id, number, name, centre, stops: [{lat, lon, color, done}], done, total, mins}], onOpen(id)
export function drawZones(zones, onOpen) {
  const sig = JSON.stringify(zones);
  if (zonesLayer && sig === lastZones) return;
  lastZones = sig;
  zonesLayer?.remove();
  zonesLayer = null;
  if (!zones) return;
  zonesLayer = L.layerGroup().addTo(map);
  for (const z of zones) {
    const open = () => onOpen(z.id), finished = z.done === z.total;
    if (z.total === 1) { // a single stop is just a pin
      const s = z.stops[0];
      L.marker([s.lat, s.lon], { icon: pinIcon(s.done ? "#8a8a8a" : s.color, "", s.done ? "faded" : ""), title: z.name })
        .on("click", open).addTo(zonesLayer);
      continue;
    }
    for (const s of z.stops) {
      L.circle([s.lat, s.lon], { radius: 70, stroke: false, fillColor: "#1f2933", fillOpacity: s.done ? .05 : .16 }).on("click", open).addTo(zonesLayer);
      L.circleMarker([s.lat, s.lon], { radius: 5, weight: 1, color: "#000", fillColor: s.done ? "#bbb" : s.color, fillOpacity: 1 })
        .on("click", open).addTo(zonesLayer);
    }
    L.marker([z.centre.lat, z.centre.lon], {
      zIndexOffset: finished ? 0 : 2000, title: `${z.number}. ${z.name}: ${z.done}/${z.total} done, about ${z.mins} min`,
      icon: L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15],
        html: `<div class="pin zonepin${finished ? " faded" : ""}" style="background:${z.color}">${finished ? "✓" : z.number}</div>
               <span class="zonelbl">${esc(z.name)}<small>${z.done ? `${z.done}/${z.total} done` : `${z.total} stops`} · ${z.mins} min</small></span>` }),
    }).on("click", open).addTo(zonesLayer);
  }
}

// Zone names only from zoom 15: further out they would cover each other.
export function zoneLabelsFromZoom(z) {
  const toggle = () => map.getContainer().classList.toggle("show-zlbl", map.getZoom() >= z);
  map.on("zoomend", toggle); toggle();
}
