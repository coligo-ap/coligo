import type { Metadata } from "next";

/**
 * PWA par espace : chaque type d'utilisateur installe « son » application —
 * icône, nom et écran de démarrage propres (client / livreur / chauffeur
 * Drive / commerçant). Un manifest statique par espace (public/manifest-*.
 * webmanifest, ids distincts pour qu'Android les traite comme des apps
 * séparées malgré le scope commun) + surcharge `metadata` dans le layout du
 * segment via `pwaMetadata(space)`.
 *
 * Icônes générées depuis public/logo-coligo-*-app.png (2000×2000) →
 * public/icons/{space}-{192|512|apple}.png. Régénération : voir le bloc sharp
 * dans le commit, ou scripts/brand-assets.mjs pour les logos source.
 */

export type PwaSpace = "client" | "livreur" | "drive" | "commercant";

export const PWA_APPS: Record<
  PwaSpace,
  { name: string; shortName: string; manifest: string; startUrl: string }
> = {
  client: {
    name: "Coligo",
    shortName: "Coligo",
    manifest: "/manifest-client.webmanifest",
    startUrl: "/",
  },
  livreur: {
    name: "Coligo Livreur",
    shortName: "Livreur",
    manifest: "/manifest-livreur.webmanifest",
    startUrl: "/driver",
  },
  drive: {
    name: "Coligo Drive",
    shortName: "Coligo Drive",
    manifest: "/manifest-drive.webmanifest",
    startUrl: "/chauffeur",
  },
  commercant: {
    name: "Coligo COMMERCE",
    shortName: "COMMERCE",
    manifest: "/manifest-commercant.webmanifest",
    startUrl: "/dashboard",
  },
};

/**
 * Favicon (onglet navigateur) par espace. L'espace commerçant porte le logo
 * COMMERCE (bandeau) ; les autres gardent le logo Coligo neutre — le favicon
 * étant servi globalement, on évite d'afficher « COMMERCE » côté client.
 */
const FAVICONS: Record<PwaSpace, { ico: string; png32: string }> = {
  client: { ico: "/favicon.ico", png32: "/favicon-32.png" },
  livreur: { ico: "/favicon.ico", png32: "/favicon-32.png" },
  drive: { ico: "/favicon.ico", png32: "/favicon-32.png" },
  commercant: {
    ico: "/favicon-commerce.ico",
    png32: "/favicon-commerce-32.png",
  },
};

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

export const IOS_STARTUP_IMAGES = IOS_STARTUP_DEVICES.flatMap((d) => {
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

/**
 * Bloc `metadata` PWA d'un espace : manifest + apple-touch-icon + titre iOS.
 * À ÉTALER dans le `metadata` du layout du segment. Attention : Next fusionne
 * les metadata en SHALLOW merge (un champ objet du segment REMPLACE celui du
 * parent) → on redonne ici `icons` complet (favicons inclus) et `appleWebApp`
 * complet (startupImage incluse).
 */
export function pwaMetadata(space: PwaSpace): Metadata {
  const app = PWA_APPS[space];
  return {
    manifest: app.manifest,
    appleWebApp: {
      capable: true,
      title: app.shortName,
      // `default` : barre de statut iOS claire avec texte sombre, parfait avec
      // notre header mobile blanc qui remonte sous l'encoche via
      // `pt-[env(safe-area-inset-top)]`. Le rendu violet « plein-écran » est
      // assuré par le splash au lancement (`startupImage`).
      statusBarStyle: "default",
      startupImage: IOS_STARTUP_IMAGES,
    },
    icons: {
      icon: [
        { url: FAVICONS[space].ico, sizes: "48x48" },
        { url: FAVICONS[space].png32, sizes: "32x32", type: "image/png" },
        { url: `/icons/${space}-192.png`, sizes: "192x192", type: "image/png" },
      ],
      apple: [
        {
          url: `/icons/${space}-apple.png`,
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
  };
}
