// Talking to the backend (Apps Script web app) and saving things on the phone (localStorage).
import { CONFIG } from "../config.js";

// localStorage stores text only, so values go in and out as JSON. Failures (private mode, full) are ignored.
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
};

// An error with a message the user can read.
//   offline: no connection (try again later)    stop: wrong/missing team code (fix settings first)
export class BackendError extends Error {
  constructor(msg, { offline = false, stop = false } = {}) { super(msg); this.offline = offline; this.stop = stop; }
}

// Apps Script always answers HTTP 200; failures come back as {ok: false, error}.
const FRIENDLY = {
  "wrong team code": "That team code is not right. Check it with the organiser.",
  "TEAM_CODE not set on the server": "The server is not set up yet (no team code). Tell the organiser.",
};

async function call(url, options) {
  let res;
  try {
    res = await fetch(url, { cache: "no-store", ...options });
  } catch {
    throw new BackendError("Can't reach the server. Check your mobile data or Wi-Fi and try again.", { offline: true });
  }
  const body = await res.json().catch(() => null);
  if (!body) throw new BackendError("The server sent an unexpected answer. Try again in a minute.", { offline: true });
  if (body.ok === false) {
    // Our own mistakes in a request (bad/unknown …, … missing) will never succeed; anything else (a busy
    // sheet, a Google hiccup) may work next time, so it counts as "try again later".
    const permanent = /^(bad|unknown|request too large)|missing$/.test(body.error);
    throw new BackendError(FRIENDLY[body.error] || `Server error: ${body.error}`,
      { stop: !!FRIENDLY[body.error], offline: !FRIENDLY[body.error] && !permanent });
  }
  return body;
}

function getJSON(params) {
  const url = new URL(CONFIG.APPS_SCRIPT_URL, location.href);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return call(url);
}

// Writes go as text/plain: a "simple" request, so the browser skips the CORS preflight Apps Script can't answer.
const postJSON = body => call(new URL(CONFIG.APPS_SCRIPT_URL, location.href), {
  method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body),
});

// Everything the app needs: campaigns, cities, types, places and results of one campaign.
export const bootstrap = (code, campaign) => getJSON({ action: "bootstrap", code, campaign });

// Only the results changed after `since` (an ISO time). Cheap: used for polling.
export const fetchResults = (code, campaign, since) => getJSON({ action: "results", code, campaign, since });

// Save one result. body: {action: "result", campaign_id, place_id, cycle, status?, posters?, note?}
export const postWrite = (code, name, body) => postJSON({ ...body, code, name });
