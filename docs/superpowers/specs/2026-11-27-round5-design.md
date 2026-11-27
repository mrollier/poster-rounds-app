# Round 5 – zones that make sense, codes per campaign, stars learned from swipes

Date: 2026-11-27. Status: approved by the owner (with the changes below), 2026-11-27.
Source: owner feedback on round 4 (tested on iPhone) plus five rounds of questions and three analyst
reports (comparison model, generalising scores, critic). Marked **[my call]** = decided by Claude, open to
correction; everything else was decided by the owner.

## Why

- Zones: borders that follow streets are right, but some zones are two separate patches, some have odd
  shapes, names point at the wrong neighbourhood, the bike spot (P) ends up at the zone's edge, and the way
  back to all zones is hidden in the sliding panel. The model zone is Zwijnaardse Dries: one whole
  statistical sector, good shape, good size.
- Stars: still not trusted. "Specific places are clearly wrong" and "the balance across levels is wrong".
  Facts found: the `importance` column (how busy) was filled in by Claude during import/research, so it is
  itself a guess; today's AI Safety stars are 33 / 49 / 307 (3★ / 2★ / 1★), nearly everything 1★.
- The owner wants organisers to "train" the stars for an event before volunteers go out, by swiping
  (Tinder-like) between two places, and wants roles: admins and volunteers.

## Goals, non-goals, anti-goals

Goals: one outline per zone, compact shapes, true names, P in the middle, an obvious way out of a zone;
a code per campaign and role; stars for AI Safety that the owner agrees with, learned from ~250 swipes
plus a few direct fixes; a plain-words explanation of how stars are made.

Non-goals (this round): the in-app learning model (phase 2, later); turn-by-turn navigation; an in-app team
overview (a summary tab in the sheet is enough); other events than AI Safety for the learned set (they keep
the current rule until trained).

Anti-goals: stars that change under volunteers mid-campaign (one planned exception: the running AI Safety
lecture campaign, see Timing); an admin code that leaks through a name;
a learned set that is worse than today's rule (there's a check, see 3.6).

## Approaches considered

| Part | Options considered | Chosen |
| --- | --- | --- |
| Zone building | sectors merged compactly · sectors as is (no merging) · three fixed official levels | sectors first, merged compactly, S/M/L kept |
| Busy sector (Boekentoren, 27 stops) | cut along inner streets · keep as one zone · straight cuts (today) | keep as one zone |
| Roles | organiser code · Team tab with roles · secret link | an admin code and a volunteer code per campaign |
| Rating instrument | swipe pairs · rate 0–3 per place · sort into tiers in the sheet | swipe pairs (+ admin override) |
| Turning swipes into stars for all places | Claude with swipes as calibration · small in-app model · both | Claude now; in-app model later |

The critic argued that for one rater, sorting ~100 places into tiers is cheaper than swiping. The owner
keeps swiping because it is meant as a training ritual for organisers before each campaign; the override
covers quick fixes.

---

## Part 1 – Zones and the map (no backend change)

1. **Building blocks:** Statbel statistical sectors (`data/sectors-gent.json`), unchanged.
2. **A sector is a zone as it is.** Only zones with less work than the target merge, and only with a
   neighbour that shares a **stretch of border** (at least one common edge, not just a corner; no joining
   through empty sectors). So a zone is always one connected area with one outline.
3. **Compact merges:** among the eligible neighbours, pick the merge whose result is most compact
   **[my call: compactness = Polsby–Popper 4π·area / perimeter², computed on the merged outline; ties →
   fewer minutes]**, still only if the merged work stays ≤ target × 1.3. Targets S/M/L = 20 / 45 / 90 min,
   chosen in Filters (unchanged).
4. **Busy sectors stay whole:** the straight-line cutting (`splitUnit`, `cut`) is removed. A sector with
   more work than the target is simply one big zone.
5. **Name** = Statbel name of the sector holding most of the zone's stops ("Kouter", "Boekentoren",
   "Rekencentrum"); repeats get " 2". A one-stop zone keeps its stop's name. The OpenStreetMap
   neighbourhood labels are no longer used for zones: `data/neighbourhoods-gent.json` and its loading code
   are deleted (owner agreed).
6. **Bike spot (P)** = the public bike rack nearest the middle of the zone's stops; no rack within 150 m →
   the middle point itself. The same for everyone; no longer depends on where you come from (`parkFor` and
   `view.zonePark` go). The walking loop starts and ends there.
7. **Way out of a zone:** a floating chip under the top bar while a zone is open: "✕ Kouter · 5/8 left".
   Tap → back to all zones. The "← All zones" button in the panel stays as well **[my call]**.
8. **Fit:** opening a zone fits the map to the zone's outline (today it can show only the P when all
   stops are done).
9. **Google Maps:** the "Google Maps ↗" link leaves the next-stop card; the map pop-up gets a small
   Google Maps icon link instead. List rows and route links are unchanged.
10. **"Outlines stay visible after tapping a zone":** not reproduced in WebKit; most likely the second
    patch of a split zone, which (2) removes. Check again on the phone after this part.

Tests: contiguity (no zone with more than one outline loop, on the real data for S/M/L), Polsby–Popper
improves or equals vs. today, names come from sectors, P nearest the middle, Boekentoren is one zone.

## Part 2 – Codes per campaign, names, summary (backend change: redeploy Code.gs by hand)

1. **Campaigns tab** gets two columns: `admin_code`, `volunteer_code`. A code belongs to exactly one
   campaign and gives one role. The global team code goes; the switch happens at once, with the deploy note
   telling the owner to fill in both codes for the active campaign first **[my call]**.
2. **Setup screen:** first the code. The backend answers with the campaign, the role and the list of known
   first names. Then the name: a dropdown of known names plus "Someone else…" (type it). The campaign picker
   disappears (the code decides). Names are only shown after a valid code.
3. **Known names** = distinct `by` values in Results plus `added_by` of places, excluding "Claude …"
   **[my call: no separate People tab]**.
4. **Backend:** every call carries the code; the backend finds the campaign and role from it; writes are
   only accepted for that campaign; admin-only actions (swipes, overrides) check the role.
5. **Summary tab** in the sheet: per volunteer: stops done, posters hung, last activity, as a formula tab
   (QUERY over Results) created once with the Sheets connector **[my call: formulas, no code]**.
6. **Add place, on site:** "+ Add place" gets an option "poster board inside <the place you're at>": it
   copies type, org and address from the nearest place, takes your GPS spot and asks for a short note
   ("ground floor, left of the lift"). Admins can then hide the generic faculty entry (setting `active`
   to FALSE, from the sheet).

## Part 3 – Stars learned from swipes (backend change: redeploy Code.gs by hand)

### 3.1 What a swipe judges
"Which place is better for promoting this event?" = one gut call: the right people × how many pass by.
So busyness is learned from the swipes; the `importance` column no longer decides stars where a learned
set exists.

### 3.2 Star sets
- A **set** = a score per place for one kind of event or one campaign: `default:AI Safety` or a
  `campaign_id`. Stars for a campaign come from its own set if it has one, else `default:<event_type>`,
  else today's rule (`stars()` in js/logic.js).
- **Default sets** are made by the developer and Claude. The default for AI Safety is trained through a
  dedicated campaign row ("Training: AI Safety", with its own admin code) **[my call]**; campaign swipes do
  **not** flow into the default (owner: per campaign only).
- **From scores to stars:** shares, frozen per set: the top 10% → 3★, next 15% → 2★, next 25% → 1★,
  the rest → 0★ (hidden). In Ghent ≈ 40 / 60 / 100 / 190. When a set is made, its three score
  thresholds are stored with it; afterwards stars are score vs. thresholds, so adding places never moves
  other places' stars. A new place (added on the street) gets the average score of places of its type and
  importance in that set until the set is remade **[my call]**.
- **Admin override:** in a place's pop-up, admins see "Stars for <event>: 0 1 2 3". An override is a
  per-place layer for that campaign (Overrides tab: `campaign_id, place_id, stars, by, at`) on top of
  whichever set applies; it is stored as stars, not a score; it does not feed the default set; it is used
  as training data (a fixed anchor) when that campaign's own set is rebuilt **[my call]**.
- **Filters with a learned set:** when a campaign's stars come from a learned set, the type preset is off
  (all types included; the stars decide what shows); types can still be unticked by hand. With the rule
  fallback, presets work as today **[my call]**.

### 3.3 The swipe screen (admins only; ☰ → "Train the stars")
- Two cards side by side; swipe left = left place better, right = right place better. Buttons:
  "About the same" (draw) and a "?" on each card ("don't know this place"). Undo the last swipe.
- A card: big type icon, the venue's website icon where known, name, type, address, a tiny map with the
  pin, and for every place a location line: the sector name and the nearest well-known place within
  ~300 m ("Overpoort · 80 m from Campus Ufo"), so look-alike cards such as city boards can be told apart. A `website` column is added to Places by a one-off research pass (subagents) **[my call]**.
  Website icons are fetched only when the swipe screen is open.
- Progress: "123 / 250", minimum comparisons per place, and a "settled" signal (see 3.4).
- Works offline: swipes go through the existing outbox.

### 3.4 The deck and the pairing (from the comparison analyst)
- **Deck of 60 active places:** at least one of each of the 23 types; the rest weighted towards the likely
  top (sci 9, boards 7, arts 5, student 4, ideas/startups/libraries/community/bookshops 3, …); within a
  type spread busyness; always include the places the owner named as clearly wrong. Places at one address
  are separate cards and may be paired (resto vs. library is useful to learn).
- **Pairing:** Swiss rounds with a fixed seed: 30 pairs per round, each place once; round 1 random,
  later rounds pair places with close current scores that haven't met; left/right random. ~8 rounds ≈ 250.
  The last 10 pairs repeat earlier pairs with sides swapped (consistency check).
- **"?"**: no outcome stored; that place leaves this admin's remaining pairs.
- **Several admins:** each admin swipes their own full ~250 with their own Swiss schedule (built from their
  own swipes only); the fit pools everyone's swipes. Shown per admin: their agreement with the pooled order
  (a low value flags a rater who sees it differently).
- **Quality shown:** comparisons per place (min ≥ 4), agreement on the repeated pairs (aim ≥ 80%), rank
  change after the last round (Spearman ≥ 0.9 = settled), share of draws (> 35% → "take a break").

### 3.5 Turning swipes into scores
- **Model:** Bradley–Terry; a draw counts as half a win; Gaussian prior θ ~ N(0, 1.5²) for stability;
  fitted by Newton steps per place (≈ 30 lines, the same in JS and Python). Overrides enter as fixed
  anchors at the score of their star level.
- **Phase 1 (now), Claude rates the other ~330 places:**
  1. Hold out 12 swiped places; fit BT on the rest.
  2. Pick 8–10 anchor places spread over the fitted scale (extra near the 10% / 25% / 50% lines).
  3. Claude places each other place "between anchor k and k+1" (closer to k / middle / closer to k+1),
     batches of ~30 mixed places, shuffled; two independent passes, averaged; a third pass where they differ
     by more than one anchor gap. Report the agreement between passes (Spearman ≥ 0.8, else sharpen the
     anchors).
  4. City boards are rated one by one like every other place (owner's decision). Their cards and Claude's
     input give a clear sense of place: the street, the sector name, and the nearest well-known place
     ("Overpoort board · 80 m from Campus Ufo").
  5. **Check:** on the 12 held-out places' real swipes, the new scores must predict the winner more often
     than today's rule. If not, keep today's rule and say so.
  6. Refit with all swipes; write the set to the sheet.
- **Phase 2 (later, not this round):** an in-app model (pairwise logistic regression on place features,
  starting from the default set) so organisers can retrain without Claude.

### 3.6 Is it better? (the owner's check)
Before the new set goes live the owner, blind, writes down "my top 25 for AI Safety". Compare the overlap
with today's top 25 and with the new top 25. The new set must clearly win; otherwise we don't switch.

### 3.7 Data (Google Sheet)
- **Overrides:** `campaign_id, place_id, stars (0–3), by, at` (latest row per place wins).
- **Swipes** (append only): `swipe_id, at, by, campaign_id, deck_version, round, left_id, right_id,
  outcome (left|right|draw|unknown_left|unknown_right), undo_of`.
- **Scores:** `set_id, place_id, score, source (swiped|predicted|board-rule|override), rater, n, updated_at`.
- **Sets:** `set_id, event, t3, t2, t1, made_by, made_at, note` (the frozen thresholds).
- **Places:** new column `website`.

### 3.8 Explanation for people
A section "How the stars are made" in README.md, in plain words: what a swipe means, how many, how the
scores are fitted (like chess ratings), how Claude fills in the rest using your swipes as examples, how
scores become 0–3 stars, overrides, and how to retrain. Plus SPEC §2.1 and §3 updated.

## Timing

The owner wants the learned AI Safety stars for the lecture campaign that is running now (posting until
9 Dec 2026). So the stars of that campaign change once, on purpose, when the set is ready (announced to the
volunteers). Order stays Part 1 → 2 → 3, built quickly; the critical path is the owner's ~250 swipes, the
Claude rating, the held-out check, the owner's blind top 25, and two manual Apps Script redeploys. Target:
set live by ~4 Dec, leaving 5 days of posting. If the check in 3.6 fails, the lecture keeps today's stars.

## Open

- The owner has no list of clearly wrong places; the deck leans towards places where the current
  importance is least certain instead, and the admin override handles wrong places found later.
- Each part is its own set of commits; parts 2 and 3 each need one manual Apps Script redeploy.
