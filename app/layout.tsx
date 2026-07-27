import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Sora, Plus_Jakarta_Sans, Noto_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { dirFor, type Locale } from "@/i18n/locale";
import { THEME_COOKIE } from "@/lib/theme/theme";
import { NATIVE_COOKIE } from "@/lib/config/native";
import { getAppTheme, appThemeCssVars } from "@/lib/data/app-theme";
import { APP_CONFIG } from "@/lib/config/app-config";
import { pwaMetadata } from "@/lib/config/pwa";
import { Toaster } from "@/components/ui/toast";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";
import { ChunkErrorReload } from "@/components/pwa/chunk-error-reload";
import { CapacitorBootLog } from "@/components/pwa/capacitor-boot-log";
import { AppUpdateBanner } from "@/components/pwa/app-update-banner";
import { RouteProgressBar } from "@/components/shared/route-progress-bar";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import { IntroSplash } from "@/components/brand/intro-splash";
import { Suspense } from "react";
import "./globals.css";

// Typo storefront (prompt 20 redesign) :
//   - Sora pour les titres (600-800)
//   - Plus Jakarta Sans pour le corps et l'UI (400-700)
// Variables CSS exposées via next/font, lues par @theme dans globals.css.
const fontDisplay = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["600", "700", "800"],
});
const fontBody = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-body",
  weight: ["400", "500", "600", "700"],
});
// Police arabe : Plus Jakarta / Sora ne couvrent pas les glyphes arabes. On
// expose une variable appliquée au body en mode RTL (cf. globals.css).
const fontArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-arabic",
  weight: ["400", "500", "600", "700"],
});

// Splash screens iOS + manifest/icônes PWA : centralisés dans lib/config/pwa.ts
// (chaque espace — client, livreur, Drive, commerçant — installe « son » app
// avec son icône et son nom ; le layout racine porte la version CLIENT).

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://coligo.app"
  ),
  // Titre neutre par défaut (espace CLIENT / marketplace). Chaque autre espace
  // (commerçant, livreur) surcharge ce titre dans son propre layout — sinon
  // Tawk.to (qui reprend `document.title`) annonçait « Espace commerçant »
  // même pour un client.
  title: APP_CONFIG.name,
  description: APP_CONFIG.description,
  applicationName: APP_CONFIG.name,
  openGraph: {
    title: APP_CONFIG.name,
    description: APP_CONFIG.tagline,
    siteName: APP_CONFIG.name,
    type: "website",
    locale: "fr_DZ",
    images: [
      { url: "/og-image.png", width: 1200, height: 630, alt: APP_CONFIG.name },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_CONFIG.name,
    description: APP_CONFIG.tagline,
    images: ["/og-image.png"],
  },
  formatDetection: {
    telephone: false,
  },
  // Manifest + icônes + titre iOS de l'app CLIENT (les espaces livreur /
  // chauffeur / commerçant surchargent dans leur layout).
  ...pwaMetadata("client"),
};

export const viewport: Viewport = {
  themeColor: APP_CONFIG.brand.primary,
  width: "device-width",
  initialScale: 1,
  // maximumScale: 1 = LE correctif du zoom iOS au focus d'un input : dès
  // qu'un champ a une police < 16px, iOS zoome la page au tap et, en
  // plein écran (viewport-fit=cover), ce zoom RESTE COINCÉ — app
  // inutilisable jusqu'au kill (bug vécu iPhone build 25, tous les inputs).
  // Comportement app native façon Uber : aucun zoom de PAGE. Le pincement
  // reste possible dans Safari web (iOS ignore cette limite pour le geste
  // utilisateur — accessibilité préservée sur le site) et les CARTES
  // gardent leur propre zoom (canvas MapLibre, indépendant du zoom de page).
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Neutralise les attributs ajoutés par certaines extensions de navigateur
// (Bitdefender TrafficLight injecte `bis_skin_checked` / `bis_register` sur
// tous les <div>, ce qui casse l'hydratation React). Le script tourne avant
// l'extension et avant l'hydratation : il bloque les écritures et nettoie
// toute attribute mutation qui passerait quand même.
const KILL_EXTENSION_ATTRS = `
(function(){
  var BLOCKED = ['bis_skin_checked','bis_register'];
  function isBlocked(n){
    if(!n) return false;
    if(BLOCKED.indexOf(n) !== -1) return true;
    if(typeof n.indexOf === 'function' && n.indexOf('__processed_') === 0) return true;
    return false;
  }
  try {
    var proto = Element.prototype;
    var origSet = proto.setAttribute;
    proto.setAttribute = function(name, value){
      if(isBlocked(name)) return;
      return origSet.call(this, name, value);
    };
    var origSetNS = proto.setAttributeNS;
    proto.setAttributeNS = function(ns, name, value){
      if(isBlocked(name)) return;
      return origSetNS.call(this, ns, name, value);
    };
  } catch(e) {}
  function strip(root){
    if(!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll('[bis_skin_checked],[bis_register]');
    for(var i=0;i<els.length;i++){
      els[i].removeAttribute('bis_skin_checked');
      els[i].removeAttribute('bis_register');
    }
  }
  function arm(){
    strip(document.documentElement);
    try {
      new MutationObserver(function(muts){
        for(var i=0;i<muts.length;i++){
          var m = muts[i];
          if(m.type === 'attributes' && isBlocked(m.attributeName) && m.target && m.target.removeAttribute){
            m.target.removeAttribute(m.attributeName);
          } else if(m.type === 'childList' && m.addedNodes){
            for(var j=0;j<m.addedNodes.length;j++) strip(m.addedNodes[j]);
          }
        }
      }).observe(document.documentElement, {
        attributes: true,
        subtree: true,
        childList: true,
        attributeFilter: BLOCKED
      });
    } catch(e) {}
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', arm, { once: true });
  } else {
    arm();
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = (await getLocale()) as Locale;
  const dir = dirFor(locale);
  // Thème d'apparence « occasion » (mig 0415, piloté /admin/controle) : posé en
  // variables CSS sur <html> — lecture MISE EN CACHE (tag "app-theme"), donc
  // pas d'aller-retour DB par requête. Consommé par les héros d'auth.
  const appTheme = await getAppTheme();
  // Thème : clair par défaut, sombre uniquement si choisi dans le header
  // (cookie) — on n'impose plus le réglage système de l'appareil.
  const cookieStore = await cookies();
  const isDark = cookieStore.get(THEME_COOKIE)?.value === "dark";
  // Posé par /api/start/<role>, la server.url des APK. Écrit dans le HTML pour
  // que l'intro sache qu'elle tourne dans une app installée SANS attendre que
  // le pont Capacitor soit injecté. cf. lib/config/native.ts
  const isNativeApp = cookieStore.get(NATIVE_COOKIE)?.value === "1";
  return (
    <html
      lang={locale}
      dir={dir}
      data-app={isNativeApp ? "native" : undefined}
      style={appThemeCssVars(appTheme.theme) as React.CSSProperties}
      className={[
        fontDisplay.variable,
        fontBody.variable,
        fontArabic.variable,
        isDark ? "theme-dark" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: KILL_EXTENSION_ATTRS }} />
        {/* Connexion chaude au fournisseur de tuiles (OpenFreeMap) AVANT que la
            carte n'en ait besoin → style + tuiles arrivent plus vite au 1er
            montage de DriveMap (Drive client, accueil chauffeur). */}
        <link
          rel="preconnect"
          href="https://tiles.openfreemap.org"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://tiles.openfreemap.org" />
        {/* CSS MapLibre — servie depuis /public parce que l'import
            `import "maplibre-gl/dist/maplibre-gl.css"` à l'intérieur d'un
            client component avec dynamic-import du JS n'était pas inclus
            dans le bundle prod (vérifié : 0 occurrence de `maplibre` dans
            le CSS Next.js). Ce lien garantit l'inclusion sur toutes les
            pages, même celles qui ne montent pas encore la carte.

            Autrefois servie par unpkg.com : tout <link rel=stylesheet> du
            <head> bloque le premier paint, donc CHAQUE page attendait un
            DNS + TLS + fetch vers un CDN tiers avant d'afficher le moindre
            pixel (mesuré : premier style à ~1,6 s en local, bien pire sur
            réseau mobile). En même origine, elle est multiplexée avec le
            reste et ne coûte plus rien.

            À recopier lors d'une montée de version de maplibre-gl :
              cp node_modules/maplibre-gl/dist/maplibre-gl.css public/vendor/ */}
        <link rel="stylesheet" href="/vendor/maplibre-gl.css" />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {/* Intro de marque — PREMIER nœud du <body> pour être peinte dès la
            frame 0, avant tout contenu applicatif. Ne s'affiche que dans une
            app installée (APK / PWA standalone) et jamais deux fois de suite :
            cf. components/brand/intro-splash.tsx. */}
        <IntroSplash />
        <NextIntlClientProvider>
          <Suspense fallback={null}>
            <RouteProgressBar />
          </Suspense>
          {/* GA4 — web + APK. No-op si NEXT_PUBLIC_GA_ID absent. Suspense requis
              car le suivi de page lit useSearchParams. */}
          <Suspense fallback={null}>
            <GoogleAnalytics />
          </Suspense>
          {children}
          <Toaster />
          <ChunkErrorReload />
          <RegisterServiceWorker />
          <CapacitorBootLog />
          {/* Bandeau « nouvelle version » — visible uniquement dans un APK
              dont le build est inférieur à la dernière version publiée. */}
          <AppUpdateBanner />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
