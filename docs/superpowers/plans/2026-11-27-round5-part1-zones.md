# Round 5 Part 1 – Zones and the map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zones that are one connected, compact area named after their Statbel sector, with the bike spot in the middle, an obvious way out of an open zone, and the Google Maps link moved from the card to the map pop-up.

**Architecture:** Pure zone logic stays in `js/routes.js` (tested with `node --test`); `js/app.js` wires it to the screen; `js/map.js` draws. No backend change.

**Tech Stack:** plain JS ES modules, Leaflet 1.9.4, `node --test`, standalone WebKit Playwright for screen checks.

**Spec:** `docs/superpowers/specs/2026-11-27-round5-design.md` (Part 1).

## Global Constraints

- Plain JavaScript modules, no framework, no bundler, no npm runtime dependencies (CLAUDE.md).
- Comment the why in simple terms; keep functions short (owner codes in Python).
- Phone first: check at 375×812 and 320 px; tap targets ≥ 44 px.
- Distances: haversine × 1.3 (`dist` in js/geo.js).
- Targets S/M/L = 20 / 45 / 90 min (`ZONE_MINUTES`); merge only while merged work ≤ target × 1.3.
- No bike rack within 150 m of the middle → the middle itself is the P.
- Run `node --test` before every commit; ask before pushing; bump `sw.js` SHELL when shipping.

## Review Focus

- A zone whose only neighbours share a single corner point: must stay separate (no corner joins) → test in Task 1.
- Two stops in one sector far apart (rural sector, e.g. Mellestraat): stays one zone, one outline → covered by "busy sector stays whole" test in Task 1.
- Zone where every stop is done when opened: map must still fit the zone's outline, not just the P → Task 3 screen check.
- A stop outside every sector (just over the city line): still lands in exactly one zone → test in Task 1.
- Open zone, then the zone set changes (filters or size changed): chip disappears, back on the overview → Task 3 screen check.

---

### Task 1: Connected, compact zones named after their sector

**Files:**
- Modify: `js/routes.js` (zone section: `buildZones`, remove `cut`, `splitUnit`, the `near`-through-empty-sector logic and the `labels` parameter)
- Test: `tests/routes.test.js`

**Interfaces:**
- Produces: `buildZones(stops, sectors, target) → [{ id, name, rings, ids, centre, mins }]` (no `labels` argument any more; biggest first; ids `z1…`). `zoneOutline(rings)` unchanged. New helper `compactness(rings) → number` (Polsby–Popper, 0–1), exported for tests.

- [ ] **Step 1: Write the failing tests** in `tests/routes.test.js` (replace the old "empty sector connects" and "cut in two" tests):
  - `"buildZones: zones only merge across a shared border, never via a corner or an empty sector"` — 4 squares in a row (`row` helper exists): stops in 00 and 02 → `buildZones(..., 999).length === 2`; a 2×2 grid where stops are in 00 and 11 only (corner touch) → 2 zones; stops in 00 and 01 → 1 zone.
  - `"buildZones: every zone on the Ghent data is one connected area"` — for S, M, L on the seed places, each zone's `zoneOutline(z.rings)` forms exactly one loop (count connected components of the segments; helper in the test).
  - `"buildZones: a busy sector stays one zone"` — the 27 Boekentoren stops (places whose `sectorOf` name is "Boekentoren") are all in one zone for S.
  - `"buildZones: names come from the sector with most stops"` — on the seed data at M, the zone containing the Overpoort board (B48) is named `"Overpoort"` or starts with it; no zone is named `"Sint-Jacobs"` unless it contains a stop in the sector "Sint-Jacobs".
  - `"compactness: a square beats a 1×3 strip"` — `compactness([sq(0,0)]) > compactness(row3Rings)` and a square ≈ 0.785 (π/4) within 0.01.

- [ ] **Step 2: Run** `node --test tests/routes.test.js` — expected: the new tests FAIL (corner/empty joins, names from labels, `compactness` not defined).

- [ ] **Step 3: Implement** in `js/routes.js`:
  - Pieces = sectors that hold stops (whole, never cut). Two pieces are neighbours when they share an **edge** (same two consecutive border points, either direction; build a map from edge key → sector indices using the existing `key`).
  - Greedy loop as today (smallest zone under target first; `stuck` set), but among neighbours that keep merged work ≤ target × 1.3, pick the one whose merged rings have the highest `compactness`; ties → fewer minutes.
  - `compactness(rings)` = 4π·area / perimeter², area = sum of |shoelace| per ring and perimeter = total length of `zoneOutline(rings)` segments, both in a local plane (x = lon·cos 51°, y = lat; same `cos` constant as now).
  - Name = `name` of the sector holding most of the zone's stops (tie → lowest sector index); one-stop zone → the stop's name; repeats get " 2", " 3".

- [ ] **Step 4: Run** `node --test` — expected: all PASS. Then print S/M/L zone counts and max minutes on the seed data (one-off `node -e`) and note them in the commit message.

- [ ] **Step 5: Commit** `js/routes.js tests/routes.test.js` — "Zones: one connected area each, compact merges, sector names".

### Task 2: The bike spot in the middle of the zone

**Files:**
- Modify: `js/routes.js` (replace `parkFor` with `parkAt`)
- Test: `tests/routes.test.js`

**Interfaces:**
- Produces: `parkAt(stops, racks) → { lat, lon, rack: boolean }` — the rack nearest the middle (mean lat/lon) of `stops` if within 150 m (`hav`), else the middle itself with `rack: false`.

- [ ] **Step 1: Write the failing test** `"parkAt: the bike rack nearest the middle, else the middle"` (replaces the `parkFor` test): stops at (51.015, 3.705) and (51.015, 3.715) → middle (51.015, 3.71); racks at 3.7101 (≈7 m) and 3.704 → returns the first with `rack: true`; racks only 300 m away → `{ lat: 51.015, lon: 3.71, rack: false }`.
- [ ] **Step 2: Run** `node --test tests/routes.test.js` — expected: FAIL (`parkAt` not defined).
- [ ] **Step 3: Implement** `parkAt`; delete `parkFor` and its 15-rack/bike-time logic.
- [ ] **Step 4: Run** `node --test` — expected: PASS.
- [ ] **Step 5: Commit** — "Zones: the bike spot is the rack nearest the middle".

### Task 3: Screen: way out of a zone, fit, Google Maps icon, no neighbourhood file

**Files:**
- Modify: `js/app.js` (`loadCityFiles`, `renderZones`, `renderZone`, `view` defaults, click handler), `js/modes.js` (`zonesNow` signature), `js/map.js` (`fitTo` use for a zone), `js/views.js` (card and pop-up links), `index.html` (chip element), `css/app.css` (chip, pop-up icon; remove `.next .gmaps`)
- Delete: `data/neighbourhoods-gent.json` (owner agreed)

**Interfaces:**
- Consumes: `buildZones(stops, sectors, target)` and `parkAt(stops, racks)` from Tasks 1–2.
- Produces: `zonesNow(kept, key, sectors, size)` (labels argument removed).

- [ ] **Step 1: Wire the logic.** `zonesNow` calls `buildZones` without labels; `loadCityFiles` no longer fetches `neighbourhoods-<city>.json` (drop `labels`); `renderZone` uses `parkAt(z.stops.map(s => s.place), racks || [])` every render (no `view.zonePark`; remove it from `view` and from the zone-back handler).
- [ ] **Step 2: Chip.** `index.html`: `<button type="button" id="zone-chip" class="zone-chip" hidden></button>` after `#sync-btn`. While a zone is open: text `✕ ${name} · ${left}/${total} left`, `aria-label="Back to all zones"`, shown; otherwise hidden. Click = the same as the existing `zone-back` action. CSS: fixed, `top: calc(var(--bar-bottom) + 8px)`, centred, pill, min-height 44 px, white on `--brand`, shadow; when the nav banner shows, it sits under it like `.sync-btn` does.
- [ ] **Step 3: Fit.** Opening a zone fits the map to all points of its rings (not only the remaining stops), once per zone (`fitKey` as today).
- [ ] **Step 4: Google Maps.** Remove the `<a class="gmaps">` from `nextCardHtml` and its CSS. In `popupHtml` add after the buttons a small link: `<a class="pop-gmaps" href="${gmapsUrl(p)}" target="_blank" rel="noopener" aria-label="Open in Google Maps" title="Google Maps">` with a 20 px map-pin SVG, 44×44 tap area. List rows and route links unchanged. Update the comment in `js/nav.js:2`.
- [ ] **Step 5: Delete** `data/neighbourhoods-gent.json`; update README "A new city" (only racks + sectors files) and SPEC §4 Zones (names from sectors, contiguity, compact merges, P in the middle, chip).
- [ ] **Step 6: Bump** `sw.js` SHELL to `shell-v5`.
- [ ] **Step 7: Screen check** (scratchpad Playwright, WebKit, iPhone 13, 375×812 and 320 px, mock server): Zones overview at S/M/L shows no zone with two patches; tap a zone on the map → chip "✕ <name> · n/m left" visible, other zones' outlines gone (only the dashed one), map fits the outline; tap chip → overview; a zone whose stops are all done still fits its outline; change size in Filters while a zone is open → overview, chip hidden; the card has no Google Maps link, a pin's pop-up has the icon; no page errors.
- [ ] **Step 8: Run** `node --test` — expected: all PASS.
- [ ] **Step 9: Commit** — "Zones: exit chip, fit to the zone, Google Maps icon in the pop-up; drop neighbourhood names". Then ask the owner before pushing.
