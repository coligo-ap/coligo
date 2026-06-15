// =============================================================================
// Ouverture de l'itinéraire dans l'app GPS du chauffeur (Google Maps, Waze,
// Apple Plans). Fonctionne sur Android, iPhone et web (les URL universelles
// rebondissent vers l'app native si installée, sinon le navigateur).
// =============================================================================
// Le choix de l'app est mémorisé (localStorage) → après le 1er choix, le
// chauffeur lance la navigation en un seul tap. « Changer d'app » réinitialise.
// =============================================================================

export type NavApp = "google" | "waze" | "apple";

const PREF_KEY = "coligo-nav-app";

export const NAV_APPS: { id: NavApp; label: string; emoji: string }[] = [
  { id: "google", label: "Google Maps", emoji: "🗺️" },
  { id: "waze", label: "Waze", emoji: "🚗" },
  { id: "apple", label: "Plans (Apple)", emoji: "🧭" },
];

export function getNavPref(): NavApp | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(PREF_KEY);
  return v === "google" || v === "waze" || v === "apple" ? v : null;
}

export function setNavPref(app: NavApp): void {
  if (typeof window !== "undefined") window.localStorage.setItem(PREF_KEY, app);
}

export function clearNavPref(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(PREF_KEY);
}

/** URL d'itinéraire (mode conduite) vers la destination, par app. */
export function navUrl(app: NavApp, lat: number, lng: number): string {
  switch (app) {
    case "waze":
      return `https://waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`;
    case "apple":
      return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
}

/** Ouvre l'itinéraire dans l'app demandée (nouvel onglet / app native). */
export function openNav(app: NavApp, lat: number, lng: number): void {
  if (typeof window === "undefined") return;
  window.open(navUrl(app, lat, lng), "_blank");
}

/**
 * Lance la navigation vers (lat,lng). Si une app préférée est mémorisée, elle
 * s'ouvre directement et la fonction renvoie `true`. Sinon renvoie `false` :
 * l'appelant doit afficher le sélecteur d'app GPS.
 */
export function tryOpenNav(lat: number, lng: number): boolean {
  const pref = getNavPref();
  if (!pref) return false;
  openNav(pref, lat, lng);
  return true;
}
