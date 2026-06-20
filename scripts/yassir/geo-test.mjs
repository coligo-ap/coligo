import { CDP, findYassirPage } from "./cdp.mjs";

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");

async function ev(expr) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

const hasGoogle = await ev(
  "!!(window.google && google.maps && google.maps.Geocoder)"
);
console.log("google.maps.Geocoder available:", hasGoogle);
const hasDir = await ev(
  "!!(window.google && google.maps && google.maps.DirectionsService)"
);
console.log("DirectionsService available:", hasDir);

// Géocode un lieu
const geo = await ev(`(async () => {
  const g = new google.maps.Geocoder();
  const res = await g.geocode({ address: "Béjaïa centre ville, Algérie" });
  const r = res.results[0];
  return JSON.stringify({ place_id: r.place_id, lat: r.geometry.location.lat(), lng: r.geometry.location.lng(), addr: r.formatted_address });
})()`);
console.log("GEOCODE:", geo);

// Directions distance/durée
const dir = await ev(`(async () => {
  const ds = new google.maps.DirectionsService();
  const res = await ds.route({ origin: {lat:36.7553028,lng:5.0543396}, destination:{lat:36.7525297,lng:5.085492}, travelMode: google.maps.TravelMode.DRIVING });
  const leg = res.routes[0].legs[0];
  return JSON.stringify({ dist_m: leg.distance.value, dist_txt: leg.distance.text, dur_s: leg.duration.value, dur_txt: leg.duration.text });
})()`);
console.log("DIRECTIONS:", dir);

cdp.close();
process.exit(0);
