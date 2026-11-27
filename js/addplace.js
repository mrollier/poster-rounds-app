// "+ Add place": pick the position (my GPS fix or a tap on the map), fill a short form, and hand back
// the request for the backend. Sending goes through the same outbox as results, so it works offline too.
import { $, toast, ask } from "./ui.js";
import { pickPoint, cancelPick, esc } from "./map.js";
import { lastPosition } from "./location.js";
import { stars, eventWeights, starText } from "./logic.js";
import { seg } from "./views.js";
import { hav } from "./geo.js";

const POOR_FIX = 50; // metres: warn when the GPS position is this uncertain
const INSIDE = 60;   // metres: a place this close may be the building you're in (a faculty, a library)

// The place nearest to `p` within INSIDE metres, or null.
function nearestPlace(p, places) {
  let best = null;
  for (const q of places) if (hav(p, q) <= INSIDE && (!best || hav(p, q) < hav(p, best))) best = q;
  return best;
}

async function choosePosition() {
  const here = lastPosition();
  if (here) {
    const choice = await ask(`Where is the place? Your GPS position is accurate to about ${here.accuracy} m.`
      + (here.accuracy > POOR_FIX ? " That's rough: tapping the map may be better." : ""),
      { ok: "Use my position", cancel: "Tap on the map" });
    if (choice) return { lat: here.lat, lon: here.lon, source: "gps", text: `Your GPS position (±${here.accuracy} m).` };
  }
  toast("Tap the map where the place is.", 0, { label: "Cancel", run: cancelPick });
  const p = await pickPoint();
  if (!p) return null; // cancelled (or another pick took over: leave its message up)
  toast("");
  return { ...p, source: "tap", text: "The point you tapped on the map." };
}

// Resolves the addPlace request body, or null when cancelled. places: the campaign's places, to offer
// "a poster board inside <the place you're at>" (the real ad valvas board in a faculty, say).
export async function addPlace({ types, campaign, event, places = [] }) {
  const where = await choosePosition();
  if (!where) return null; // cancelled
  const near = nearestPlace(where, places);
  const inside = near && await ask(`Is it a poster board inside ${near.name}?`, { ok: "Yes, inside it", cancel: "No, a new place" }) ? near : null;
  const d = $("add-dlg");
  $("add-form").reset();
  $("add-where").textContent = `Position: ${where.text}`;
  // No type picked yet: otherwise a hurried volunteer adds every place as the first type (city boards).
  $("a-type").innerHTML = `<option value="">Choose…</option>` + types.map(t => `<option value="${esc(t.type)}">${esc(t.label)}</option>`).join("");
  // Inside a place: same type and address, and the note says where inside.
  if (inside) { $("a-name").value = `${inside.name} – poster board`; $("a-type").value = inside.type; }
  $("a-notes").placeholder = inside ? "Where inside? e.g. ground floor, left of the lift" : "e.g. notice board left of the entrance";
  $("a-imp").innerHTML = seg("imp", [[1, "★"], [2, "★★"], [3, "★★★"]], 2);
  $("a-access").innerHTML = seg("access", [["ask", "Ask first"], ["free", "Hang freely"]], "ask");
  $("a-error").hidden = true;

  // The line under the form shows the stars the place gets for the kind of event you plan for now.
  const weights = eventWeights(types, event);
  const val = name => d.querySelector(`input[name=${name}]:checked`)?.value;
  const update = () => {
    const n = stars({ type: $("a-type").value, importance: val("imp") }, weights);
    $("a-prio").textContent = `${event ? `For ${event} events` : "Importance"}: ${starText(n)}`;
  };
  d.oninput = () => { $("a-error").hidden = true; update(); };
  update();

  d.showModal();
  for (;;) {
    const result = await new Promise(res => d.addEventListener("close", () => res(d.returnValue), { once: true }));
    if (result !== "ok") return null;
    const name = $("a-name").value.trim();
    const missing = !name ? "Please give the place a name." : !$("a-type").value ? "Please choose the type of place." : "";
    if (!missing) {
      return {
        action: "addPlace", campaign_id: campaign.campaign_id, city: campaign.city, place_name: name,
        type: $("a-type").value, tags: $("a-type").value, importance: +val("imp"), access: val("access"),
        posters: Math.max(1, Math.min(10, parseInt($("a-posters").value, 10) || 1)), notes: $("a-notes").value.trim(),
        lat: where.lat, lon: where.lon, location_source: where.source,
        org: inside?.org || "", address: inside?.address || "",
      };
    }
    $("a-error").textContent = missing; $("a-error").hidden = false;
    d.showModal();
  }
}
