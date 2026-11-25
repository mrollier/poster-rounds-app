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
