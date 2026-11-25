// Entry point: loads saved settings, runs the setup when needed, and draws the map.
import { store, bootstrap, BackendError } from "./data.js";
import { initMap, showCity, drawPlaces, setHome, esc } from "./map.js";
import { setup, toast, $ } from "./ui.js";
import { priority } from "./logic.js";

initMap($("map"));

let settings = store.get("settings", null); // {name, code, home, campaign}
let boot = store.get("boot", null);         // last bootstrap answer, so the app opens without network

function save() { store.set("settings", settings); store.set("boot", boot); }

// Everything that depends on the bootstrap data.
function show(recentre) {
  const campaign = boot.campaigns.find(c => c.campaign_id === boot.campaign_id);
  if (!campaign) {
    $("summary").innerHTML = "<p>No active campaign. The organiser can set one to active in the sheet.</p>";
    return;
  }
  const city = boot.cities.find(c => c.city === campaign.city);
  const types = Object.fromEntries(boot.types.map(t => [t.type, t]));
  const items = boot.places.map(place => ({ place, prio: priority(place, campaign) })).filter(x => x.prio);

  $("campaign-name").textContent = campaign.name;
  drawPlaces(items, types);
  setHome(settings.home);
  if (recentre) showCity(city);

  const n = p => items.filter(x => x.prio === p).length;
  $("summary").innerHTML = `<p><b>${items.length} places</b> for ${esc(campaign.name)}:
    ${n(1)} priority 1, ${n(2)} priority 2, ${n(3)} priority 3.</p>`;
}

async function openSettings() {
  ({ settings, boot } = await setup(settings || {}, boot));
  save();
  show(true);
}

// Fetch fresh data in the background; the saved copy is already on screen.
async function refresh() {
  try {
    boot = await bootstrap(settings.code, settings.campaign);
    settings.campaign = boot.campaign_id;
    save();
    show(false);
  } catch (e) {
    if (!(e instanceof BackendError)) throw e;
    toast(e.message.startsWith("Can't reach") ? "Offline: showing the data saved on this phone." : e.message);
    if (/team code/.test(e.message)) openSettings(); // the code was changed: ask for the new one
  }
}

$("menu-btn").onclick = openSettings;

if (settings?.code && boot) { show(true); refresh(); }
else openSettings();
