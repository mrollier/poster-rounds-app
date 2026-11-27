// "Train the stars" (admins): two places side by side, swipe towards the one that's better for promoting
// this event. Each admin works through their own schedule of ~250 swipes over a deck of 60 places, in
// sessions as long as they have time for. The swipes go to the sheet; a developer then turns them into
// stars for every place (README "How the stars are made"). The maths is in js/rank.js.
import { $, toast } from "./ui.js";
import { esc } from "./map.js";
import { store } from "./data.js";
import { fitBT, chooseDeck, quality, historyFromRows, nextPair, comparisonsIn as comparisons, unknownIn as unknown } from "./rank.js";
import { CONFIG } from "../config.js";

const DECK = "v1";        // bump when the deck rules change: a new deck starts a new schedule
const TOTAL = 250;        // swipes per admin for a settled order (≈ 8 per place)
const PER_MIN = 10;       // swipes per minute, to turn "how much time do you have?" into a number
// Places the organiser knows are rated wrong for AI Safety (2026-11-27): always in the deck.
const MUST = ["Campus UFO", "Vlerick", "Timelab", "Syntra", "Bloemekenswijk", "Stapelplein"];
const ICON = { boards: "📋", sci: "🔬", arts: "🎭", libraries: "📚", student: "🍽️", museums: "🏛️", stages: "🎬",
  startups: "🚀", research: "🧪", makers: "🛠️", bookshops: "📖", literature: "✒️", ideas: "💬", musicvenues: "🎵",
  musicshops: "💿", musicschools: "🎻", youth: "🎸", veggie: "🥗", organic: "🌱", animalorgs: "🐾", cafes: "☕",
  community: "🏘️", sport: "🧗" };

// This admin's schedule for this campaign, kept on the phone: the deck and seed it started with (so a
// place added later or a changed list doesn't reshuffle it) and the swipes [{left, right, outcome, round}].
// The next pair is rebuilt from it, so a session can stop at any moment and continue later.
const key = (campaignId, name) => `train:${campaignId}:${name}:${DECK}`;
function loadPlan(campaignId, name, fromServer, freshDeck) {
  const saved = store.get(key(campaignId, name), null);
  if (saved?.deck) return saved;
  // A new phone: start from this admin's swipes in the sheet (undos applied, as the fit tool does).
  const seed = [...`${campaignId}|${name}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1e9, 7);
  return { deck: freshDeck, seed, h: historyFromRows(fromServer || [], name, DECK) };
}

// A small map around the place: one map tile with a pin in the middle (no extra map library needed).
function tinyMap(p) {
  const z = 16, n = 2 ** z, lat = +p.lat * Math.PI / 180;
  const x = (+p.lon + 180) / 360 * n, y = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n;
  const url = CONFIG.TILE_URL.replace("{s}", "a").replace("{z}", z).replace("{x}", Math.floor(x)).replace("{y}", Math.floor(y)).replace("{r}", "");
  const px = Math.round((x % 1) * 256), py = Math.round((y % 1) * 256);
  return `<div class="tmap" style="background-image:url('${url}');background-position:calc(50% - ${px - 128}px) calc(50% - ${py - 128}px)">
    <span class="tpin" aria-hidden="true"></span></div>`;
}

function cardHtml(p, type, where, side) {
  let host = "";
  try { host = p.website ? new URL(/^https?:/.test(p.website) ? p.website : `https://${p.website}`).hostname : ""; } catch { /* no icon */ }
  return `<div class="tcard" data-side="${side}" role="button" tabindex="0" aria-label="${esc(p.name)} is better">
    <div class="ticon" aria-hidden="true">${ICON[p.type] || "📍"}${host ? `<img src="https://icons.duckduckgo.com/ip3/${esc(host)}.ico" alt="" width="20" height="20" loading="lazy">` : ""}</div>
    <div class="tname">${esc(p.name)}</div>
    <div class="tmeta">${esc(type?.label || p.type)}</div>
    <div class="tmeta">${esc(p.address)}</div>
    ${tinyMap(p)}
    <div class="twhere">${esc(where)}</div>
    <button type="button" class="tq" data-unknown="${side}" aria-label="I don't know ${esc(p.name)}">?</button>
  </div>`;
}

// Open the screen. ctx: {campaignId, event, name, places, types, swipes (from the server), describe(place) →
// location line, send(body) → puts a write in the outbox}.
export function openTrain(ctx) {
  const d = $("train"), byId = new Map(ctx.places.map(p => [p.place_id, p]));
  const types = Object.fromEntries(ctx.types.map(t => [t.type, t]));
  const plan = loadPlan(ctx.campaignId, ctx.name, ctx.swipes, chooseDeck(ctx.places, { must: MUST }));
  const deck = plan.deck.filter(id => byId.has(id)), seed = plan.seed, h = plan.h; // (a place removed from the sheet drops out)
  let goal = 0, start = h.length, pair = null, prev = null;
  const save = () => store.set(key(ctx.campaignId, ctx.name), plan);

  const show = step => { for (const s of ["budget", "swipe", "done"]) $(`train-${s}`).hidden = s !== step; };
  $("train-event").textContent = $("train-event2").textContent = ctx.event || "this event";
  $("train-left-total").textContent = `${Math.min(h.length, TOTAL)} of ${TOTAL} done so far`;
  show("budget");
  d.showModal();

  const draw = () => {
    const doneNow = Math.max(0, h.length - start); // (an undo can reach back before this session)
    if (doneNow >= goal || h.length >= TOTAL || !(pair = nextPair(deck, h, seed))) return finish();
    $("train-bar").style.width = `${Math.round(100 * doneNow / goal)}%`;
    $("train-count").textContent = `${doneNow} / ${goal} · ${h.length} of ${TOTAL} in total`;
    const [L, R] = [byId.get(pair.left), byId.get(pair.right)];
    $("train-pair").innerHTML = cardHtml(L, types[L.type], ctx.describe(L), "left") + cardHtml(R, types[R.type], ctx.describe(R), "right");
    $("train-undo").disabled = h.length === 0;
  };
  const answer = outcome => {
    if (!pair) return;
    h.push({ left: pair.left, right: pair.right, outcome, round: pair.round });
    save();
    ctx.send({ action: "swipe", deck_version: DECK, round: pair.round, left_id: pair.left, right_id: pair.right, outcome });
    draw();
  };
  const finish = () => {
    const ids = deck.filter(id => !unknown(h).has(id)), comps = comparisons(h);
    const now = fitBT(ids, comps), last = Math.max(1, ...h.map(x => x.round)), before = fitBT(ids, comparisons(h.filter(x => x.round < last)));
    const q = quality(comps, ids, now, before);
    $("train-summary").innerHTML = `<b>${h.length - start}</b> swipes this time, <b>${h.length}</b> of ${TOTAL} in total.<br>
      Fewest swipes for one place: <b>${q.minPer}</b> (4 or more is good).<br>
      How settled the order is: <b>${Math.round(q.settled * 100)}%</b> (90% or more is settled).
      ${q.drawShare > 0.35 ? "<br>Many \"about the same\": maybe take a break." : ""}`;
    show("done");
  };

  // Choose how long: ≈ 10 swipes a minute.
  $("train-budget").onclick = e => {
    const m = +e.target.closest("[data-min]")?.dataset.min;
    if (!m) return;
    goal = m * PER_MIN; start = h.length; show("swipe"); draw();
  };
  $("train-more").onclick = () => { goal = 10 * PER_MIN; start = h.length; show("swipe"); draw(); };
  $("train-close").onclick = $("train-close2").onclick = () => d.close();
  $("train-same").onclick = () => answer("draw");
  $("train-undo").onclick = () => {
    const last = h.pop();
    if (!last) return;
    start = Math.min(start, h.length);
    save();
    // The sheet keeps every swipe; this row tells the fit to drop the last one of this pair.
    ctx.send({ action: "swipe", deck_version: DECK, round: last.round, left_id: last.left, right_id: last.right, outcome: "undo" });
    toast("Last swipe taken back.", 2000);
    draw();
  };
  // Tap a card = that one is better; "?" = I don't know this place. (Not right after a swipe: a swipe
  // ends with a tap too.)
  let swiped = 0;
  $("train-pair").onclick = e => {
    if (Date.now() - swiped < 400) return;
    const q = e.target.closest("[data-unknown]");
    if (q) return answer(`unknown_${q.dataset.unknown}`);
    const c = e.target.closest(".tcard");
    if (c) answer(c.dataset.side);
  };
  // Swipe: towards the better place (left = the left one, right = the right one).
  $("train-pair").onpointerdown = e => { prev = { x: e.clientX, y: e.clientY }; };
  $("train-pair").onpointerup = e => {
    if (!prev) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    prev = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) { swiped = Date.now(); answer(dx < 0 ? "left" : "right"); }
  };
}
