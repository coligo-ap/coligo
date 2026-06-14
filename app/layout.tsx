import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Sora, Plus_Jakarta_Sans, Noto_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { dirFor, type Locale } from "@/i18n/locale";
import { THEME_COOKIE } from "@/lib/theme/theme";
import { APP_CONFIG } from "@/lib/config/app-config";
import { pwaMetadata } from "@/lib/config/pwa";
import { Toaster } from "@/components/ui/toast";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";
import { ChunkErrorReload } from "@/components/pwa/chunk-error-reload";
import { CapacitorBootLog } from "@/components/pwa/capacitor-boot-log";
import { AppUpdateBanner } from "@/components/pwa/app-update-banner";
import { RouteProgressBar } from "@/components/shared/route-progress-bar";
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
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://coligo-liart.vercel.app"
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
  maximumScale: 5,
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
  // Thème : clair par défaut, sombre uniquement si choisi dans le header
  // (cookie) — on n'impose plus le réglage système de l'appareil.
  const isDark = (await cookies()).get(THEME_COOKIE)?.value === "dark";
  return (
    <html
      lang={locale}
      dir={dir}
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
        {/* CSS MapLibre — chargée via CDN parce que l'import
            `import "maplibre-gl/dist/maplibre-gl.css"` à l'intérieur d'un
            client component avec dynamic-import du JS n'était pas inclus
            dans le bundle prod (vérifié : 0 occurrence de `maplibre` dans
            le CSS Next.js). Ce lien garantit l'inclusion sur toutes les
            pages, même celles qui ne montent pas encore la carte. */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <NextIntlClientProvider>
          <Suspense fallback={null}>
            <RouteProgressBar />
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
