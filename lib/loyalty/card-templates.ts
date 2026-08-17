import { LOYALTY_CARD } from "@/lib/design/tokens";

/**
 * MODÈLES VISUELS des cartes de fidélité physiques — design de RÉFÉRENCE du
 * propriétaire (maquettes 11482/11483) : dégradé diagonal violet → rose à
 * facettes. SOURCE UNIQUE partagée entre :
 *   - le PDF d'impression (lib/loyalty/card-pdf.ts, pdf-lib serveur) qui
 *     embarque le PNG public/brand/loyalty-card-bg-<clé>.png ;
 *   - l'aperçu de la console super-admin (mini-cartes CSS, MÊME PNG) ;
 *   - les cartes fidélité de l'app client (dégradé CSS, mêmes stops).
 * Les TEINTES vivent dans lib/design/tokens.ts (section LOYALTY_CARD).
 */

export type CardTemplate = {
  key: string;
  label: string;
  desc: string;
  /** Stops du dégradé diagonal 135° (mêmes teintes que le PNG de fond). */
  g1: string;
  g2: string;
  g3: string;
  /** Texte principal / secondaire posé sur le dégradé. */
  text: string;
  subtext: string;
  /** true = modèle CLAIR : logo/pilules/encres FONCÉS (violet). */
  light?: boolean;
};

export const CARD_TEMPLATES: CardTemplate[] = [
  {
    key: "violet",
    label: "Violet Coligo",
    desc: "La maquette de référence — violet profond → rose.",
    ...LOYALTY_CARD.violet,
  },
  {
    key: "nuit",
    label: "Nuit",
    desc: "Encre profonde, finale rose — premium.",
    ...LOYALTY_CARD.nuit,
  },
  {
    key: "clair",
    label: "Clair",
    desc: "Fond blanc, accents violets — sobre.",
    ...LOYALTY_CARD.clair,
    light: true,
  },
  {
    key: "rose",
    label: "Rose",
    desc: "Rose Coligo, énergique — commerces mode/beauté.",
    ...LOYALTY_CARD.rose,
  },
];

export const DEFAULT_TEMPLATE_KEY = "violet";

export function getCardTemplate(key: string | null | undefined): CardTemplate {
  return (
    CARD_TEMPLATES.find((t) => t.key === key) ??
    CARD_TEMPLATES.find((t) => t.key === DEFAULT_TEMPLATE_KEY)!
  );
}

/** Dégradé CSS du modèle (cartes client + aperçus) — mêmes stops que le PNG. */
export function cardGradientCss(tpl: CardTemplate): string {
  return `linear-gradient(135deg, ${tpl.g1} 0%, ${tpl.g2} 55%, ${tpl.g3} 100%)`;
}

/** Fond dégradé pré-rendu (fonds perdus compris) — embarqué dans le PDF et
 *  affiché tel quel dans l'aperçu console (fidélité garantie). */
export function cardBgAssetPath(key: string): string {
  return `/brand/loyalty-card-bg-${getCardTemplate(key).key}.png`;
}

/** Logotype Coligo FR+AR adapté au modèle (blanc sur sombre, encre sur clair). */
export function cardLogoAssetPath(tpl: CardTemplate): string {
  return tpl.light ? "/brand/logo-full.png" : "/brand/logo-full-white.png";
}

/** « بطاقة الوفاء » (titre arabe du recto, PNG en police arabe dédiée) adapté
 *  au modèle. */
export function cardArWafaAssetPath(tpl: CardTemplate): string {
  return tpl.light
    ? "/brand/loyalty-ar-wafa-violet.png"
    : "/brand/loyalty-ar-wafa-white.png";
}

/** Carlito-BoldItalic (= Calibri italique, licence libre) — police du grand
 *  titre du recto, embarquée dans le PDF via fontkit. */
export function cardTitleFontPath(): string {
  return "/brand/fonts/Carlito-BoldItalic.ttf";
}

/** Numéro imprimé sous le QR : groupes de 4, lisible et re-saisissable. */
export function groupCardCode(code: string): string {
  return code.replace(/(.{4})/g, "$1 ").trim();
}
