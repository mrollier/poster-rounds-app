# Poster map – product and technical spec

A phone-first web app that helps a small team of volunteers hang event posters across a city:
where to go, in which order, and what's already done. Hosted on GitHub Pages; shared data in a
Google Sheet behind a small Apps Script web app.

The current prototype (a Claude artifact) is in `reference/prototype-index.html`. It works and was
used on the street, so **port its logic, not its plumbing**. Everything Claude-specific in it
(`claude.use(...)`, the artifact database, `basemap.js` / `geo.js` hand-drawn map, `routes.js`
precomputed matrix, rounds/days/cargo bike) is dropped.

---

## 1. Users and context

- 2–6 volunteers of EA Ghent, posting at the same time, mostly on a **phone, outdoors, one-handed,
  often on bad mobile data**, alternating between biking and walking.
- Main organiser: Michiel. He edits places and campaigns in the Google Sheet.
- UI language: **English**.
- First event: the AI-safety lecture of 9 Dec 2026 (campaign `2026-12-ai-safety-lecture`). The app
  must be reusable for later events, other kinds of events, and later other cities (Antwerp,
  Brussels) **without code changes** – only sheet rows.

## 2. Data model (Google Sheet "Poster map data (EA Ghent)")

All tabs have a header row; the app reads them as lists of objects (strings). See the sheet's
README tab. Seed copies of every tab are in `data/*.csv` (for tests and offline development only;
the live app always reads the sheet).

| Tab | Key | Purpose |
|---|---|---|
| Places | `place_id` | Every poster place: `city, name, org, type, tags, importance, access, posters, address, lat, lon, hours, open_days, notes, location_source, active, added_by, added_at` |
| Campaigns | `campaign_id` | One event: `name, city, event_date, postering_from, postering_until, posters_total, event_url, active, event_type` (`event_type` = one of the `ev:` names in Types; older `w:<tag>` columns are no longer used) |
| Results | (`campaign_id`, `place_id`, `cycle`) | Latest result: `status, posters, note, by, at` |
| Cities | `city` | `centre_lat, centre_lon, zoom, board_cleaning, board_rules, board_rules_source` |
| Types | `type` | The types of place: `label, color` (filter + pin colour), plus one weight column per kind of event: `ev:AI Safety`, `ev:Animal Welfare`, `ev:Music`, `ev:Poetry`, … (0–3) |
| Log | – | Append-only audit of writes (backend only; the app never reads it) |

### 2.1 Importance stars (computed, never stored)

Each kind of event (an `ev:<name>` column in Types) gives every type of place a weight 0–3: how well
that type reaches the event's audience. The kind of event comes from the campaign's `event_type`, and a
volunteer can switch it in Filters. For that kind of event:

```
weight = clamp(Types[place.type]["ev:" + event], 1, 3)  (a type outside the preset counts as 1)
stars  = weight − 1 if place.importance = 1 and weight > 1, else weight
         (importance 1–3 in Places; 0 or empty = hidden)
```

Audience first: the type's weight sets the stars (do the people who'd come to this event pass by?).
The place's importance only says whether *many* people pass by: a quiet spot loses one star, a busy
spot of the wrong kind stays low. City boards have weight 2 for every event, so busy and medium boards
get 2★ and quiet ones 1★. The weights in the sheet come from a survey of the organiser (Nov 2026):
about 30 three-star places per event.

Shown as ★★☆ everywhere; the word "priority" is not used. The **preset** of a kind of event = the
types with weight > 0: those are ticked in Filters when you pick it, the rest unticked (you can tick
them by hand). Unit tests: the seed data gives 32 / 42 / 124 places with 3 / 2 / 1 stars for AI Safety.

### 2.2 City boards and cleaning cycles

Places of type `boards` are city poster boards that the city cleans on a schedule
(`Cities.board_cleaning`). Format: `nth-weekday FRI 1,3` = the 1st and 3rd Friday of each month;
`none` = never cleaned.

- `cycleStart(city, today)` = date (YYYY-MM-DD, Europe/Brussels) of the most recent cleaning day
  on or before today. Port `cleaningStart()` from the prototype and generalise it.
- A board's result is written with `cycle = cycleStart(...)`. When reading, a board counts as done
  only if it has a result row whose `cycle` equals the current cycle. Older rows are history.
- Non-board places use `cycle = ""` and stay done for the whole campaign.

### 2.3 Statuses

`posted` (with a poster count), `nope` ("Not possible here"), `refused`, `full`, `closed`,
`later` ("come back later"), and `""` (undone). A stop is **done** if its status is anything but
`""` or `later`. `posted` = grey faded pin; `nope/refused/full/closed` = red faded pin.

## 3. Backend (already written: `backend/Code.gs`)

Apps Script web app bound to the sheet. Read the header comment of `Code.gs`.

- `GET ?action=bootstrap&code=…[&campaign=…]` → `{campaigns, campaign_id, cities, types, places, results, serverTime}`
- Every call carries a `code`. Campaigns has `admin_code` and `volunteer_code` per campaign: the code
  decides the campaign (writes always land in it, whatever `campaign_id` the phone sends) and the role
  (`admin` / `volunteer`). Errors: `wrong code`, `campaign closed` (the campaign is not active).
- `GET ?action=bootstrap&code=…` → `{campaign_id, role, names, campaigns: [the campaign, without codes], cities, types, places, results, serverTime}`;
  `names` = first names already in Results (`by`) and Places (`added_by`), without "Claude …".
- `GET ?action=results&code=…&since=ISO` → `{results, serverTime}` (polling)
- `POST` body (JSON, **sent as `Content-Type: text/plain`** to avoid a CORS preflight):
  - `{code, name, action:"result", campaign_id, place_id, cycle, status?, posters?, note?}` – upsert; omitted fields keep their value
  - `{code, name, action:"addPlace", campaign_id, city, place_name, type, tags, importance, access, posters, lat, lon, address?, notes?, location_source:"gps"|"tap"}`
- Errors come back as `{ok:false, error}` with HTTP 200 (Apps Script can't set status codes).
- The web-app URL is public (it's in the site's code). The **codes** protect writes and reads.

Don't change the backend's contract without updating `Code.gs` too; Michiel must redeploy it by hand
(Deploy > Manage deployments > edit > new version) after any change.

## 4. The app

### 4.1 Tech

- Static site, **no build step**: `index.html`, `css/app.css`, `js/*.js` as ES modules, `config.js`.
- Leaflet 1.9.4 (vendored in `vendor/leaflet/` so the app shell works offline).
- Base map: raster tiles. Default `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with OSM
  attribution (fine for a handful of users under the OSM tile policy); make the URL and attribution a
  setting in `config.js` so it can be swapped for CARTO light if needed.
- PWA: `manifest.webmanifest` (name "Poster map", standalone, portrait, theme colour), icons,
  and a service worker that caches the app shell and the last bootstrap response
  (stale-while-revalidate). Tiles: cache what was viewed (cap ~50 MB).
- `config.js` (committed, public): `APPS_SCRIPT_URL`, `TILE_URL`, `TILE_ATTRIBUTION`,
  `DEFAULT_CAMPAIGN` (optional). **No secrets in the repo.**
- No framework, no TypeScript. Plain modules, short functions, comments that explain the why.
- Distances are **straight line × 1.3** (haversine). There is no precomputed matrix any more.
  Speeds: bike 15 km/h, walk 4.5 km/h. Time at a stop: 3 min for boards, 5 min otherwise.

### 4.2 First run (onboarding, one screen)

1. Code (checked with a bootstrap call; wrong code → clear message). It decides the campaign and the role.
2. Name: picked from the names the team already uses, or "Someone else…" and typed (stored as `by`).
3. Home (optional): "Use my current location" or "Tap on the map". Stored **only on the phone**
   (localStorage). Never sent to the backend, never in the repo. Used as default start/end.

Settings (code, name, home) are reachable later from a small menu. (An older backend without codes per
campaign: a plain name box and a campaign picker, as before.)

### 4.3 Main screen (phone layout)

- **Map fills the screen.** On top: a compact bar with the route mode switch
  (`All left · On my way · Zones`) and a filter button.
- **Bottom sheet** (draggable: min / peek / half / full; min is a one-line strip with the next stop, so
  the map fills the screen):
  - peek: the **next-stop card**: name, address, posters, "ask first / hang freely", buttons
    **Navigate**, **Posted ✓**, **Can't ✗** (each on one line).
  - half/full: stats (done / posters hung / km and time to go), the ordered list of stops with
    per-stop result menu, note, undo, and Google Maps links.
- Tap targets ≥ 44 px, high contrast (readable in daylight), works with one thumb.
- Desktop: same app, sheet becomes a side panel (as in the prototype).

### 4.4 Live location (essential)

- `navigator.geolocation.watchPosition` with high accuracy while the app is visible; stop when hidden.
- Blue dot with accuracy circle; a **follow-me** toggle (re-centre and keep centred while moving;
  any manual pan turns follow off).
- Clear messages for: permission denied (how to re-enable in iOS/Android settings), no fix yet,
  low accuracy.
- "Start from my position" is the default start for All left and Zones; Home is the fallback.

### 4.5 Filters

- What kind of event: the `ev:` columns of Types (default: the campaign's `event_type`).
- Importance: `All · ★★ and up · ★★★` (from §2.1).
- Types of place (a drop-down): the types from the Types tab, with colour swatch and count, ticked
  per the event's preset; "Back to preset / All / None".
- Filters persist on the phone. Skipped stops leave every route and the counts.

### 4.6 Route modes

Port the algorithms from the prototype (search for the function names):

1. **All left**: no route. Every open stop is a pin with its stars; the card is the nearest open stop
   (from my position, else home) and the list runs from near to far. It re-sorts as I move (every 50 m).
   ("Come back later" stops wait until nothing else is left.)
2. **On my way** (`computeWay`, `wayVariant`, `updateWay`): from A to B (my position, home, a
   tapped point, or a stop's pin), with an extra-time budget (5/15/30/60 min); cheapest insertion
   until the budget is used.
3. **Zones** (`buildZones`, `compactness`, `zoneOutline`, `parkAt`, `walkLoop`, `drawZones`): areas whose borders
   follow streets, railways and water; park the bike in the middle, walk a loop.
   - Building blocks: Statbel's statistical sectors (`data/sectors-<city>.json`, made once with
     `tools/make-sectors.js`). No sectors file: Zones says it isn't available for that city.
   - One setting, **Zone size** in Filters: Small / Medium / Large ≈ 20 / 45 / 90 min of walking + hanging.
   - Zones are built from **all** stops that pass the filters, done ones too, so borders don't move while the
     team works. Each sector with stops starts as a zone, whole: a busy sector is never cut up (Boekentoren
     is one ~3-hour zone). The smallest zone under the target then joins a neighbour it shares a stretch of
     border with (not just a corner, never across an empty sector), so every zone is one connected area;
     of the neighbours that keep the work ≤ target × 1.3 it takes the roundest result (Polsby–Popper
     4π·area / perimeter²).
   - Zone name = the Statbel name of the sector holding most of its stops ("Kouter", "Boekentoren");
     a one-stop zone is named after its stop. Duplicate names get " 2", " 3".
   - Map: each zone a teal area with a border, **grey once every stop is done**; open stops as small dots;
     name and "3/7 done · 40 min" in the middle from zoom 15. No numbers. A tap in a zone opens it.
   - Opening a zone: the map fits its outline (dashed); a chip under the top bar, "✕ Kouter · 5/8 left", goes
     back to all zones. The bike spot (P) is the public bike rack (`data/racks-<city>.json`) nearest the
     middle of the zone's stops, within 150 m, else the middle itself; the same for everyone. Then "Bike to
     the P" and the walking loop from the P (route line on foot), ending "back to the P".

### 4.7 Results

- Next-stop card and every pin popup: **Posted ✓** (asks how many if the place has > 1 poster),
  **Can't ✗** (status `nope`, optional reason → note), **Undo** on done stops.
- List rows: result menu (all statuses), note, undo.
- Optimistic UI: apply locally at once, queue the write (localStorage), send in order, retry with
  backoff when offline; show a small "3 changes waiting to sync" indicator.
- Poll `action=results&since=` every 30 s while visible (and on focus) to see other volunteers'
  ticks; last write wins (by `at`).

### 4.8 Add a place (from the street)

Button "+ Add place": choose position (my GPS position, or tap on the map), then a short form:
name, type, importance (★ / ★★ / ★★★, default ★★; the form previews the stars for the current kind of
event), access (ask/free), posters (default 1), notes. POST `addPlace`; the place appears for
everyone after the next poll. Send `location_source` gps/tap (stored as app-gps/app-tap).

### 4.9 Routes and navigation

- **Route lines** follow the streets: the FOSSGIS OSRM server (`routing.openstreetmap.de/routed-bike|routed-foot`,
  free, no key), one request per drawn trip, cached in memory. A dashed straight line shows at once and stays
  when offline. The stop order is still worked out on the phone (haversine × 1.3).
- **Navigate** (card, popups, list) starts in-app navigation: the sheet drops to its strip, follow-me at zoom 17,
  a banner "To <place> · 850 m · 4 min · ✕". Distance = along the route line from the nearest point; time =
  the route's duration × the share still to go. More than 50 m off the line twice in a row (at most every 20 s):
  a new route from here (the last good line stays if the server can't be reached). Within 30 m, or at the end of
  the line (it stops at the street): "You're at <place>" with Posted ✓ / Can't ✗; a result for that place ends
  navigation. Fixes rougher than ±50 m don't count for arriving or re-routing; more than 80 m away again
  undoes "arrived". A destination that isn't a stop (the P, home, B) ends navigation on arrival. Ending
  navigation also ends follow-me. No turn-by-turn instructions.
- **Trip lines** (On my way, a zone) run from the trip's start, not from the moving GPS position, so they don't
  change while you move. All left has no line.
- **Google Maps** stays as a fallback: a small "Google Maps ↗" link on the card and list rows, and the
  multi-stop links in the sheet (address for `location_source = basisregisters`, else `lat,lon`; max 3
  waypoints + destination per link).

## 5. Tags

The `tags` column of Places is free metadata; it no longer drives anything. Added places get `tags = type`.

## 6. What is deliberately left out

Rounds, days, cargo bike, the precomputed distance matrix and its Python pipeline, the hand-drawn
base map, result-log export/import, KML/GeoJSON export, printing. Don't add accounts/OAuth.

## 7. Quality bar

- Lighthouse (mobile): PWA installable, accessibility ≥ 90, works offline after first load.
- Unit tests (Node's built-in `node --test`, no dependencies) for: stars, cycleStart for several
  dates (incl. month boundaries), buildZones on the seed data (deterministic, sizes) and on small synthetic grids (merging, cutting, outline, bike spot), orderStops (loop
  shorter than random order), result merge (last write wins), offline queue.
- One Playwright smoke test (optional) against a mocked backend.
- No console errors. All user-visible text in plain English.

## 8. Deploy

- GitHub Pages from the `main` branch (root). HTTPS is required for geolocation and the service worker.
- `README.md` in the repo: what it is, how to run locally (`python3 -m http.server`), how to deploy,
  how to change the backend URL, how to add a city (Cities row + racks and sectors files) and a
  campaign (Campaigns row).
