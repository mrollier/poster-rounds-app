Paste everything below the line into Claude Code, in VS Code, with this folder open.

---

You're building the "Poster map": a phone-first web app that a few EA Ghent volunteers use on the
street to hang event posters. It replaces a working prototype (`reference/prototype-index.html`) that
ran inside Claude. Read `CLAUDE.md` and `docs/SPEC.md` first; the spec is the source of truth.

What already exists in this folder:
- `backend/Code.gs`: the finished Apps Script backend (I have deployed it; its URL is in step 2 below).
- `data/*.csv`: seed copies of the Google Sheet tabs (Places, Campaigns, Results, Cities, Types).
- `data/racks-gent.json`: public bike racks in Ghent (OpenStreetMap).
- `reference/prototype-index.html`: the prototype. Port its route logic (orderStops, computeWay,
  buildZones / splitZone / zoneOf / walkLoop, cleaningStart, gmaps link chunking), not its
  Claude-specific plumbing.

Work in this order, and stop for my OK after each numbered step:

1. **Plan.** Read the spec and the prototype. Propose the file structure and module split (e.g.
   `js/data.js` backend + queue, `js/geo.js` distances, `js/routes.js` the three route modes,
   `js/zones.js`, `js/map.js`, `js/ui.js`, `js/location.js`, `js/app.js`). List anything in the spec
   that is unclear or that you think is a bad idea, and ask me.
2. **Skeleton + data.** `index.html`, `config.js` (APPS_SCRIPT_URL = <PASTE MY WEB APP URL HERE>),
   onboarding (name, team code, optional home, campaign), bootstrap from the backend, priority and
   cycle logic with unit tests. Show me the onboarding and a map with all places, coloured by type.
3. **Live location.** Blue dot, accuracy circle, follow-me, clear permission messages.
4. **Results.** Next-stop card, Posted / Not possible / Undo / note, optimistic writes with an
   offline queue, polling every 30 s. Test with two browser windows that ticks sync.
5. **Route modes.** Everything left, On my way, Zones (as in the spec), with Google Maps links.
6. **Add place** from GPS or a tap.
7. **PWA + offline**: manifest, icons (simple map-pin glyph), service worker, vendored Leaflet.
8. **Polish on a phone**: bottom sheet, 375 px layout, daylight contrast, Lighthouse mobile run.
   Then write the repo `README.md`.
9. **Deploy**: create the GitHub repo `poster-map` under my personal account, push, enable GitHub
   Pages, and give me the URL. Ask before each of these actions.

Keep the code simple and well commented: I'm a Python person who reads JavaScript. Run
`node --test` before each commit.
