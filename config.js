// Public settings of the app. This file is in the public repo: never put a secret here.
// (The team code and your home location live only in your phone's localStorage.)
export const CONFIG = {
  // The Apps Script web-app URL (Deploy > Manage deployments, ends in /exec).
  // On ports 8787–8799 the app talks to the local mock backend instead (node tests/mock-server.js;
  // PORT=8791 node tests/mock-server.js runs a second one, e.g. for parallel tests).
  APPS_SCRIPT_URL: +location.port >= 8787 && +location.port <= 8799 ? "/exec" : "https://script.google.com/macros/s/AKfycbz2OdJfkKGAYyrwUiM1fqDzsIXVYUMOwVwSm38iH5rZnglcqRndjoAY_xytRt9nMsZU/exec",

  // Base map tiles. OSM's own server is fine for a handful of volunteers (OSM tile usage policy).
  // Alternative if needed: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" with
  // attribution '&copy; OpenStreetMap contributors &copy; CARTO'.
  TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  TILE_ATTRIBUTION: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

  // Real routes by bike ({profile} = bike) or on foot (foot): the free OSRM server of FOSSGIS, OpenStreetMap data.
  // Fine for a handful of volunteers; no key. (The "driving" in the address is just OSRM's fixed word.)
  ROUTER_URL: "https://routing.openstreetmap.de/routed-{profile}/route/v1/driving/",
  ROUTER_ATTRIBUTION: 'Routes: <a href="https://routing.openstreetmap.de/about.html">FOSSGIS OSRM</a>',

  // Optional: campaign_id to preselect when more than one campaign is active.
  DEFAULT_CAMPAIGN: "",
};
