// =============================================================================
// Thèmes d'apparence « occasions » — pilotés par le super-admin
// (/admin/controle, table app_theme mig 0415).
//
// Chaque preset définit le HÉRO des portails d'auth (dégradé + 2 blobs
// organiques, style « soft organic minimal ») et le bandeau optionnel de
// l'accueil marketplace (tagline localisée + icône lucide — jamais d'emoji en
// dur). Fichier PUR (client + serveur).
// =============================================================================

export type AppThemeKey =
  | "coligo"
  | "ramadan"
  | "aid"
  | "ete"
  | "hiver"
  | "promos"
  | "independance";

export const DEFAULT_APP_THEME: AppThemeKey = "coligo";

/** MODÈLE de design des héros — indépendant des couleurs (mig 0416). */
export type AppThemeModel = "blobs" | "vagues" | "halo" | "motifs";

export const DEFAULT_APP_MODEL: AppThemeModel = "blobs";

export const APP_THEME_MODELS: Record<
  AppThemeModel,
  { label: string; hint: string }
> = {
  blobs: {
    label: "Formes organiques",
    hint: "Cercles doux flottants + grain (défaut).",
  },
  vagues: {
    label: "Vagues",
    hint: "Vagues superposées qui dérivent en bas du bandeau.",
  },
  halo: {
    label: "Halo",
    hint: "Lueurs radiales douces, façon aurore.",
  },
  motifs: {
    label: "Motifs",
    hint: "Trame de points + touche de couleur.",
  },
};

type Localized = { fr: string; ar: string; en: string };

export type AppThemePreset = {
  /** Nom affiché côté admin. */
  label: string;
  /** Occasion / quand l'utiliser (hint admin). */
  hint: string;
  /** Dégradé du héro (3 arrêts). */
  g1: string;
  g2: string;
  g3: string;
  /** Blobs organiques. */
  blobA: string;
  blobB: string;
  /** Icône lucide du bandeau accueil. */
  homeIcon: "sparkles" | "moon" | "sun" | "snowflake" | "percent" | "flag";
  /** Tagline du bandeau accueil marketplace. */
  home: Localized;
  homeSub: Localized;
};

export const APP_THEMES: Record<AppThemeKey, AppThemePreset> = {
  coligo: {
    label: "Coligo (défaut)",
    hint: "Le violet de la marque, toute l'année.",
    g1: "#6C2BD9",
    g2: "#5B21B6",
    g3: "#4C1B9B",
    blobA: "#8A4DFF",
    blobB: "#FF2D7A",
    homeIcon: "sparkles",
    home: {
      fr: "Bienvenue sur Coligo",
      ar: "مرحبًا بك في كوليغو",
      en: "Welcome to Coligo",
    },
    homeSub: {
      fr: "Courses, repas et commerces près de chez toi.",
      ar: "مشتريات ووجبات ومتاجر قريبة منك.",
      en: "Groceries, meals and local shops near you.",
    },
  },
  ramadan: {
    label: "Ramadan",
    hint: "Vert profond et or, pour le mois sacré.",
    g1: "#065F46",
    g2: "#047857",
    g3: "#022C22",
    blobA: "#F59E0B",
    blobB: "#34D399",
    homeIcon: "moon",
    home: {
      fr: "Ramadan Moubarak",
      ar: "رمضان مبارك",
      en: "Ramadan Mubarak",
    },
    homeSub: {
      fr: "Vos courses du f'tour, livrées à temps.",
      ar: "مشتريات الفطور تصلك في وقتها.",
      en: "Your iftar groceries, delivered on time.",
    },
  },
  aid: {
    label: "Aïd",
    hint: "Émeraude et doré, pour les fêtes de l'Aïd.",
    g1: "#059669",
    g2: "#10B981",
    g3: "#065F46",
    blobA: "#FDE68A",
    blobB: "#6EE7B7",
    homeIcon: "sparkles",
    home: {
      fr: "Aïd Moubarak",
      ar: "عيد مبارك",
      en: "Eid Mubarak",
    },
    homeSub: {
      fr: "Toute l'équipe Coligo vous souhaite une bonne fête.",
      ar: "فريق كوليغو يتمنى لكم عيدًا سعيدًا.",
      en: "The Coligo team wishes you a happy Eid.",
    },
  },
  ete: {
    label: "Été",
    hint: "Corail et soleil, pour la saison estivale.",
    g1: "#C2410C",
    g2: "#EA580C",
    g3: "#9A3412",
    blobA: "#FDBA74",
    blobB: "#FF2D7A",
    homeIcon: "sun",
    home: {
      fr: "L'été avec Coligo",
      ar: "الصيف مع كوليغو",
      en: "Summer with Coligo",
    },
    homeSub: {
      fr: "Boissons fraîches et glaces, livrées en un éclair.",
      ar: "مشروبات باردة ومثلجات تصلك بسرعة.",
      en: "Cold drinks and ice cream, delivered fast.",
    },
  },
  hiver: {
    label: "Hiver",
    hint: "Bleu nuit, pour la saison froide.",
    g1: "#1E3A8A",
    g2: "#1D4ED8",
    g3: "#172554",
    blobA: "#93C5FD",
    blobB: "#8A4DFF",
    homeIcon: "snowflake",
    home: {
      fr: "L'hiver au chaud",
      ar: "شتاء دافئ",
      en: "Stay warm this winter",
    },
    homeSub: {
      fr: "Restez au chaud, on s'occupe des courses.",
      ar: "ابقَ دافئًا ونحن نتكفل بالمشتريات.",
      en: "Stay in — we'll handle the groceries.",
    },
  },
  promos: {
    label: "Promos / Soldes",
    hint: "Rose vif, pour les grandes opérations promo.",
    g1: "#BE123C",
    g2: "#E11D48",
    g3: "#9F1239",
    blobA: "#FDA4AF",
    blobB: "#8A4DFF",
    homeIcon: "percent",
    home: {
      fr: "C'est les promos !",
      ar: "إنها التخفيضات!",
      en: "Deals are on!",
    },
    homeSub: {
      fr: "Les meilleures offres des commerçants, ici.",
      ar: "أفضل عروض التجار هنا.",
      en: "The best merchant deals, right here.",
    },
  },
  independance: {
    label: "5 Juillet",
    hint: "Vert, blanc et rouge — fête de l'Indépendance.",
    g1: "#065F46",
    g2: "#047857",
    g3: "#064E3B",
    blobA: "#FFFFFF",
    blobB: "#EF4444",
    homeIcon: "flag",
    home: {
      fr: "Bonne fête de l'Indépendance",
      ar: "عيد استقلال سعيد",
      en: "Happy Independence Day",
    },
    homeSub: {
      fr: "Fiers de livrer partout en Algérie.",
      ar: "فخورون بالتوصيل في كل الجزائر.",
      en: "Proud to deliver across Algeria.",
    },
  },
};

/** Dégradé CSS d'un preset (héros, aperçus admin, bandeau accueil). */
export function themeGradient(t: AppThemePreset): string {
  return `linear-gradient(140deg, ${t.g1} 0%, ${t.g2} 55%, ${t.g3} 100%)`;
}

/**
 * Variante VERTICALE partant exactement de g1 : l'accueil marketplace peint le
 * header en g1 uni et enchaîne ce dégradé dessous → aucune couture visible.
 */
export function themeGradientVertical(t: AppThemePreset): string {
  return `linear-gradient(180deg, ${t.g1} 0%, ${t.g2} 78%, ${t.g3} 140%)`;
}

/** Texture grain inline (feTurbulence) — zéro requête réseau, CSP-safe. */
export const THEME_GRAIN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";
