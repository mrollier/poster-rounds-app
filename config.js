// Public settings of the app. This file is in the public repo: never put a secret here.
// (The team code and your home location live only in your phone's localStorage.)
export const CONFIG = {
  // The Apps Script web-app URL (Deploy > Manage deployments, ends in /exec).
  // On port 8787 the app talks to the local mock backend instead (node tests/mock-server.js).
  APPS_SCRIPT_URL: location.port === "8787" ? "/exec" : "PASTE_YOUR_APPS_SCRIPT_URL_HERE",

  // Base map tiles. OSM's own server is fine for a handful of volunteers (OSM tile usage policy).
  // Alternative if needed: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" with
  // attribution '&copy; OpenStreetMap contributors &copy; CARTO'.
  TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  TILE_ATTRIBUTION: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

  // Optional: campaign_id to preselect when more than one campaign is active.
  DEFAULT_CAMPAIGN: "",
};
