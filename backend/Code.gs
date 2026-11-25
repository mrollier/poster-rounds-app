/**
 * Poster map backend (Google Apps Script, bound to the sheet "Poster map data (EA Ghent)").
 *
 * What it does, in plain terms:
 *   - GET  ?action=bootstrap&code=...            -> everything the app needs for the active campaign(s):
 *                                                  cities, types, campaigns, places, results.
 *   - GET  ?action=results&code=...&campaign=...&since=ISO -> only results changed after `since` (cheap polling).
 *   - POST {code, name, action:"result", ...}     -> save one result (posted / not possible / undo / note).
 *   - POST {code, name, action:"addPlace", ...}   -> add a new poster place found on the street.
 *   Every write is also appended to the Log tab (who, what, when).
 *
 * Security: every call needs the team code (Script properties > TEAM_CODE). The web-app URL ends up
 * in the public website, so the code is what keeps strangers from writing. It is a shared password,
 * not real authentication: change it if it leaks.
 *
 * Deploy: Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * The app POSTs with Content-Type text/plain, which avoids a CORS preflight (Apps Script can't answer one).
 */

const TABS = { places: 'Places', campaigns: 'Campaigns', results: 'Results', cities: 'Cities', types: 'Types', log: 'Log' };
const STATUSES = ['posted', 'nope', 'refused', 'full', 'closed', 'later', ''];
const MAX_BODY = 5000; // bytes; anything bigger is not a legitimate request

// ---------- entry points ----------

function doGet(e) {
  return handle_(() => {
    const p = e.parameter || {};
    if (p.action === 'ping') return { ok: true };
    checkCode_(p.code);
    if (p.action === 'bootstrap') return bootstrap_(p.campaign);
    if (p.action === 'results') return { results: resultsFor_(p.campaign, p.since), serverTime: new Date().toISOString() };
    throw new Error('unknown action');
  });
}

function doPost(e) {
  return handle_(() => {
    const raw = (e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BODY) throw new Error('request too large');
    const b = JSON.parse(raw);
    checkCode_(b.code);
    const name = clean_(b.name, 40);
    if (!name) throw new Error('name missing');
    const lock = LockService.getScriptLock();
    lock.waitLock(10000); // one write at a time, so two phones can't overwrite each other's row
    try {
      if (b.action === 'result') return saveResult_(b, name);
      if (b.action === 'addPlace') return addPlace_(b, name);
      throw new Error('unknown action');
    } finally {
      lock.releaseLock();
    }
  });
}

// ---------- reads ----------

function bootstrap_(campaignId) {
  const campaigns = rows_(TABS.campaigns).filter(c => isTrue_(c.active));
  const campaign = campaigns.find(c => c.campaign_id === campaignId) || campaigns[0] || null;
  const city = campaign ? campaign.city : null;
  return {
    serverTime: new Date().toISOString(),
    campaigns: campaigns,
    campaign_id: campaign ? campaign.campaign_id : null,
    cities: rows_(TABS.cities),
    types: rows_(TABS.types),
    places: rows_(TABS.places).filter(p => isTrue_(p.active) && (!city || p.city === city)),
    results: campaign ? resultsFor_(campaign.campaign_id) : [],
  };
}

function resultsFor_(campaignId, since) {
  return rows_(TABS.results).filter(r => r.campaign_id === campaignId && (!since || r.at > since));
}

// ---------- writes ----------

/** Upsert one result: the row for (campaign, place, cycle) is replaced; fields left out keep their value. */
function saveResult_(b, name) {
  const campaignId = clean_(b.campaign_id, 80), placeId = clean_(b.place_id, 40), cycle = clean_(b.cycle, 10);
  if (!rows_(TABS.campaigns).some(c => c.campaign_id === campaignId)) throw new Error('unknown campaign');
  if (!rows_(TABS.places).some(p => p.place_id === placeId)) throw new Error('unknown place');
  if (b.status !== undefined && STATUSES.indexOf(b.status) < 0) throw new Error('bad status');
  if (cycle && !/^\d{4}-\d{2}-\d{2}$/.test(cycle)) throw new Error('bad cycle');

  const sh = sheet_(TABS.results), data = sh.getDataRange().getDisplayValues(), head = data[0];
  const col = k => head.indexOf(k);
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][col('campaign_id')] === campaignId && data[i][col('place_id')] === placeId && data[i][col('cycle')] === cycle) { rowIdx = i; break; }
  }
  const old = rowIdx > 0 ? Object.fromEntries(head.map((k, j) => [k, data[rowIdx][j]])) : {};
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
  log_({ campaign_id: clean_(b.campaign_id, 80), place_id: id, cycle: '', status: '', posters: '', note: placeName, by: name }, 'addPlace');
  return { ok: true, place: rec };
}

// ---------- helpers ----------

function handle_(fn) {
  let out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkCode_(code) {
  const want = PropertiesService.getScriptProperties().getProperty('TEAM_CODE');
  if (!want) throw new Error('TEAM_CODE not set on the server');
  if (String(code || '') !== want) throw new Error('wrong team code');
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('missing tab ' + name);
  return sh;
}

/** A tab as a list of objects keyed by the header row. Display values, so dates and numbers stay as typed. */
function rows_(name) {
  const data = sheet_(name).getDataRange().getDisplayValues();
  const head = data[0];
  return data.slice(1).filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(head.map((k, j) => [k, r[j]])));
}

function log_(rec, action) {
  sheet_(TABS.log).appendRow([new Date().toISOString(), rec.campaign_id, rec.place_id, rec.cycle, action,
    rec.status, rec.posters, rec.note, rec.by]);
}

/** Trim, cap the length, and neutralise a leading = + - @ so a value can never run as a spreadsheet formula. */
function clean_(v, max) {
  let s = String(v === undefined || v === null ? '' : v).trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function isTrue_(v) { return String(v).toUpperCase() === 'TRUE'; }
