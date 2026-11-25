# Poster map – hand-over kit (setup steps)

Everything needed to rebuild the poster map as a phone web app on GitHub Pages, with shared results in
Google Sheets. You do steps 1–3 by hand (about 15 minutes); Claude Code does the rest.

## What's in here

| Path | What |
|---|---|
| `PROMPT.md` | The prompt to paste into Claude Code |
| `CLAUDE.md` | Standing instructions for Claude Code (it reads this automatically) |
| `docs/SPEC.md` | The spec: features, data model, algorithms, quality bar |
| `backend/Code.gs` | The Apps Script backend (finished) |
| `data/*.csv` | Snapshot of the Google Sheet (198 places, 1 campaign, 35 carried-over results) |
| `data/racks-gent.json` | 3,368 public bike racks in Ghent (OpenStreetMap) for the Zones bike spots |
| `reference/prototype-index.html` | Today's working map, as reference for the route logic |
| `tests/backend.mock.test.js` | Tests the backend against a fake of the sheet (`node --test`) |

The live data is already in the Google Sheet **Poster map data (EA Ghent)** in the EA Ghent folder:
tabs README, Places, Campaigns, Results, Cities, Types, Log.

## 1. Put the backend online (Apps Script)

1. Open the sheet → **Extensions → Apps Script**.
2. Delete the sample code, paste the whole of `backend/Code.gs`, save.
3. **Project Settings (gear) → Script properties → Add**: `TEAM_CODE` = a code you choose
   (e.g. two words; you'll give it to volunteers).
4. **Deploy → New deployment → type: Web app**. Execute as: **Me**. Who has access: **Anyone**.
   Deploy, authorise with your Google account (it will warn that the app isn't verified: that's your own
   script; continue), and **copy the Web app URL** (ends in `/exec`).
5. Test in a browser:
   - `<URL>?action=ping` → `{"ok":true}`
   - `<URL>?action=bootstrap&code=<your code>` → a long JSON with places and 35 results.

If you ever change `Code.gs`: **Deploy → Manage deployments → edit → Version: New version**. The URL stays the same.

## 2. Open the kit in VS Code

1. Unzip this folder to where you keep code, e.g. `~/code/poster-map`, and open it in VS Code.
2. Open `PROMPT.md`, replace `<PASTE MY WEB APP URL HERE>` with the URL from step 1.
3. Make sure you're logged in to GitHub in the terminal (`gh auth status`; Claude Code will need it for step 9 of the prompt).

## 3. Run Claude Code

Start Claude Code in the folder and paste the part of `PROMPT.md` below the line. It works in nine
steps and stops for your OK after each one.

## After launch

- Send volunteers the URL and the team code; on the phone: open in Safari/Chrome → **Add to Home Screen**.
- **Stop using the old map** (the Claude artifact) once the new one is live: ticks there no longer sync.
  The 35 results from it (as of 25 Nov, ~16:00) are already in the Results tab, including Flordi's 2 posters.
- Next event: add a row in **Campaigns** (new id, dates, weights), set the old one `active = FALSE`.
- New city: a row in **Cities**, its places in **Places**, and a `data/racks-<city>.json` + neighbourhood file
  (ask Claude Code to extract them from OpenStreetMap).

## Priorities now come from tags

Each place has audience **tags** and an **importance** (1–3, from its old priority). A campaign gives a
weight per tag; priority = best (weight × importance). For the AI-safety lecture (science, entrepreneurs,
researchers, makers 3; other students and the general public 2; culture and nightlife 1) this gives
54 / 56 / 88 places at priority 1 / 2 / 3. Compared with the hand-set priorities, 25 places move up
(mostly science and business buildings, coworking spaces) and 9 move down (museums, theatres, cinemas).
Change a weight in the Campaigns tab to rebalance; no code involved.
