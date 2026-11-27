// Runs backend/Code.gs against an in-memory fake of the Google Sheet (seed CSVs). Run: node --test
// Run backend/Code.gs against an in-memory fake of the Google Sheet, to check reads, upserts, undo and addPlace.
const fs = require('fs'), path = require('path'), vm = require('vm');
const parseCSV = f => { const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/); const rows = [];
  for (const l of lines) { const r = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { r.push(cur); cur = ''; } else cur += ch; } r.push(cur); rows.push(r); } return rows; };
const D = path.join(__dirname, '..', 'data') + '/';
const tabs = { Places: parseCSV(D + 'places.csv'), Campaigns: parseCSV(D + 'campaigns.csv'), Results: parseCSV(D + 'results.csv'),
  Cities: parseCSV(D + 'cities.csv'), Types: parseCSV(D + 'types.csv'), Log: [['at','campaign_id','place_id','cycle','action','status','posters','note','by']] };
const sheet = name => tabs[name] && {
  getDataRange: () => ({ getDisplayValues: () => tabs[name].map(r => r.map(String)) }),
  getLastColumn: () => tabs[name][0].length,
  getRange: (r, c, nr, nc) => ({ getDisplayValues: () => tabs[name].slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc).map(String)),
                                 setValues: v => { tabs[name][r - 1] = v[0].map(String); } }),
  appendRow: row => tabs[name].push(row.map(String)),
};
const ctx = { SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: sheet }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: s => ({ setMimeType() { return JSON.parse(s); } }), MimeType: { JSON: 'json' } },
  Utilities: { formatDate: () => '20261125-1500' }, console };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8'), ctx);
const get = p => ctx.doGet({ parameter: p }), post = b => ctx.doPost({ postData: { contents: JSON.stringify(b) } });
const assert = require('assert');
assert.deepStrictEqual(get({ action: 'ping' }), { ok: true });
// A code belongs to one campaign and gives one role; codes never come back in an answer.
assert.strictEqual(get({ action: 'bootstrap', code: 'wrong' }).error, 'wrong code');
const boot = get({ action: 'bootstrap', code: ' secret ' }); // stray spaces from a phone keyboard
assert.strictEqual(boot.places.length, 198); assert.strictEqual(boot.results.length, 35); assert.strictEqual(boot.campaign_id, '2026-12-ai-safety-lecture');
assert.strictEqual(boot.role, 'volunteer');
assert.strictEqual(get({ action: 'bootstrap', code: 'admin-secret' }).role, 'admin');
assert.ok(boot.campaigns.every(c => !('admin_code' in c) && !('volunteer_code' in c)), 'codes leaked');
assert.ok(Array.isArray(boot.names) && boot.names.length > 0 && boot.names.every(n => !/^Claude/.test(n)), JSON.stringify(boot.names));
assert.strictEqual(get({ action: 'bootstrap', code: 'Secret' }).error, 'wrong code'); // case-sensitive
// A closed (inactive) campaign's code
tabs.Campaigns.push(tabs.Campaigns[1].map((v, j) => ({ 0: 'old-campaign', 8: 'FALSE' })[j] ?? v));
const hd = tabs.Campaigns[0]; tabs.Campaigns[2][hd.indexOf('admin_code')] = 'old-admin'; tabs.Campaigns[2][hd.indexOf('volunteer_code')] = 'old-vol';
assert.strictEqual(get({ action: 'bootstrap', code: 'old-vol' }).error, 'campaign closed');
const C = '2026-12-ai-safety-lecture';
let r = post({ code: 'secret', name: 'Test', action: 'result', campaign_id: C, place_id: 'T06', cycle: '', status: 'posted', posters: 2 });
assert.ok(r.ok, JSON.stringify(r));
r = post({ code: 'secret', name: 'Test', action: 'result', campaign_id: C, place_id: 'T06', cycle: '', note: '=HYPERLINK("x")' });
assert.strictEqual(r.result.status, 'posted'); assert.strictEqual(r.result.note[0], "'");          // note merged, formula neutralised
r = post({ code: 'secret', name: 'Test', action: 'result', campaign_id: C, place_id: 'T06', cycle: '', status: '' });
assert.strictEqual(r.result.status, '');                                                            // undo
assert.strictEqual(tabs.Results.filter(x => x[1] === 'T06').length, 1);                             // upsert, not duplicate
// A result tapped offline before a teammate's newer one arrives late: the teammate's result stays.
const beforeEve = new Date(Date.now() - 5000).toISOString();
post({ code: 'secret', name: 'Eve', action: 'result', campaign_id: C, place_id: 'T06', cycle: '', status: 'posted', posters: 1 });
r = post({ code: 'secret', name: 'Dana', action: 'result', campaign_id: C, place_id: 'T06', cycle: '', status: 'later', tapped_at: beforeEve });
assert.ok(r.stale); assert.strictEqual(r.result.status, 'posted'); assert.strictEqual(r.result.by, 'Eve');
r = post({ code: 'secret', name: 'Dana', action: 'result', campaign_id: C, place_id: 'T06', cycle: '', status: '', tapped_at: new Date(Date.now() + 1000).toISOString() });
assert.ok(!r.stale); assert.strictEqual(r.result.status, '');                                       // a newer tap still wins
assert.strictEqual(post({ code: 'secret', name: 'Test', action: 'result', campaign_id: C, place_id: 'NOPE', cycle: '', status: 'posted' }).error, 'unknown place');
assert.strictEqual(post({ code: 'secret', name: 'Test', action: 'result', campaign_id: C, place_id: 'B19', cycle: '2026-12-04', status: 'weird' }).error, 'bad status');
r = post({ code: 'secret', name: 'Test', action: 'addPlace', campaign_id: C, city: 'Gent', place_name: 'Café X', type: 'stages', tags: 'culture', lat: 51.05, lon: 3.72, location_source: 'gps' });
assert.ok(r.ok, JSON.stringify(r)); assert.ok(r.place.place_id.startsWith('X-'));
assert.strictEqual(get({ action: 'bootstrap', code: 'secret' }).places.length, 199);
// A write always lands in the code's own campaign, whatever campaign_id the phone sends.
r = post({ code: 'secret', name: 'Test', action: 'result', campaign_id: 'other', place_id: 'T07', cycle: '', status: 'posted', posters: 1 });
assert.strictEqual(r.result.campaign_id, C);
assert.ok(get({ action: 'results', code: 'secret', campaign: C, since: new Date(Date.now() - 60000).toISOString() }).results.some(x => x.place_id === 'T06'));
console.log('backend mock tests passed; log rows:', tabs.Log.length - 1);
