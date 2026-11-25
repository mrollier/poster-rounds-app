// Distances and travel times. Points are {lat, lon}. Pure functions, no DOM.

// Streets don't go in straight lines: real routes in Ghent are about 1.3 × the straight-line distance.
export const DETOUR = 1.3;
export const SPEED_KMH = { bike: 15, walk: 4.5 };

// Straight-line distance in metres (haversine formula: distance over the earth's surface).
// Works on places straight from the sheet too (lat/lon as text): the + turns text into numbers.
export function hav(a, b) {
  const r = Math.PI / 180, la1 = +a.lat * r, la2 = +b.lat * r, dLa = la2 - la1, dLo = (+b.lon - +a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Estimated distance along the streets, in metres.
export const dist = (a, b) => hav(a, b) * DETOUR;

// Minutes to cover `metres` by bike or on foot.
export const minutes = (metres, mode) => metres / (SPEED_KMH[mode] * 1000 / 60);

// Minutes spent at a stop: a city board is quick, a building means finding the desk or the notice board.
export const stopMinutes = place => (place.type === "boards" ? 3 : 5);

// Places come from the sheet as strings; this gives the {lat, lon} numbers.
export const pt = place => ({ lat: +place.lat, lon: +place.lon });
