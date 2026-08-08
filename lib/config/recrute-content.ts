import type { FeatureKey } from "@/lib/data/feature-flags";
import { RECRUTE_HERO_GRADIENTS } from "@/lib/design/tokens";

/**
 * CONTENU ÉDITABLE DE LA PAGE /recrute — définitions PURES.
 *
 * Ce module ne touche ni à la base ni aux cookies : il est importable côté
 * serveur comme côté client (l'écran d'administration s'en sert pour proposer
 * les mêmes choix que ceux appliqués par la page publique).
 *
 * Il porte deux choses :
 *   - les DÉFAUTS livrés avec le code — la page reste complète et juste même
 *     si la base est vide, injoignable, ou si la migration n'est pas passée ;
 *   - les PRESETS de design du héros, seules valeurs qu'un administrateur peut
 *     choisir (allowlist vérifiée côté serveur avant écriture).
 */

export type RecruteRole = {
  key: FeatureKey;
  /**
   * Visuel de marque du domaine : capture RÉELLE de l'app (dégradé Coligo +
   * l'écran que la personne utilisera). Une photo d'illustration montrerait un
   * métier ; ceci montre LA PLATEFORME. Remplaçable depuis l'administration.
   */
  img: string;
  imgAlt: string;
  title: string;
  tagline: string;
  highlight: string;
  perks: string[];
  /** Destination d'inscription — NON éditable : c'est une route de l'app. */
  href: string;
  cta: string;
};

/** Les 4 métiers, dans l'ordre d'affichage par défaut. */
export const DEFAULT_RECRUTE_ROLES: RecruteRole[] = [
  {
    key: "recruit_chauffeur",
    img: "/heros/chauffeur.webp",
    imgAlt:
      "Course Coligo Drive à Béjaïa : départ, destination et prix affichés avant de réserver",
    title: "Chauffeur",
    tagline: "Transportez des passagers avec Coligo Drive.",
    highlight: "Commission 0 %",
    perks: [
      "Vous proposez votre prix sur chaque course",
      "Ville, inter-wilayas et covoiturage par places",
      "Gains en espèces ou Coligo Pay, détaillés dans l'app",
    ],
    href: "/chauffeur/signup",
    cta: "Devenir chauffeur",
  },
  {
    key: "recruit_merchant",
    img: "/heros/commercant.webp",
    imgAlt:
      "Tableau de bord commerçant Coligo : recette du jour et commandes en direct",
    title: "Commerçant",
    tagline: "Vendez en ligne à tout votre quartier.",
    highlight: "0 DA à l'inscription",
    perks: [
      "Commission uniquement sur les ventes, aucun abonnement",
      "Boutique en ligne + livraison express intégrée",
      "Caisse, tickets imprimés et statistiques inclus",
    ],
    href: "/signup",
    cta: "Devenir commerçant",
  },
  {
    key: "recruit_driver",
    img: "/heros/livreur.webp",
    imgAlt:
      "Course express proposée à un livreur Coligo : trajet, distance et gain net",
    title: "Livreur",
    tagline: "Livrez les commandes près de chez vous.",
    highlight: "Gains à chaque course",
    perks: [
      "Vous choisissez votre zone et vos horaires",
      "Courses express et tournées programmées",
      "Revenus suivis en direct, versements transparents",
    ],
    href: "/driver/signup",
    cta: "Devenir livreur",
  },
  {
    key: "recruit_agent",
    img: "/heros/agent.webp",
    imgAlt:
      "Écran « Espaces partenaires » de Coligo : chaque métier a son espace dédié",
    title: "Agent Coligo Pay",
    tagline: "Encaissez les recharges de votre quartier.",
    highlight: "Commission par recharge",
    perks: [
      "Un téléphone suffit : QR simple, zéro matériel",
      "Vous devenez le point de recharge du quartier",
      "Portefeuille et commissions suivis dans l'app",
    ],
    href: "/partenaire/signup",
    cta: "Devenir agent",
  },
];

/** Route d'inscription de chaque métier — jamais éditable depuis l'admin. */
export const RECRUTE_HREF: Record<string, { href: string; label: string }> =
  Object.fromEntries(
    DEFAULT_RECRUTE_ROLES.map((r) => [r.key, { href: r.href, label: r.title }])
  );

/* ─────────────────────────── Design du héros ─────────────────────────── */

export type RecruteDesignKey =
  | "coligo"
  | "nuit"
  | "aurore"
  | "emeraude"
  | "ambre";

export type RecruteDesign = {
  label: string;
  /** Ce que le dégradé évoque — affiché dans l'administration. */
  hint: string;
  /** Trois arrêts du dégradé du héros. */
  g1: string;
  g2: string;
  g3: string;
  /** Halo décoratif qui flotte dans le héros. */
  glow: string;
};

/**
 * Habillages du héros. Le premier est la marque ; les autres servent les
 * temps forts (campagne de recrutement, saison) sans toucher au code.
 */
export const RECRUTE_DESIGNS: Record<RecruteDesignKey, RecruteDesign> = {
  coligo: {
    label: "Coligo",
    hint: "Violet de marque — le choix par défaut",
    ...RECRUTE_HERO_GRADIENTS.coligo,
  },
  nuit: {
    label: "Nuit",
    hint: "Violet profond, plus sobre et contrasté",
    ...RECRUTE_HERO_GRADIENTS.nuit,
  },
  aurore: {
    label: "Aurore",
    hint: "Violet vers rose — campagnes et temps forts",
    ...RECRUTE_HERO_GRADIENTS.aurore,
  },
  emeraude: {
    label: "Émeraude",
    hint: "Vert — met en avant les gains et le recrutement",
    ...RECRUTE_HERO_GRADIENTS.emeraude,
  },
  ambre: {
    label: "Ambre",
    hint: "Chaud — saison, Ramadan, fêtes",
    ...RECRUTE_HERO_GRADIENTS.ambre,
  },
};

export const DEFAULT_RECRUTE_DESIGN: RecruteDesignKey = "coligo";

/** Variables CSS du héros — posées en style inline sur la section. */
export function recruteDesignVars(
  key: RecruteDesignKey
): Record<string, string> {
  const d = RECRUTE_DESIGNS[key] ?? RECRUTE_DESIGNS[DEFAULT_RECRUTE_DESIGN];
  return {
    "--rc-g1": d.g1,
    "--rc-g2": d.g2,
    "--rc-g3": d.g3,
    "--rc-glow": d.glow,
  };
}
