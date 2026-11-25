// Screens and small widgets: the setup form (first run + Settings) and the toast message.
import { bootstrap } from "./data.js";
import { pickPoint, setHome, showCity, esc } from "./map.js";
import { currentPosition } from "./location.js";
import { CONFIG } from "../config.js";

export const $ = id => document.getElementById(id);

let toastTimer;
export function toast(msg, ms = 5000) {
  const el = $("toast");
  el.textContent = msg; el.hidden = !msg;
  clearTimeout(toastTimer);
  if (msg && ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Show the setup form and resolve {settings, boot} once the code is checked and the user taps Start/Save.
// settings: {name, code, home: {lat, lon} | null, campaign}. With a saved code it opens as "Settings";
// `saved` is the last bootstrap answer, so Save without changes needs no network.
export function setup(settings, saved = null) {
  const form = $("setup"), part2 = $("setup-part2"), err = $("setup-error"), go = $("setup-go");
  const editing = !!settings.code;
  let home = settings.home || null, boot = editing ? saved : null, checkedCode = boot ? settings.code : null;

  $("f-name").value = settings.name || "";
  $("f-code").value = settings.code || "";
  part2.hidden = !editing;
  go.textContent = editing ? "Save" : "Continue";
  err.hidden = true;
  form.hidden = false;
  const showHome = () => {
    $("home-state").textContent = home ? `Home is set (${home.lat.toFixed(4)}, ${home.lon.toFixed(4)}).` : "No home set.";
    setHome(home);
  };
  showHome();
  const fail = msg => { err.textContent = msg; err.hidden = !msg; };

  // Fill the campaign list when more than one campaign is active.
  const showCampaigns = () => {
    const list = boot.campaigns;
    $("campaign-pick").hidden = list.length < 2;
    $("f-campaign").innerHTML = list.map(c =>
      `<option value="${esc(c.campaign_id)}" ${c.campaign_id === boot.campaign_id ? "selected" : ""}>${esc(c.name)} (${esc(c.event_date)})</option>`).join("");
  };
  if (boot) showCampaigns();

  $("home-gps").onclick = async () => {
    fail(""); $("home-state").textContent = "Finding your location…";
    try { home = await currentPosition(); delete home.accuracy; } catch (e) { fail(e.message); }
    showHome();
  };
  $("home-tap").onclick = async () => {
    form.hidden = true;
    toast("Tap your home on the map.", 0);
    home = await pickPoint();
    toast("");
    form.hidden = false;
    showHome();
  };
  $("home-clear").onclick = () => { home = null; showHome(); };

  return new Promise(resolve => {
    form.onsubmit = async e => {
      e.preventDefault();
      const name = $("f-name").value.trim(), code = $("f-code").value.trim();
      if (!name) return fail("Please fill in your first name.");
      if (!code) return fail("Please fill in the team code.");
      const wanted = part2.hidden ? (settings.campaign || CONFIG.DEFAULT_CAMPAIGN) : $("f-campaign").value;
      go.disabled = true; fail("");
      try {
        // Check the code (and load the chosen campaign) with a bootstrap call; repeat only if something changed.
        if (!boot || code !== checkedCode || (wanted && wanted !== boot.campaign_id)) {
          go.textContent = "Checking…";
          boot = await bootstrap(code, wanted);
          checkedCode = code;
          // centre on the campaign's city, so "Tap on the map" for home starts in the right place
          const c = boot.campaigns.find(x => x.campaign_id === boot.campaign_id);
          showCity(boot.cities.find(x => x.city === c?.city));
        }
      } catch (ex) {
        go.disabled = false; go.textContent = part2.hidden ? "Continue" : editing ? "Save" : "Start";
        return fail(ex.message);
      }
      go.disabled = false;
      showCampaigns();
      if (part2.hidden) { part2.hidden = false; go.textContent = "Start"; return; } // first run: now ask home + campaign
      form.hidden = true;
      resolve({ settings: { name, code, home, campaign: boot.campaign_id }, boot });
    };
  });
}
