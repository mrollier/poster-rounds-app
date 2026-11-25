// "+ Add place": pick the position (my GPS fix or a tap on the map), fill a short form, and hand back
// the request for the backend. Sending goes through the same outbox as results, so it works offline too.
import { $, toast, ask } from "./ui.js";
import { pickPoint, esc } from "./map.js";
import { lastPosition } from "./location.js";
import { TYPE_TAGS, campaignTags, priority } from "./logic.js";
import { seg } from "./views.js";

const POOR_FIX = 50; // metres: warn when the GPS position is this uncertain

async function choosePosition() {
  const here = lastPosition();
  if (here) {
    const choice = await ask(`Where is the place? Your GPS position is accurate to about ${here.accuracy} m.`
      + (here.accuracy > POOR_FIX ? " That's rough: tapping the map may be better." : ""),
      { ok: "Use my position", cancel: "Tap on the map" });
    if (choice) return { lat: here.lat, lon: here.lon, source: "gps", text: `Your GPS position (±${here.accuracy} m).` };
  }
  toast("Tap the map where the place is.", 0);
  const p = await pickPoint();
  toast("");
  return { ...p, source: "tap", text: "The point you tapped on the map." };
}

// Resolves the addPlace request body, or null when cancelled.
export async function addPlace({ types, campaign }) {
  const where = await choosePosition();
  const d = $("add-dlg");
  $("add-form").reset();
  $("add-where").textContent = `Position: ${where.text}`;
  $("a-type").innerHTML = types.map(t => `<option value="${esc(t.type)}">${esc(t.label)}</option>`).join("");
  $("a-imp").innerHTML = seg("imp", [[1, "1 low"], [2, "2 normal"], [3, "3 high"]], 2);
  $("a-access").innerHTML = seg("access", [["ask", "Ask first"], ["free", "Hang freely"]], "ask");
  $("a-tags-hint").textContent = `Tags this campaign knows: ${campaignTags(campaign).join(", ")}.`;
  $("a-error").hidden = true;

  // Tags follow the type until you edit them yourself; the priority line shows what the place will get.
  let tagsEdited = false;
  const val = name => d.querySelector(`input[name=${name}]:checked`)?.value;
  const update = () => {
    if (!tagsEdited) $("a-tags").value = TYPE_TAGS[$("a-type").value] || "general";
    const prio = priority({ tags: $("a-tags").value, importance: val("imp") }, campaign);
    $("a-prio").textContent = prio ? `Priority for this campaign: ${prio}` : "With these tags the place gets no priority and stays hidden.";
  };
  $("a-tags").oninput = () => { tagsEdited = true; update(); };
  d.oninput = e => { $("a-error").hidden = true; if (e.target.id !== "a-tags") update(); };
  update();

  d.showModal();
  for (;;) {
    const result = await new Promise(res => d.addEventListener("close", () => res(d.returnValue), { once: true }));
    if (result !== "ok") return null;
    const name = $("a-name").value.trim();
    if (name) {
      return {
        action: "addPlace", campaign_id: campaign.campaign_id, city: campaign.city, place_name: name,
        type: $("a-type").value, tags: $("a-tags").value.trim(), importance: +val("imp"), access: val("access"),
        posters: Math.max(1, Math.min(10, parseInt($("a-posters").value, 10) || 1)), notes: $("a-notes").value.trim(),
        lat: where.lat, lon: where.lon, location_source: where.source,
      };
    }
    $("a-error").textContent = "Please give the place a name."; $("a-error").hidden = false;
    d.showModal();
  }
}
