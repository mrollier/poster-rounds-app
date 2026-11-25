// The phone's location (GPS). Browsers share it only on https:// pages or on http://localhost.

// Plain-English messages for the ways geolocation can fail.
export function geoErrorText(err) {
  if (!window.isSecureContext) return "Location only works when the app is opened over https://.";
  if (err?.code === 1) {
    return "Location is blocked for this site. iPhone: Settings > Privacy & Security > Location Services: " +
      "switch it on, and set Safari Websites (or your browser) to While Using. Android: tap the icon left of " +
      "the address > Permissions > Location > Allow. Then reload the page.";
  }
  if (err?.code === 3) return "No location fix yet. Step outside or wait a few seconds, then try again.";
  return "Your location is not available right now. Check that location (GPS) is switched on.";
}

const toPos = p => ({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy) });

// One position, as {lat, lon, accuracy}. Rejects with a readable message. Used for "home = here".
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser can't share your location."));
    navigator.geolocation.getCurrentPosition(p => resolve(toPos(p)), err => reject(new Error(geoErrorText(err))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

// ---------- Live location ----------
// The GPS runs only while the app is on screen: it drains the battery, and a hidden page gets no updates anyway.

let watchId = null, last = null, handlers = null;

export const lastPosition = () => last; // {lat, lon, accuracy, at} or null

function start() {
  if (watchId !== null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(
    p => { last = { ...toPos(p), at: Date.now() }; handlers.onPosition(last); },
    err => {
      if (err.code === 1) stop(); // denied: asking again won't help until the user changes the setting
      handlers.onError(err.code, geoErrorText(err));
    },
    { enableHighAccuracy: true, maximumAge: 5000 });
}

function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

// Start watching now and whenever the app comes back on screen; stop when it is hidden.
// onPosition({lat, lon, accuracy}), onError(code, message). code 1 = denied, 2 = unavailable, 3 = timeout.
export function watchWhileVisible(onPosition, onError) {
  handlers = { onPosition, onError };
  if (!navigator.geolocation || !window.isSecureContext) return onError(0, geoErrorText(null));
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
}

// "Try again" after the user changed a setting.
export function restartWatching() { stop(); start(); }
