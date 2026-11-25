# Poster map – instructions for Claude Code

Phone-first web app for hanging event posters in a city (EA Ghent). Static site on GitHub Pages;
shared data in a Google Sheet through an Apps Script web app.

**Read `docs/SPEC.md` before changing anything.** It is the source of truth for features and data.

## Layout

```
index.html, css/, js/, config.js     the app (no build step, ES modules)
vendor/leaflet/                      Leaflet 1.9.4, vendored for offline use
sw.js, manifest.webmanifest, icons/  PWA
data/                                seed CSVs (tests/dev only), racks-<city>.json, neighbourhoods-<city>.json
backend/Code.gs                      Apps Script backend (deployed by hand from the sheet)
reference/prototype-index.html      the working prototype; port its algorithms, not its plumbing
tests/                               node --test unit tests (no dependencies)
docs/SPEC.md                         spec
```

## Rules

- Plain JavaScript modules, no framework, no bundler, no npm runtime dependencies.
- The owner codes in Python and reads JS: **comment the why, explain in simple terms**, keep functions short.
- Phone first: test layouts at 375×812 before desktop. Tap targets ≥ 44 px. Daylight contrast.
- Never commit secrets or personal data. The team code and the user's home live only in the phone's
  localStorage. `config.js` holds only public settings.
- The backend contract is in `docs/SPEC.md` §3. If you change `backend/Code.gs`, say so clearly:
  the owner must redeploy it in Apps Script by hand.
- Distances: haversine × 1.3. No precomputed matrices, no Python pipeline.
- Run `node --test` before every commit; fix failures, don't skip them.
- Ask before: pushing, enabling GitHub Pages, renaming the repo, or deleting files.
- Commit in small steps with clear messages.
