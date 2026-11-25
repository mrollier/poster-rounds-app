// The Leaflet map: base tiles, place pins, the home marker, and "tap a point on the map".
// Leaflet is loaded as a classic <script> (vendor/leaflet), so it is the global `L`.
import { CONFIG } from "../config.js";

const L = window.L;
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let map, placesLayer, homeMarker;

export function initMap(el) {
  map = L.map(el, { zoomControl: false, attributionControl: true }).setView([51.0543, 3.7174], 13);
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer(CONFIG.TILE_URL, { maxZoom: 19, attribution: CONFIG.TILE_ATTRIBUTION }).addTo(map);
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
    L.marker([p.lat, p.lon], { icon: pinIcon(p.color, p.label, p.cls), title: p.title, zIndexOffset: p.z || 0 })
      .bindPopup(p.popup, { minWidth: 220 }).addTo(placesLayer);
  }
}

export const closePopup = () => map.closePopup();

export function setHome(home) {
  homeMarker?.remove();
  homeMarker = home ? L.marker([home.lat, home.lon], { icon: pinIcon("", "⌂", "home"), title: "Home", zIndexOffset: 2000 })
    .bindPopup("Home").addTo(map) : null;
}

// Wait for one tap on the map; resolves {lat, lon} rounded to ~10 cm.
export function pickPoint() {
  return new Promise(resolve => {
    map.getContainer().classList.add("picking");
    map.once("click", e => {
      map.getContainer().classList.remove("picking");
      resolve({ lat: +e.latlng.lat.toFixed(6), lon: +e.latlng.lng.toFixed(6) });
    });
  });
}

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
  if (following) map.setView(ll, Math.max(map.getZoom(), 16)); // also zooms in on the first fix
}

// Follow-me: keep the map centred on the blue dot. Dragging the map yourself switches it off.
export function setFollow(on, pos) {
  following = on;
  if (on && pos) map.setView([pos.lat, pos.lon], Math.max(map.getZoom(), 16));
}
export function onUserPan(cb) { map.on("dragstart", cb); }

// ---------- Route line and zones ----------

let routeLine = null, zonesLayer = null, lastZones = "";

// A dashed line through the trip, so you can see the order at a glance. points: [{lat, lon}] or null.
export function drawRoute(points) {
  routeLine?.remove();
  routeLine = points && points.length > 1
    ? L.polyline(points.map(p => [+p.lat, +p.lon]), { color: "#000", weight: 3, opacity: .7, dashArray: "6 8", interactive: false }).addTo(map)
    : null;
}

// Zoom the map so all these points fit (used when you switch mode or open a zone, not on every tick).
// The bar and the sheet cover part of the map, so leave room for them.
export function fitTo(points) {
  if (!points.length) return;
  const sheet = document.getElementById("sheet").getBoundingClientRect(), side = sheet.width < window.innerWidth;
  map.fitBounds(L.latLngBounds(points.map(p => [+p.lat, +p.lon])), {
    paddingTopLeft: [side ? sheet.width + 30 : 30, 80], paddingBottomRight: [60, side ? 30 : Math.min(sheet.height, window.innerHeight * .45) + 20], maxZoom: 16 });
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
