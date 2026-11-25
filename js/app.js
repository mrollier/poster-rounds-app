// Entry point: loads saved settings, runs the setup when needed, and draws the map.
import { store, bootstrap, BackendError } from "./data.js";
import { initMap, showCity, drawPlaces, setHome, setMe, setFollow, onUserPan, esc } from "./map.js";
import { watchWhileVisible, restartWatching, lastPosition } from "./location.js";
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

// ---------- Live location ----------

const LOW_ACCURACY = 100; // metres: above this, say the blue dot may be off
let follow = false, locationStarted = false;

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

if (settings?.code && boot) { show(true); refresh(); startLocation(); }
else openSettings().then(startLocation);
