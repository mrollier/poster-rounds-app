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

// places: [{place, prio}], types: {type: {label, color}}
export function drawPlaces(items, types) {
  placesLayer.clearLayers();
  for (const { place: p, prio } of items) {
    const t = types[p.type] || { label: p.type, color: "#444" };
    L.marker([+p.lat, +p.lon], { icon: pinIcon(t.color, prio), title: p.name, zIndexOffset: (4 - prio) * 100 })
      .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.address)}<br>${esc(t.label)} · priority ${prio}<br>
        ${esc(p.posters)} poster${p.posters == 1 ? "" : "s"}, ${p.access === "ask" ? "ask first" : "hang freely"}`)
      .addTo(placesLayer);
  }
}

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
