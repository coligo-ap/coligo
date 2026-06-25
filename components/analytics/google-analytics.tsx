"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { GA_ID, gaPageView } from "@/lib/analytics/gtag";

// =============================================================================
// GoogleAnalytics — charge gtag.js (GA4) et suit les vues de page en SPA.
// =============================================================================
// Monté UNE fois dans le layout racine (couvre web + APK). Ne rend RIEN si
// NEXT_PUBLIC_GA_ID est absent → zéro impact en dev / preview sans clé.
//
// App Router = navigation SANS rechargement : gtag('config') envoie la 1ʳᵉ vue
// automatiquement (avec la user-property `platform`), puis on envoie chaque vue
// suivante MANUELLEMENT au changement de route. On saute donc le tout premier
// déclenchement de l'effet pour ne pas compter deux fois la page d'entrée.
//
// `platform` est détecté DANS le script d'init via le pont window.Capacitor
// (injecté par le natif) → web vs android vs ios, sans importer le SDK.
// =============================================================================

export function GoogleAnalytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // La 1ʳᵉ vue est déjà envoyée par gtag('config') → on ignore le 1er effet.
  const firstRun = useRef(true);

  useEffect(() => {
    if (!GA_ID) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const qs = searchParams?.toString();
    gaPageView(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, searchParams]);

  if (!GA_ID) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = window.gtag || gtag;
          gtag('js', new Date());
          var __plat = 'web';
          try {
            if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
              __plat = window.Capacitor.getPlatform() || 'web';
            }
          } catch (e) {}
          gtag('set', 'user_properties', { platform: __plat });
          gtag('config', '${GA_ID}', { page_path: window.location.pathname });
        `}
      </Script>
    </>
  );
}
