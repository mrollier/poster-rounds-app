// The phone's location (GPS). Location only works on https:// or http://localhost.

// Plain-English messages for the three ways geolocation can fail.
export function geoErrorText(err) {
  if (err?.code === 1) {
    return "Location is blocked for this site. iPhone: Settings > Privacy & Security > Location Services > " +
      "Safari Websites (or your browser) > While Using. Android: tap the lock icon next to the address > " +
      "Permissions > Location > Allow. Then reload the page.";
  }
  if (err?.code === 3) return "No location fix yet. Step outside or wait a few seconds, then try again.";
  return "Your location is not available right now. Check that location (GPS) is switched on.";
}

// One position, as {lat, lon, accuracy}. Rejects with a readable message.
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser can't share your location."));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), accuracy: p.coords.accuracy }),
      err => reject(new Error(geoErrorText(err))),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}
