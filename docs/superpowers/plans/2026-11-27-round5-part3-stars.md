# Round 5 Part 3 – Stars learned from swipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admins train the stars for an event by swiping between two places (a time budget sets the number of swipes); scores fitted from the swipes (plus Claude's rating of the other places, done later in a session) turn into 0–3 stars by frozen shares; admins can override one place's stars from its pop-up; the README explains it all in plain words.

**Architecture:**
- Pure logic in a new `js/rank.js` (tested): Bradley–Terry fit, deck choice, Swiss pairing, quality numbers.
- `js/logic.js`: stars from a learned set + overrides.
- `js/train.js`: the swipe screen (DOM).
- Backend: two new write actions (`swipe`, `override`, admin only) and the bootstrap answer carries the learned set, the overrides and (admins) their own swipes.
- An offline Node tool `tools/fit-set.mjs` turns swipes (+ Claude's placements) into a Scores/Sets update; the Claude rating itself runs later in a developer session, once the owner has swiped.

**Spec:** `docs/superpowers/specs/2026-11-27-round5-design.md` (Part 3). Owner (2026-11-27): push everything; each admin swipes their own ~250; the learned AI Safety stars should reach the running lecture (set live by ~4 Dec).

## Global Constraints
- Plain JS, no dependencies, comments explain the why; tap targets ≥ 44 px; `node --test` before every commit; Code.gs change → owner redeploys by hand.
- Shares: top 10% → 3★, next 15% → 2★, next 25% → 1★, rest 0★; thresholds are stored with the set (frozen).
- BT: draw = half a win; prior N(0, 1.5²); "?" = no outcome.
- Deck: 60 active places; ≥ 1 per type; always the owner's known wrong places (Campus UFO, Vlerick, Timelab, Syntra Gent, Public library Bloemekenswijk, City board Stapelplein).
- Pairing: Swiss rounds of 30 from a fixed seed, built from this admin's own swipes only; sides random from the seed.
- Time budget: 5 / 10 / 15 / 25 min, ≈ 10 swipes per minute; progress bar; continues towards ~250.
- With a learned set the type preset is off (stars decide); overrides are a per-campaign layer on top.

## Review Focus
- An admin swipes offline: swipes wait in the outbox and must not show up as fake results.
- Undo right after a swipe that is still in the outbox: the undo row references it; the fit must drop the undone swipe.
- A campaign with a learned set and a place added later (no score): gets the average of its type and importance in the set.
- A volunteer (not admin) never sees "Train the stars" or the override buttons; the backend refuses their swipe/override.
- The old backend (before the redeploy) has no sets: stars fall back to today's rule without errors.

---

### Task 1: `js/rank.js` – fit, deck, pairing (pure, tested)
**Files:** create `js/rank.js`, `tests/rank.test.js`.
**Produces:**
- `fitBT(ids, comparisons, { sd = 1.5, mean = {} }) → Map(id → { score, sd, n })`, where comparisons are `[{ a, b, y }]` with y ∈ {1, 0.5, 0}: Newton steps per place, at most 50 sweeps.
- `chooseDeck(places, { size = 60, must = [] }) → place_id[]`: one per type first, then by a type quota (sci 9, boards 7, arts 5, student 4, ideas/startups/libraries/community/bookshops 3, research/makers/veggie/cafes/musicvenues/stages 2, rest 1), within a type by importance descending then place_id; the `must` names first.
- `swissRound(deck, done, scores, seed, round) → [{ left, right }]`: deck shuffled by the seed in round 1, else sorted by score; each place paired with the nearest unmet one; sides by the seed.
- `quality(comparisons, scores, before) → { minPer, drawShare, settled }`, where settled is the Spearman correlation between the scores before and after.
- `sharesToThresholds(scores, { t3 = .10, t2 = .25, t1 = .50 }) → { t3, t2, t1 }`, the score values at those ranks.
- `starsFromScore(score, set) → 0..3`.
**Tests:** BT recovers a known order from simulated comparisons (Spearman > 0.8 for 20 items × 100 comparisons, seeded); a draw halves; `chooseDeck` covers every type and includes the musts; `swissRound` pairs every place once and never repeats a met pair; thresholds give exactly 10/15/25/50% on 100 scores; `starsFromScore` maps the boundaries.

### Task 2: Backend – swipes, overrides, learned set in bootstrap
**Files:** `backend/Code.gs`, `tests/backend.mock.test.cjs`, mock tabs (Swipes, Overrides, Scores, Sets headers in the test and `tests/mock-server.js`).
- POST `swipe` (admin only): `{deck_version, round, left_id, right_id, outcome (left|right|draw|unknown_left|unknown_right|undo), undo_of?}` → append `swipe_id, at, by, campaign_id, …` to Swipes; returns `{ok, swipe_id}`.
- POST `override` (admin only): `{place_id, stars 0–3 or ""}` → append to Overrides.
- bootstrap adds:
  - `set`: `{ set_id, t3, t2, t1, scores: { place_id: score } }`, taken from the campaign's own set (`set_id = campaign_id`) or else `default:<event_type>`; null if neither exists;
  - `overrides`: `{ place_id: stars }`, latest row per place for the campaign;
  - `swipes`: this name's rows for the campaign, admins only.
- Tests: a volunteer's swipe gives `admin only`; an admin's swipe is appended; bootstrap returns overrides (latest wins), the set (campaign over default) and the admin's swipes.

### Task 3: App – stars from the set and overrides; outbox for swipes
**Files:** `js/logic.js` (`placeStars`), `js/app.js`, `js/sync.js` (`withPending` only for `action === "result"`), tests.
- `placeStars(place, { set, overrides, weights, fill })` → the override if there is one; else, with a set, `starsFromScore` of the place's score (no score: `fill` = the average score of places of the same type and importance in the set, else of the same type, else `t1`); else the existing `stars()` rule.
- When a set applies, the type preset is off (all types ticked unless the user unticks them).
- Tests for `placeStars` and the `withPending` filter.

### Task 4: Swipe screen and override buttons
**Files:** create `js/train.js`; `index.html` (a `<dialog id="train">`, plus a ☰ menu entry visible to admins); `css/app.css`; `js/views.js` (pop-up: admin override row "Stars for <event>: 0 1 2 3").
- ☰ opens a small menu: Settings · Train the stars (admins only).
- **Start:** "How much time do you have?" 5 / 10 / 15 / 25 min.
- **Each pair:** two cards side by side, each with:
  - a type icon (emoji map per type);
  - the website icon from `https://icons.duckduckgo.com/ip3/<host>.ico`, when a `website` column exists;
  - name, type and address;
  - a tiny map: one OSM tile at zoom 15 with a pin;
  - a location line: the sector name and the nearest 3★-type place within 300 m.
- **Gestures:**
  - swipe left = the left card is better, right = the right card is better;
  - an "About the same" button; a "?" on each card; Undo.
- **Progress:** a progress bar; "minimum per place", "settled" and the share of draws.
- **Recording:** each swipe goes through the outbox.
- Screen check (Playwright, mock, admin code): the screen opens, a swipe left/right posts the right outcome, "?" and undo work, a 5-minute budget ends after 50, a volunteer has no menu entry, the override sets a pin's stars and a volunteer's pop-up has no override row.

### Task 5: `tools/fit-set.mjs`, the protocol, the README explainer, the sheet
- `node tools/fit-set.mjs <swipes.csv> <places.csv> [placements.csv]`:
  1. Fits BT on the swipes, holding out 12 swiped places.
  2. Prints anchor places for Claude.
  3. Reads Claude's placements ("between anchor k and k+1": `place_id, k, pos`) and interpolates scores.
  4. Prints the held-out check: how often the new scores and today's rule each pick the swipe winner.
  5. Writes `scores.csv` and `set.csv` for the sheet.
- `docs/star-sets.md`: the rerun protocol (prompt text, batches of 30, two passes, rules for the boards).
- README section "How the stars are made", in plain words.
- Sheet (Sheets connector): tabs Swipes, Overrides, Scores, Sets with their headers; a `website` column in Places.
- Website research for the ~330 places other than boards: 4 subagents in parallel, written into the `website` column. Optional: if the research isn't done, cards simply show no website icon.
- Push. Then tell the owner:
  - redeploy `Code.gs` (once covers Parts 2 + 3);
  - the codes;
  - swipe about 250 times in sessions;
  - then ask Claude to "update the AI Safety ratings" (runs the protocol).
