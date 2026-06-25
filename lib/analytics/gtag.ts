// =============================================================================
// Google Analytics 4 (GA4) — pont gtag minimal, sans dépendance.
// =============================================================================
// L'ID de mesure vient de NEXT_PUBLIC_GA_ID (G-XXXXXXXXXX). S'il est absent
// (dev local, preview sans clé), TOUT est no-op → aucun chargement, aucun appel.
//
// Web ET APK couverts par la MÊME intégration : l'APK (Capacitor) charge l'app
// web distante (Vercel) dans son WebView → gtag s'exécute pareil. On distingue
// les deux via la user-property `platform` (web | android | ios), posée à l'init
// (cf. components/analytics/google-analytics.tsx) → segmentation dans GA.
// =============================================================================

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

/** GA4 est-il activé (clé présente) ? */
export const gaEnabled = !!GA_ID;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/** Vue de page (SPA App Router : envoyée manuellement à chaque navigation). */
export function gaPageView(path: string): void {
  if (!GA_ID || typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}

/**
 * Évènement métier générique (ex. add_to_cart, begin_checkout, purchase).
 * No-op silencieux si GA est désactivé ou pas encore chargé → jamais bloquant.
 */
export function gaEvent(
  name: string,
  params: Record<string, unknown> = {}
): void {
  if (!GA_ID || typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, params);
}
