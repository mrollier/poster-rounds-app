/**
 * Poster map backend (Google Apps Script, bound to the sheet "Poster map data (EA Ghent)").
 *
 * What it does, in plain terms:
 *   - GET  ?action=bootstrap&code=...            -> everything the app needs for the code's campaign:
 *                                                  the campaign, your role, known names, cities, types,
 *                                                  places, results.
 *   - GET  ?action=results&code=...&since=ISO    -> only results changed after `since` (cheap polling).
 *   - POST {code, name, action:"result", ...}     -> save one result (posted / not possible / undo / note).
 *   - POST {code, name, action:"addPlace", ...}   -> add a new poster place found on the street.
 *   - POST {code, name, action:"swipe", ...}      -> admins: one comparison of two places (Swipes tab):
 *                                                  left / right better, both_low / both_mid / both_high (no
 *                                                  winner, both 0★ / 1–2★ / 3★), draw (older), unknown_*, undo.
 *   - POST {code, name, action:"override", ...}   -> admins: set one place's stars for the campaign (Overrides).
 *   Every result and new place is also appended to the Log tab (who, what, when).
 *
 * Learned stars: the Scores and Sets tabs hold a score per place for a "set" (a campaign_id, or
 * "default:<event type>"), and the score lines for 3/2/1 stars. They are filled from the swipes by a
 * developer (tools/fit-set.mjs); the app turns scores into stars. See README "How the stars are made".
 *
 * Codes: each campaign (row in Campaigns) has an admin_code and a volunteer_code. A code says which
 * campaign you work on and what you may do; every write lands in that campaign. Codes are never sent
 * back to the app. They are shared passwords, not real accounts: change them in the sheet if one leaks.
 *
 * Deploy: Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * The app POSTs with Content-Type text/plain, which avoids a CORS preflight (Apps Script can't answer one).
 */

const TABS = { places: 'Places', campaigns: 'Campaigns', results: 'Results', cities: 'Cities', types: 'Types', log: 'Log',
  swipes: 'Swipes', overrides: 'Overrides', scores: 'Scores', sets: 'Sets' };
const OUTCOMES = ['left', 'right', 'draw', 'both_high', 'both_mid', 'both_low', 'unknown_left', 'unknown_right', 'undo'];
const STATUSES = ['posted', 'nope', 'refused', 'full', 'closed', 'later', ''];
const MAX_BODY = 5000; // characters; anything bigger is not a legitimate request

// ---------- entry points ----------

function doGet(e) {
  return handle_(() => {
    const p = e.parameter || {};
    if (p.action === 'ping') return { ok: true };
    const who = auth_(p.code);
    if (p.action === 'bootstrap') return bootstrap_(who);
    if (p.action === 'results') return { results: resultsFor_(rows_(TABS.results), who.campaign.campaign_id, p.since), serverTime: new Date().toISOString() };
    throw new Error('unknown action');
  });
}

function doPost(e) {
  return handle_(() => {
    const raw = (e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BODY) throw new Error('request too large');
    const b = JSON.parse(raw);
    const who = auth_(b.code);
    b.campaign_id = who.campaign.campaign_id; // whatever the phone sends, a write lands in the code's campaign
    const name = clean_(b.name, 40);
    if (!name) throw new Error('name missing');
    if ((b.action === 'swipe' || b.action === 'override') && who.role !== 'admin') throw new Error('admin only');
    // The places a write is about must exist. Checked before the lock: it only reads, so other phones
    // needn't wait for it.
    const ids = b.action === 'swipe' ? [b.left_id, b.right_id] : b.action === 'result' || b.action === 'override' ? [b.place_id] : [];
    if (ids.length) {
      const known = placeIds_();
      if (ids.some(id => known.indexOf(String(id === undefined || id === null ? '' : id).trim()) < 0)) throw new Error('unknown place');
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(10000); // one write at a time, so two phones can't overwrite each other's row
    try {
      if (b.action === 'result') return saveResult_(b, name);
      if (b.action === 'addPlace') return addPlace_(b, name);
      if (b.action === 'swipe') return saveSwipe_(b, name);
      if (b.action === 'override') return saveOverride_(b, name);
      throw new Error('unknown action');
    } finally {
      lock.releaseLock();
    }
  });
}

// ---------- reads ----------

function bootstrap_(who) {
  const campaign = who.campaign;
  const city = String(campaign.city).trim().toLowerCase(); // "Gent " or "gent" still match "Gent"
  const places = rows_(TABS.places), results = rows_(TABS.results); // each tab read once
  return {
    serverTime: new Date().toISOString(),
    campaigns: [withoutCodes_(campaign)],
    campaign_id: campaign.campaign_id,
    role: who.role,
    names: names_(results, places),
    cities: rows_(TABS.cities),
    types: rows_(TABS.types),
    places: places.filter(p => isTrue_(p.active) && String(p.city).trim().toLowerCase() === city),
    results: resultsFor_(results, campaign.campaign_id),
    set: starSet_(campaign),
    overrides: overrides_(campaign.campaign_id),
    // Admins rebuild their swipe schedule from their own earlier swipes (the app keeps those with their name).
    swipes: who.role === 'admin' ? optionalRows_(TABS.swipes).filter(r => r.campaign_id === campaign.campaign_id) : undefined,
  };
}

/** The learned star set for this campaign: its own (set_id = campaign_id), else the default for its kind
 *  of event, else null (the app then uses the type rule). Scores and the 3/2/1-star lines as numbers. */
function starSet_(campaign) {
  const sets = optionalRows_(TABS.sets);
  const set = sets.find(x => x.set_id === campaign.campaign_id) || sets.find(x => x.set_id === 'default:' + campaign.event_type);
  if (!set) return null;
  const scores = {};
  optionalRows_(TABS.scores).filter(x => x.set_id === set.set_id).forEach(x => { scores[x.place_id] = Number(x.score); });
  return { set_id: set.set_id, t3: Number(set.t3), t2: Number(set.t2), t1: Number(set.t1), scores: scores };
}

/** {place_id: stars} set by admins for this campaign; the latest row per place wins, an empty one clears it. */
function overrides_(campaignId) {
  const out = {};
  optionalRows_(TABS.overrides).filter(x => x.campaign_id === campaignId).forEach(x => {
    if (x.stars === '') delete out[x.place_id]; else out[x.place_id] = Number(x.stars);
  });
  return out;
}

/** First names already used in the sheet (results and added places), for the name list on the phone. */
function names_(results, places) {
  const all = results.map(r => r.by).concat(places.map(p => p.added_by));
  const seen = {};
  all.forEach(n => { n = String(n || '').trim(); if (n && !/^Claude/.test(n)) seen[n] = true; });
  return Object.keys(seen).sort();
}

function resultsFor_(results, campaignId, since) {
  return results.filter(r => r.campaign_id === campaignId && (!since || r.at > since));
}

// ---------- writes ----------

/** Upsert one result: the row for (campaign, place, cycle) is replaced; fields left out keep their value. */
function saveResult_(b, name) {
  const campaignId = b.campaign_id, placeId = clean_(b.place_id, 40), cycle = clean_(b.cycle, 10); // (place checked in doPost)
  if (b.status !== undefined && STATUSES.indexOf(b.status) < 0) throw new Error('bad status');
  if (cycle && !/^\d{4}-\d{2}-\d{2}$/.test(cycle)) throw new Error('bad cycle');

  const sh = sheet_(TABS.results), data = sh.getDataRange().getDisplayValues(), head = data[0];
  const ci = head.indexOf('campaign_id'), pi = head.indexOf('place_id'), yi = head.indexOf('cycle');
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][ci] === campaignId && data[i][pi] === placeId && data[i][yi] === cycle) { rowIdx = i; break; }
  }
  const old = rowIdx > 0 ? Object.fromEntries(head.map((k, j) => [k, data[rowIdx][j]])) : {};
  // A result tapped while offline arrives late. If a teammate saved this stop after that tap, theirs is
  // newer: keep it and send it back (the phone then shows it). `at` itself stays the time of saving here,
  // so the other phones' "results since …" polling still picks up every change.
  const tapped = Date.parse(b.tapped_at);
  if (rowIdx > 0 && tapped && Date.parse(old.at) > tapped) return { ok: true, result: old, stale: true };
  const rec = {
    campaign_id: campaignId, place_id: placeId, cycle: cycle,
    status: b.status !== undefined ? b.status : (old.status || ''),
    posters: b.posters !== undefined ? Math.max(0, Math.min(50, parseInt(b.posters, 10) || 0)) : (old.posters || 0),
    note: b.note !== undefined ? clean_(b.note, 300) : (old.note || ''),
    by: name, at: new Date().toISOString(),
  };
  const values = [head.map(k => rec[k] !== undefined ? rec[k] : '')];
  if (rowIdx > 0) sh.getRange(rowIdx + 1, 1, 1, head.length).setValues(values);
  else sh.appendRow(values[0]);
  log_(rec, b.status === '' ? 'undo' : 'result');
  return { ok: true, result: rec };
}

/** Add a poster place found on the street. Returns the new row (with its id). */
function addPlace_(b, name) {
  const types = rows_(TABS.types).map(t => t.type);
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!(lat > -90 && lat < 90 && lon > -180 && lon < 180)) throw new Error('bad position');
  if (types.indexOf(b.type) < 0) throw new Error('bad type');
  const placeName = clean_(b.place_name, 100);
  if (!placeName) throw new Error('place name missing');
  const now = new Date();
  const id = 'X-' + Utilities.formatDate(now, 'Europe/Brussels', 'yyyyMMdd-HHmm') + '-' + Math.random().toString(36).slice(2, 4);
  const rec = {
    place_id: id, city: clean_(b.city, 40), name: placeName, org: clean_(b.org, 60), type: b.type,
    tags: clean_(b.tags, 120), importance: [1, 2, 3].indexOf(Number(b.importance)) >= 0 ? Number(b.importance) : 2,
    access: b.access === 'free' ? 'free' : 'ask', posters: Math.max(1, Math.min(10, parseInt(b.posters, 10) || 1)),
    address: clean_(b.address, 120), lat: lat.toFixed(6), lon: lon.toFixed(6), hours: clean_(b.hours, 120), open_days: '',
    notes: clean_(b.notes, 300), location_source: b.location_source === 'gps' ? 'app-gps' : 'app-tap', active: 'TRUE',
    added_by: name, added_at: now.toISOString().slice(0, 10),
  };
  const sh = sheet_(TABS.places), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  sh.appendRow(head.map(k => rec[k] !== undefined ? rec[k] : ''));
  log_({ campaign_id: b.campaign_id, place_id: id, cycle: '', status: '', posters: '', note: placeName, by: name }, 'addPlace');
  return { ok: true, place: rec };
}

/** One swipe: which of two places is better for promoting this campaign's event. Append only; an undo is
 *  a new row pointing at the swipe it takes back. */
function saveSwipe_(b, name) {
  if (OUTCOMES.indexOf(b.outcome) < 0) throw new Error('bad outcome'); // (places checked in doPost)
  const now = new Date();
  const rec = { swipe_id: 'S-' + now.getTime() + '-' + Math.random().toString(36).slice(2, 6), at: now.toISOString(), by: name,
    campaign_id: b.campaign_id, deck_version: clean_(b.deck_version, 20), round: parseInt(b.round, 10) || '',
    left_id: String(b.left_id).trim(), right_id: String(b.right_id).trim(), outcome: b.outcome, undo_of: clean_(b.undo_of, 40) };
  appendTo_(TABS.swipes, rec);
  return { ok: true, swipe_id: rec.swipe_id };
}

/** An admin sets one place's stars for this campaign (0–3), or clears it (""). */
function saveOverride_(b, name) { // (place checked in doPost)
  const stars = b.stars === '' ? '' : Number(b.stars);
  if (stars !== '' && [0, 1, 2, 3].indexOf(stars) < 0) throw new Error('bad stars');
  appendTo_(TABS.overrides, { campaign_id: b.campaign_id, place_id: String(b.place_id).trim(), stars: stars, by: name, at: new Date().toISOString() });
  return { ok: true };
}

// ---------- helpers ----------

/** Append a record to a tab in the tab's own column order. */
function appendTo_(tab, rec) {
  const sh = sheet_(tab), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  sh.appendRow(head.map(k => rec[k] !== undefined ? rec[k] : ''));
}

/** Like rows_, but a tab that doesn't exist (yet) is simply empty. */
function optionalRows_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name) ? rows_(name) : [];
}

function handle_(fn) {
  let out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Which campaign and role a code gives: {campaign, role: 'admin' | 'volunteer'}. Codes are case-sensitive;
 *  spaces around them (phone keyboards) are ignored. */
function auth_(code) {
  code = String(code || '').trim();
  if (!code) throw new Error('wrong code');
  for (const c of rows_(TABS.campaigns)) {
    // (a missing column or empty cell never matches: no campaign is open by accident)
    const is = v => v !== undefined && v !== null && String(v).trim() !== '' && code === String(v).trim();
    const role = is(c.admin_code) ? 'admin' : is(c.volunteer_code) ? 'volunteer' : '';
    if (!role) continue;
    if (!isTrue_(c.active)) throw new Error('campaign closed');
    return { campaign: c, role: role };
  }
  throw new Error('wrong code');
}

function withoutCodes_(c) {
  const out = Object.assign({}, c);
  delete out.admin_code; delete out.volunteer_code;
  return out;
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('missing tab ' + name);
  return sh;
}

/** Every place_id in the Places tab: just that column, so a check doesn't read the whole tab. */
function placeIds_() {
  const sh = sheet_(TABS.places), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const col = head.indexOf('place_id') + 1, n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, col, n, 1).getDisplayValues().map(r => r[0]).filter(id => id !== '') : []; // (an empty row is no place)
}

/** A tab as a list of objects keyed by the header row. Display values, so dates and numbers stay as typed. */
function rows_(name) {
  const data = sheet_(name).getDataRange().getDisplayValues();
  const head = data[0];
  return data.slice(1).filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((k, j) => [k, r[j]])));
}

/** The Log tab: who did what, when (in the tab's own column order, like every other append). */
function log_(rec, action) {
  appendTo_(TABS.log, Object.assign({}, rec, { at: new Date().toISOString(), action: action }));
}

/** Trim, cap the length, and neutralise a leading = + - @ so a value can never run as a spreadsheet formula. */
function clean_(v, max) {
  let s = String(v === undefined || v === null ? '' : v).trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

// TRUE, true, yes, 1 or x (with stray spaces): all count as "on"; anything else (empty, FALSE, no) as "off".
function isTrue_(v) { return ['TRUE', 'YES', '1', 'X'].indexOf(String(v).trim().toUpperCase()) >= 0; }
