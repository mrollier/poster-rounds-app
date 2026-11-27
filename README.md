# Poster map

A phone-first web app that helps a small team of volunteers hang event posters across a city: where to go,
in which order, and what the team has already done. Built for EA Ghent (first event: the AI-safety lecture of
9 December 2026), and reusable for later events and other cities by adding rows to a Google Sheet. No code
changes needed for that.

**Live:** https://mrollier.github.io/poster-rounds-app/

- A map of every poster place for the current campaign, coloured by type, with **importance stars** (★★☆)
  for the kind of event you plan for: AI Safety, Animal Welfare, Music or Poetry.
- Three ways to plan a round:
  - **All left:** every stop still to do on the map (no route); the card is the nearest one to you.
  - **On my way:** stops that fit an extra-time budget on a trip from A to B.
  - **Zones:** areas whose borders follow streets and water (Small / Medium / Large in Filters); finished
    zones turn grey. Bike to the P in the middle of a zone, walk its loop, bike on.
- **Posted ✓ / Can't ✗ / Undo**, shared with the team through the sheet. Ticks show at once and are sent
  in the background; offline they wait on the phone.
- **Real routes** by bike or on foot, and **in-app navigation** to a stop: the route from where you are, with the
  distance and time still to go, a new route when you take another way, and Posted ✓ / Can't ✗ when you arrive.
  A small Google Maps link stays for turn-by-turn directions.
- **Live location** (blue dot, follow-me) and **+ Add place** for new spots found on the street.
- Drag the bottom sheet down to a one-line strip to see the whole map.
- Installable on the home screen; works offline after the first visit.

The full product and technical spec is in [docs/SPEC.md](docs/SPEC.md).

## How it fits together

```
Phone (this web app, GitHub Pages)  ──HTTPS──▶  Apps Script web app (backend/Code.gs)  ──▶  Google Sheet
   localStorage: your name, code, role,          checks the code, reads tabs,               "Poster map data
   home, last data, unsent changes               upserts results, appends to Log            (EA Ghent)"
```

- **The Google Sheet** is the database: tabs Places, Campaigns, Results, Cities, Types, Log, and Summary
  (stops and posters per volunteer, a formula over Results; see its README tab).
- **The backend** (`backend/Code.gs`) is a small Apps Script bound to the sheet. Every call needs a
  **code**. Each campaign has two, in its Campaigns row: `admin_code` (organisers) and `volunteer_code`
  (everyone else). The code decides the campaign and the role; codes live in the sheet and on the phones,
  never in this repo, and are never sent back by the backend.
- **The app** is plain HTML, CSS and JavaScript modules: no build step, no framework, no npm packages at
  runtime. Leaflet 1.9.4 is copied into `vendor/leaflet/`.

```
index.html, css/app.css, config.js   the page, its styles, public settings (backend URL, map tiles)
js/app.js        state, buttons, syncing          js/views.js    HTML for cards, list rows, popups
js/logic.js      stars, cleaning cycles, links   js/routes.js   the route algorithms (pure)
js/modes.js      the three modes as plans         js/geo.js      distances and travel times
js/sync.js       merge results + offline outbox   js/data.js     backend calls, localStorage
js/map.js        Leaflet: pins, lines, blue dot   js/location.js GPS
js/router.js     real routes (OSRM server)        js/nav.js      in-app navigation
js/ui.js         setup form, dialogs, toasts      js/addplace.js "+ Add place"
sw.js, manifest.webmanifest, icons/   offline support and home-screen install
data/            seed CSVs (tests only), racks-<city>.json, sectors-<city>.json
backend/Code.gs  the Apps Script backend          tests/         node --test, plus a local mock backend
tools/make-icons.js                   redraws the icons
reference/       the old prototype (kept for reference only)
```

## Run it locally

You need Python 3 (or any static file server) and, for the tests and the mock backend, Node.js 22+.

```sh
# Against the real sheet: serve the folder and open http://localhost:8000 in Chrome or Safari
python3 -m http.server 8000

# Against a fake backend with the seed data (nothing is saved; codes "secret" = volunteer, "admin-secret" = admin)
node tests/mock-server.js            # then open http://localhost:8787
PORT=8791 node tests/mock-server.js  # a second, separate one (any port 8787–8799 uses the mock)

# Unit tests (no packages to install)
node --test
```

Location works on `localhost`, but the VS Code built-in browser can't share it; use a normal browser. To fake a
position in Chrome: DevTools → ⋮ → More tools → Sensors → Location. On a phone, location and offline mode need
`https://`, so test on the GitHub Pages site.

After you change a file, the installed app picks it up on the **second** start: the first start shows the
cached copy and fetches the new one in the background.

## Deploy

GitHub Pages serves the `main` branch (root folder), so pushing to `main` updates the site within about a minute:

```sh
node --test          # all green first
git push origin main
```

**The backend is separate.** If you change `backend/Code.gs`, paste it into the sheet's Apps Script editor
(Extensions → Apps Script) and redeploy: **Deploy → Manage deployments → edit (pencil) → Version: New
version → Deploy**. The URL stays the same. The first-time setup is in [SETUP.md](SETUP.md).

### Change the backend URL or the map tiles

All are in [config.js](config.js). `APPS_SCRIPT_URL` is the web-app URL ending in `/exec`. `TILE_URL` and
`TILE_ATTRIBUTION` set the base map; the file has a CARTO alternative in a comment. `ROUTER_URL` is the route
server (the free OSRM server of FOSSGIS, `routing.openstreetmap.de`, with a bike and a foot profile).

### Codes

Each campaign row in the Campaigns tab has an `admin_code` and a `volunteer_code` (case-sensitive; easiest
with lowercase letters and digits). Share the volunteer code with the team, the admin code only with
organisers. To change one, edit it in the sheet: phones with the old code get "That code is not right" and
can type the new one under ☰. A campaign whose `active` is not TRUE refuses its codes ("This campaign is
closed"). Admins can do more in the app (training the stars, Part 3 of round 5).

## A new campaign

Add a row to the **Campaigns** tab:

| column | example | meaning |
|---|---|---|
| `campaign_id` | `2027-03-pandemics-talk` | unique, no spaces; results are stored under it |
| `name`, `event_date`, `event_url` | | shown in the app |
| `city` | `Gent` | must match a row in Cities; only that city's places are loaded |
| `postering_from`, `postering_until`, `posters_total` | | for your own planning |
| `active` | `TRUE` | set the old campaign to `FALSE` when it's over |
| `event_type` | `AI Safety` | the kind of event: one of the `ev:` columns in Types (volunteers can switch it in Filters) |

### Importance stars and kinds of event

The **Types** tab has one column per kind of event, e.g. `ev:Music`, with a weight 0–3 per type of place:
how well that type of place reaches that audience. Stars per place = **the weight**, minus one star
when the place is quiet (importance 1 in Places): ★★★ means the right audience at a spot people
actually pass. A busy spot of the wrong kind stays low. Types with weight 0 are left out of that kind of
event's preset in Filters; a volunteer can still tick them, and they then count as weight 1.

- **A new kind of event** (say Climate): add a column `ev:Climate` to Types and fill in 0–3 per type.
- **A new type of place**: add a row to Types (key, label, colour, weights), then use the key in Places.

## A new city

1. **Cities** tab: a row with `city` (as used in Places and Campaigns), `centre_lat`, `centre_lon`, `zoom`
   (13 suits a city), and `board_cleaning`. The rule `nth-weekday FRI 1,3` means the 1st and 3rd Friday of
   each month; `none` means boards are never cleaned. A board's "posted" counts only until the next cleaning
   day.
2. **Places** tab: the city's poster places (`active` = `TRUE`).
3. Files in `data/`, named with the city in lower case (`Antwerpen` → `racks-antwerpen.json`).
   - `sectors-<city>.json`: the city's statistical sectors, the building blocks of Zones (without it there
     are no zones). Download "Statistical sectors" as GeoJSON in Lambert 2008 (EPSG:3812) from
     https://statbel.fgov.be/en/open-data/statistical-sectors-2025, unzip, and run
     `node tools/make-sectors.js <the .geojson> <the city's NIS code> <city>` (Ghent: 44021). No libraries needed.
   - `racks-<city>.json`: public bike racks, `{"source": "...", "city": "...", "racks": [[lat, lon], ...]}`.
     Without it Zones still work, but the bike spot is simply the middle of the zone. It comes from
     OpenStreetMap through the Overpass API (https://overpass-api.de; change the name and admin level to
     match the city):

     ```
     [out:json][timeout:60];
     area["boundary"="administrative"]["admin_level"="8"]["name"="Antwerpen"]->.c;
     node(area.c)["amenity"="bicycle_parking"]["access"!~"^(private|customers|no)$"];
     out;
     ```

     Save `lat` and `lon` in the format above. The data is © OpenStreetMap contributors (ODbL): keep the
     `source` line.

## Notes and limits

- **Distances** for ordering the stops are straight-line × 1.3, at 15 km/h by bike and 4.5 km/h on foot, plus
  3 min per city board and 5 min per other stop: quick, and no network needed. The **lines on the map** and
  **navigation** use real routes from the FOSSGIS route server (free, no key; fine for a handful of volunteers).
  Offline you get a dashed straight line instead. On my way follows your Bike / On foot choice in
  Filters; a zone's loop is walked, and "Bike to the P" is biked.
- **Look:** colours and the lightbulb logo follow effectivealtruism.org (dark teal `#1b5266`, peach
  `#ffbe8b`), set once at the top of `css/app.css`. The app icons in `icons/` are the same lightbulb.
- **Navigation** shows distance and time, not turn-by-turn instructions; use the small Google Maps link for those.
- **Orders are per phone.** On my way and Zones are remembered on each phone; only results and
  places are shared.
- **Sync:** results are fetched every 30 s and when the app comes back on screen; places every 5 minutes. When
  two people change the same stop, the later change wins.
- **Adding a place twice:** if the connection drops exactly while the sheet saves a new place, the phone retries
  and the place can appear twice. Delete the copy in Places.
- **Map tiles** come from openstreetmap.org, which is fine for a handful of volunteers under the OSM tile usage
  policy. Tiles you've viewed are kept for offline use (about 50 MB at most).
- **The codes** are shared passwords, not real accounts: if one leaks, change it in the Campaigns tab.

## Tests

`node --test` covers:
- stars on the seed data (32 / 42 / 124 with 3 / 2 / 1 stars for AI Safety) and the event presets;
- cleaning cycles across month and year boundaries;
- the route algorithms, and following a route line (navigation);
- merging results and the offline outbox;
- Google Maps link splitting;
- the backend itself, run against a fake sheet.

For a Lighthouse audit of the main screen, start the mock server and audit
`http://localhost:8787/tests/lh-seed.html`, which logs in with the mock code and opens the app.
