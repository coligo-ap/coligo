import { Noto_Sans_Arabic, Plus_Jakarta_Sans, Sora } from "next/font/google";

/**
 * COLIGO — POLICES, DÉCLARÉES UNE SEULE FOIS
 *
 * Avant, chaque layout (racine, livreur, chauffeur, Drive client, page de
 * partage) rappelait `next/font` pour les MÊMES familles : cinq déclarations
 * concurrentes de Sora et de Plus Jakarta Sans, chacune avec ses propres poids.
 * Tout part désormais d'ici — un layout ne choisit plus une police, il applique
 * les variables du design system.
 *
 * Deux familles de variables coexistent pour des raisons historiques :
 *   - `--font-display` / `--font-sans-body` : espaces client, commerçant, admin
 *     (consommées par le `@theme` de app/design-tokens.css) ;
 *   - `--font-sora` / `--font-jakarta` : espaces partenaires et Drive
 *     (consommées par maquette.css et les classes .drive-sora / .mq-sora).
 * Mêmes fontes, deux noms. Les poids sont l'union de ceux réellement utilisés.
 */

/** Titres — espaces client / commerçant / admin (classe `font-display`). */
export const fontDisplay = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["600", "700", "800"],
});

/** Corps et UI — espaces client / commerçant / admin. */
export const fontBody = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-body",
  weight: ["400", "500", "600", "700"],
});

/**
 * Arabe : Plus Jakarta et Sora ne couvrent pas les glyphes arabes. Appliquée
 * au `body` en mode RTL (cf. app/globals.css).
 */
export const fontArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  display: "swap",
  variable: "--font-arabic",
  weight: ["400", "500", "600", "700"],
});

/** Titres et chiffres — espaces partenaires et Drive (`.mq-sora`, `.drive-sora`). */
export const fontSora = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sora",
  weight: ["500", "600", "700", "800"],
});

/** Corps — espaces partenaires et Drive (`.drive-jakarta`). */
export const fontJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700"],
});

/** Variables du layout racine (client / commerçant / admin + arabe). */
export const ROOT_FONT_VARS = [
  fontDisplay.variable,
  fontBody.variable,
  fontArabic.variable,
].join(" ");

/** Variables des espaces partenaires et Drive (livreur, chauffeur, /drive, /t). */
export const PARTNER_FONT_VARS = [fontSora.variable, fontJakarta.variable].join(
  " "
);
