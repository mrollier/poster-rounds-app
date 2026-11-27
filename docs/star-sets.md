# Making a learned star set (developer + Claude)

What this is for: turning the admins' swipes for one campaign (or for a "Training: <event>" campaign, which
then becomes the default for that kind of event) into a score for every place, and from there 0–3 stars.
The plain-words explanation is in README "How the stars are made"; the code is `js/rank.js` and
`tools/fit-set.mjs`. Protocol version: **v1** (2026-11-27).

## Steps

1. **Export the swipes.** From the sheet's Swipes tab, the rows of the campaign → `swipes.csv` (with the
   header). Export the Places tab → `places.csv` and Types → `types.csv`.
2. **Fit and pick anchors:** `node tools/fit-set.mjs anchors swipes.csv places.csv`.
   - The swipes are fitted (Bradley–Terry; a draw counts as half a win; an undo takes back that admin's last
     swipe of that pair; "?" counts for nothing). "Both 0★ / 1–2★ / 3★" is a draw plus each place's side of
     two fitted lines, the "3★ line" and the "1★ line" (`LINES` in `js/rank.js`); the lines are never anchors,
     held back, or written out. Swipes from before 2026-11-27 have plain draws ("About the same").
   - 12 swiped places are held back for the check in step 4.
   - 9 anchor places are picked, spread from best to worst.
   - All of this is written to `fit-work.json`.
3. **Claude rates the other places**, two independent passes in fresh contexts:
   - Batches of ~30 places, mixed types, shuffled; the second pass uses a different order.
   - Include the held-back places (unnamed as such) and the city boards: every place is rated one by one (owner).
   - For each place give Claude: name, type, address, notes, the sector name, and the nearest well-known place.
   - Prompt (keep it like this, so runs are comparable):
     > For a poster promoting a **<event>** event in Ghent: which anchor place is just better than this
     > place? Judge one thing: how many of the right people (who would come to this event) see a poster
     > here — the right audience × how many pass by. Ignore how easy it is to hang. Answer
     > `place_id,k,pos`: k = the number of the anchor just above it (−1 if it beats the best anchor),
     > pos = closer_top / middle / closer_bottom.
   - Then:
     - collect both passes in `placements.csv` (`place_id,k,pos`, two rows per place);
     - where the two passes differ by more than one anchor gap, do a third pass and keep the middle answer;
     - report the agreement between the passes: a Spearman correlation below ~0.8 means the anchors are too
       vague, so describe them better rather than doing more passes.
4. **Build and check:**
   `node tools/fit-set.mjs build fit-work.json placements.csv places.csv types.csv "<set_id>" "<event>" swipes.csv`
   - It prints how often the new scores and today's rule pick the winner on swipes that involve a held-back
     place.
   - **If the new scores don't beat today's rule, stop:** keep the rule and tell the organiser.
   - It also prints, for the places the admins called 3★ / 1–2★ / 0★, the stars the set gives them. Many
     "called 3★" at 2★ (or "called 0★" at 1★): tell the organiser the shares may not fit this event. (Don't
     count places above the fitted 3★ line instead: the prior pulls the few top places down, so that count
     comes out too low; in simulations ~4% for a true 10%.)
   - Then the organiser's blind check: before seeing the new set, they name ~10 places that must be 3★ for
     this event. Count how many of them get 3★ from the new set and from today's rule. The new set must
     get more (and at least 8 of 10); for each one it misses, say why.
5. **Write to the sheet:** append `scores.csv` to Scores and `set.csv` to Sets. The `set_id` is the
   campaign_id for that campaign only, or `default:<event>` for the default.
   - The 10% / 25% / 50% score lines in Sets freeze the stars. Places added later get the average of similar
     places.
   - To redo a set: delete its old rows in Scores and Sets first.
6. **Tell the organiser** what changed (3★ count, the biggest movers) and that phones show it after a refresh.

## Things to watch

- **Claude's own taste.** Compare the average score per type with the `ev:` weights in Types and explain any
  big jumps.
- **Swipes that are noise.** If the fit gets fewer than ~75% of its own training swipes right, more swipes
  won't help: the admins disagree, or the cards are unclear.
- **Ties at a line** (many boards around the 1★ line). Count the places within ±0.1 of each line and mention
  them.
