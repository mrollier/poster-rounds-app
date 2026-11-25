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
export class BackendError extends Error {}

// Apps Script always answers HTTP 200; failures come back as {ok: false, error}.
const FRIENDLY = {
  "wrong team code": "That team code is not right. Check it with the organiser.",
  "TEAM_CODE not set on the server": "The server is not set up yet (no team code). Tell the organiser.",
};

async function getJSON(params) {
  const url = new URL(CONFIG.APPS_SCRIPT_URL, location.href);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new BackendError("Can't reach the server. Check your mobile data or Wi-Fi and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!body) throw new BackendError("The server sent an unexpected answer. Try again in a minute.");
  if (body.ok === false) throw new BackendError(FRIENDLY[body.error] || `Server error: ${body.error}`);
  return body;
}

// Everything the app needs: campaigns, cities, types, places and results of one campaign.
export const bootstrap = (code, campaign) => getJSON({ action: "bootstrap", code, campaign });
