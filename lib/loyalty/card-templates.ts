import { LOYALTY_CARD } from "@/lib/design/tokens";

/**
 * MODÈLES VISUELS des cartes de fidélité physiques (SPEC-FIDELITE 4.0).
 * SOURCE UNIQUE partagée entre :
 *   - le PDF d'impression (lib/loyalty/card-pdf.ts, pdf-lib serveur) ;
 *   - l'aperçu de la console super-admin (mini-cartes CSS).
 * Design FLAT (règle maison) : fonds pleins + une forme d'accent, zéro ombre.
 * Les TEINTES vivent dans lib/design/tokens.ts (section LOYALTY_CARD) — des
 * cartes imprimées circulent, on n'y retouche jamais un modèle : on en ajoute.
 */

export type CardTemplate = {
  key: string;
  label: string;
  desc: string;
  /** Fond du recto (aplat, étendu jusqu'aux fonds perdus). */
  bg: string;
  /** Forme d'accent (disque plein en coin) + filets du verso. */
  accent: string;
  /** Texte principal du recto. */
  text: string;
  /** Texte secondaire du recto (mentions, sous-titres). */
  subtext: string;
  /** Le verso reste clair (lisibilité imprimeur) : bandeau + accents. */
  versoAccent: string;
};

export const CARD_TEMPLATES: CardTemplate[] = [
  {
    key: "violet",
    label: "Violet Coligo",
    desc: "La marque, plein aplat — le classique.",
    ...LOYALTY_CARD.violet,
    versoAccent: LOYALTY_CARD.violet.bg,
  },
  {
    key: "nuit",
    label: "Nuit",
    desc: "Encre profonde, accent rose — premium.",
    ...LOYALTY_CARD.nuit,
    versoAccent: LOYALTY_CARD.nuit.bg,
  },
  {
    key: "clair",
    label: "Clair",
    desc: "Fond blanc, accents violets — sobre.",
    ...LOYALTY_CARD.clair,
    versoAccent: LOYALTY_CARD.clair.accent,
  },
  {
    key: "rose",
    label: "Rose",
    desc: "Rose Coligo, énergique — commerces mode/beauté.",
    ...LOYALTY_CARD.rose,
    versoAccent: LOYALTY_CARD.rose.bg,
  },
];

export const DEFAULT_TEMPLATE_KEY = "violet";

export function getCardTemplate(key: string | null | undefined): CardTemplate {
  return (
    CARD_TEMPLATES.find((t) => t.key === key) ??
    CARD_TEMPLATES.find((t) => t.key === DEFAULT_TEMPLATE_KEY)!
  );
}

/** Numéro imprimé sous le QR : groupes de 4, lisible et re-saisissable. */
export function groupCardCode(code: string): string {
  return code.replace(/(.{4})/g, "$1 ").trim();
}
