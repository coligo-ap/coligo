import type { Metadata, Viewport } from "next";
import { Sora, Plus_Jakarta_Sans } from "next/font/google";
import { APP_CONFIG } from "@/lib/config/app-config";
import { Toaster } from "@/components/ui/toast";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";
import { CapacitorBootLog } from "@/components/pwa/capacitor-boot-log";
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

// Splash screens iOS — générés par `scripts/ios-splash.mjs` (à relancer si la
// couleur de marque change). Apple exige une image par couple device-width ×
// device-height × pixel-ratio × orientation.
const IOS_STARTUP_DEVICES = [
  { name: "se", w: 375, h: 667, r: 2 },
  { name: "8plus", w: 414, h: 736, r: 3 },
  { name: "x", w: 375, h: 812, r: 3 },
  { name: "xr-11", w: 414, h: 896, r: 2 },
  { name: "xsmax-11pm", w: 414, h: 896, r: 3 },
  { name: "12-13-14", w: 390, h: 844, r: 3 },
  { name: "14plus-13pm", w: 428, h: 926, r: 3 },
  { name: "14pro-15", w: 393, h: 852, r: 3 },
  { name: "15pm-14pm", w: 430, h: 932, r: 3 },
];

const IOS_STARTUP_IMAGES = IOS_STARTUP_DEVICES.flatMap((d) => {
  const base = `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.r})`;
  return [
    {
      url: `/ios-splash/${d.name}-portrait.png`,
      media: `${base} and (orientation: portrait)`,
    },
    {
      url: `/ios-splash/${d.name}-landscape.png`,
      media: `${base} and (orientation: landscape)`,
    },
  ];
});

export const metadata: Metadata = {
  title: `${APP_CONFIG.name} — Espace commerçant`,
  description: APP_CONFIG.description,
  applicationName: APP_CONFIG.name,
  appleWebApp: {
    capable: true,
    title: APP_CONFIG.shortName,
    // `default` : barre de statut iOS claire avec texte sombre, parfait avec
    // notre header mobile blanc qui remonte sous l'encoche via
    // `pt-[env(safe-area-inset-top)]`. Le rendu violet « plein-écran » est
    // assuré par le splash au lancement (`startupImage`).
    statusBarStyle: "default",
    startupImage: IOS_STARTUP_IMAGES,
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
        <CapacitorBootLog />
      </body>
    </html>
  );
}
