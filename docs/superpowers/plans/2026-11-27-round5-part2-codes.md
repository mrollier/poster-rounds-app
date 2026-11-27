# Round 5 Part 2 – Codes per campaign, names, summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A code belongs to one campaign and one role (admin / volunteer); after a valid code you pick your name from a list or type it; a Summary tab per volunteer; "+ Add place" can add a poster board inside the place you're at.

**Architecture:** `backend/Code.gs` resolves every request's code to {campaign, role}; the app sends the code as today. The app stays compatible with the old backend until the owner redeploys: a bootstrap answer without `role` means "old backend" and the old flow (campaign picker) is used.

**Spec:** `docs/superpowers/specs/2026-11-27-round5-design.md` (Part 2). Owner (2026-11-27): drop the old team code; push everything.

## Global Constraints
- Plain JS, no dependencies; comment the why; tap targets ≥ 44 px; `node --test` before every commit.
- Codes never leave the backend: no `admin_code` / `volunteer_code` in any answer.
- Changing `backend/Code.gs` → tell the owner clearly to redeploy by hand. Fill the codes in the sheet (Sheets connector) BEFORE asking for the redeploy, so nobody is locked out.

## Review Focus
- An old phone with the old team code saved, after the redeploy: gets "That code is not right", goes to setup, not a blank screen.
- A code with stray spaces or different case typed on a phone keyboard: spaces trimmed; case must match (codes are case-sensitive) → say so in the hint.
- A campaign set inactive while someone uses its code: "This campaign is closed" rather than a crash.
- Names list with "Claude (import)" etc.: those never appear.
- New phone, old backend still live (before the redeploy): app still works with the code "secret"-style team code and the campaign picker.

---

### Task 1: Backend: code → campaign + role
**Files:** `backend/Code.gs`, `tests/backend.mock.test.cjs`, `data/campaigns.csv` (add `admin_code,volunteer_code` = `admin-secret,secret`), `tests/mock-server.js` (no TEAM_CODE property needed).
- [ ] Tests first (backend.mock.test.cjs): `bootstrap` with `secret` → `role: "volunteer"`, `campaign_id` = the campaign, `campaigns` has no `admin_code`/`volunteer_code` keys, `names` is an array without entries starting with "Claude"; with `admin-secret` → `role: "admin"`; with `wrong` → error `wrong code`; a result posted with code `secret` but `campaign_id: "other"` is saved for the code's campaign; an inactive campaign's code → error `campaign closed`.
- [ ] Implement `auth_(code) → {campaign, role}` (trimmed code; match against active and inactive campaigns; inactive → `campaign closed`); `bootstrap_(auth)`, `resultsFor_` uses `auth.campaign.campaign_id`; writes force `campaign_id` to the code's campaign; `names_()` = distinct non-empty `by` (Results) + `added_by` (Places), minus names starting with "Claude", sorted. Remove `checkCode_` and TEAM_CODE. Header comment updated.
- [ ] `node --test` green; commit.

### Task 2: App: code first, then name; role saved
**Files:** `index.html` (setup form order: code, then part 2 with name select + "Someone else…" text field, home), `js/ui.js` (`setup`), `js/data.js` (FRIENDLY: `wrong code`, `campaign closed`), `js/app.js` (settings.role; `settings.campaign = boot.campaign_id`).
- [ ] Screen check first (scratchpad Playwright, mock): code `secret` → name list shows known names and "Someone else…"; choose "Someone else…" → text box; Start → main screen; Settings shows role "volunteer"; code `admin-secret` → role admin; wrong code → message; with a boot answer lacking `role` (old backend; simulate by stubbing `/exec` via `page.route`) the campaign picker and a plain name box still work.
- [ ] Implement; `settings.role` stored ("volunteer" when the backend gives none). A saved phone whose code fails with `wrong code` returns to setup with the message (existing `stop` path).
- [ ] Screen check green, `node --test` green; commit.

### Task 3: Add place: "poster board inside <place>"
**Files:** `js/addplace.js`, `js/app.js` (pass places), test in screen check.
- [ ] Screen check first: with GPS within 60 m of a place, "+ Add place" → "Use my position" → question "Is it a poster board inside <name>?" → Yes → form pre-filled: name "<name> – poster board", type and address copied, notes placeholder "Where inside? e.g. ground floor, left of the lift"; Save sends `org`, `address`.
- [ ] Implement `nearestPlace(here, places, 60)` in addplace.js; commit.

### Task 4: Summary tab, codes in the sheet, docs, push
- [ ] Sheets connector: add `admin_code`, `volunteer_code` columns to Campaigns with random codes (8 letters/digits, no look-alikes) for every campaign; create tab "Summary" with a QUERY formula over Results (per campaign and volunteer: stops done = status not empty and not "later", posters hung, last activity). Read back to verify.
- [ ] Docs: SPEC §3 (auth by campaign code, roles, names), README (setup, codes, Summary tab, redeploy note), `sw.js` SHELL bump.
- [ ] `node --test`, push, then tell the owner: redeploy Code.gs; the codes; volunteers re-enter the new code once.
