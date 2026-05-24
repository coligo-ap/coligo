import type { Metadata, Viewport } from "next";
import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import { APP_CONFIG } from "@/lib/config/app-config";
import { Toaster } from "@/components/ui/toast";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";
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

export const metadata: Metadata = {
  title: `${APP_CONFIG.name} — Espace commerçant`,
  description: APP_CONFIG.description,
  applicationName: APP_CONFIG.name,
  appleWebApp: {
    capable: true,
    title: APP_CONFIG.shortName,
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
      className={`${fontDisplay.variable} ${fontBody.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: KILL_EXTENSION_ATTRS }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
        <Toaster />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
