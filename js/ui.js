// Screens and small widgets: the setup form (first run + Settings) and the toast message.
import { bootstrap } from "./data.js";
import { pickPoint, cancelPick, setHome, showCity } from "./map.js";
import { esc } from "./logic.js";
import { currentPosition } from "./location.js";

export const $ = id => document.getElementById(id);
// Two names for the same thing in the sheet, typed by hand ("Gent " / "gent").
export const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// A short message at the top. ms = 0 keeps it until the next toast. `action`: {label, run} adds a button
// (e.g. "Undo" or "Cancel") that runs `run` and closes the message.
let toastTimer;
export function toast(msg, ms = 5000, action = null) {
  const el = $("toast");
  el.textContent = msg; el.hidden = !msg;
  if (msg && action) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "toast-btn"; b.textContent = action.label;
    b.onclick = () => { el.hidden = true; action.run(); };
    el.append(b);
  }
  clearTimeout(toastTimer);
  if (msg && ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// While the setup form is open, the map and buttons behind it can't be reached (also not with Tab).
const behind = () => [$("map"), document.querySelector(".bar"), $("sheet")];
const cover = on => behind().forEach(el => { el.inert = on; });

// Show the setup form and resolve {settings, boot} once the code is checked and the user taps Start/Save.
// settings: {name, code, role, home: {lat, lon} | null}. First the code (it decides the campaign and your
// role), then your name, picked from the names the team already uses, or typed.
// With a saved code it opens as "Settings"; `saved` is the last bootstrap answer, so Save without changes
// needs no network.
export function setup(settings, saved = null) {
  const form = $("setup"), part2 = $("setup-part2"), err = $("setup-error"), go = $("setup-go");
  const editing = !!settings.code;
  let home = settings.home || null, boot = editing ? saved : null, checkedCode = boot ? settings.code : null;

  $("f-code").value = settings.code || "";
  part2.hidden = !editing;
  go.textContent = editing ? "Save" : "Continue";
  err.hidden = true;
  form.hidden = false;
  cover(true);
  const showHome = () => {
    $("home-state").textContent = home ? `Home is set (${home.lat.toFixed(4)}, ${home.lon.toFixed(4)}).` : "No home set.";
    setHome(home);
  };
  showHome();
  const fail = msg => { err.textContent = msg; err.hidden = !msg; };

  // The name: a list of the names already in the sheet + "Someone else…" (then a text box). No names yet
  // (a new sheet): just the text box.
  const SOMEONE = "*";
  const showNames = () => {
    const names = boot.names, known = names.includes(settings.name);
    $("f-name-pick").innerHTML = `<option value="">Choose your name…</option>`
      + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("") + `<option value="${SOMEONE}">Someone else…</option>`;
    $("f-name-pick").value = known ? settings.name : settings.name ? SOMEONE : "";
    if (!known) $("f-name").value = settings.name || "";
    showNameBox();
  };
  const showNameBox = () => {
    const list = boot.names.length > 0, typed = !list || $("f-name-pick").value === SOMEONE;
    $("f-name-pick").hidden = $("f-name-pick-label").hidden = !list;
    $("f-name").hidden = $("f-name-label").hidden = !typed;
  };
  $("f-name-pick").onchange = () => { showNameBox(); if ($("f-name-pick").value === SOMEONE) $("f-name").focus(); };
  const chosenName = () => (boot.names.length && $("f-name-pick").value !== SOMEONE ? $("f-name-pick").value : $("f-name").value.trim());

  if (boot) showNames();

  $("home-gps").onclick = async () => {
    fail(""); $("home-state").textContent = "Finding your location…";
    try { home = await currentPosition(); delete home.accuracy; } catch (e) { fail(e.message); }
    showHome();
  };
  $("home-tap").onclick = async () => {
    form.hidden = true; cover(false);
    toast("Tap your home on the map.", 0, { label: "Cancel", run: cancelPick });
    const p = await pickPoint();
    if (p) { home = p; toast(""); }
    form.hidden = false; cover(true);
    showHome();
  };
  $("home-clear").onclick = () => { home = null; showHome(); };

  return new Promise(resolve => {
    // Cancel (Settings only): close without changing anything.
    $("setup-cancel").hidden = !editing;
    $("setup-cancel").onclick = () => { form.hidden = true; cover(false); setHome(settings.home); resolve({ settings, boot: saved }); };
    form.onsubmit = async e => {
      e.preventDefault();
      const code = $("f-code").value.trim();
      if (!code) return fail("Please fill in the code.");
      const name = part2.hidden ? "" : chosenName();
      if (!part2.hidden && !name) return fail("Please choose or fill in your name.");
      go.disabled = true; fail("");
      try {
        // Check the code with a bootstrap call (it also loads the code's campaign); again only if it changed.
        if (!boot || code !== checkedCode) {
          go.textContent = "Checking…";
          boot = await bootstrap(code);
          checkedCode = code;
          // centre on the campaign's city, so "Tap on the map" for home starts in the right place
          showCity(boot.cities.find(x => same(x.city, boot.campaigns[0].city)));
        }
      } catch (ex) {
        go.disabled = false; go.textContent = part2.hidden ? "Continue" : editing ? "Save" : "Start";
        return fail(ex.message);
      }
      go.disabled = false;
      if (part2.hidden) { part2.hidden = false; showNames(); go.textContent = "Start"; return; } // now: name, home
      form.hidden = true; cover(false);
      resolve({ settings: { name, code, role: boot.role, home }, boot });
    };
  });
}

// Ask a question in the app's own dialog (big buttons, works the same on every phone).
// With `value` there is a text box (a number box when value is a number): resolves the typed text.
// Without: resolves true. Cancel / Escape resolves null.
export function ask(msg, { value = null, ok = "OK", cancel = "Cancel" } = {}) {
  const d = $("dlg"), inp = $("dlg-in");
  $("dlg-msg").textContent = msg;
  inp.hidden = value === null;
  inp.type = typeof value === "number" ? "number" : "text";
  inp.inputMode = typeof value === "number" ? "numeric" : "text";
  inp.value = value ?? "";
  $("dlg-ok").textContent = ok;
  $("dlg-no").textContent = cancel;
  d.returnValue = "";
  d.showModal();
  if (value !== null) inp.select();
  return new Promise(resolve => d.addEventListener("close", () =>
    resolve(d.returnValue === "ok" ? (value === null ? true : inp.value) : null), { once: true }));
}
