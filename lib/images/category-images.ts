// =============================================================================
// Images illustratives par catégorie de commerce.
// =============================================================================
// Source : Unsplash (libre droits, attribution non requise pour usage
// commercial). On stocke uniquement les URLs en `w=1200` brutes — l'optimisation
// (f_auto, q_auto, resize) est appliquée à l'affichage via Cloudinary Fetch.
//
// Utilisation :
//   - fallback `cover_url` quand un commerce n'a pas de cover
//   - illustration des tuiles de catégorie sur l'accueil
//   - background décoratif

export const CATEGORY_IMAGES: Record<string, string> = {
  // Alimentation
  boulangerie:
    "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1200&auto=format",
  superette:
    "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=1200&auto=format",
  boucherie:
    "https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=1200&auto=format",
  poissonnerie:
    "https://images.unsplash.com/photo-1535850579364-560bd02b7d2c?w=1200&auto=format",
  fruits_legumes:
    "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1200&auto=format",
  produits_bio:
    "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&auto=format",

  // Restauration
  fast_food:
    "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1200&auto=format",
  restaurant:
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&auto=format",
  pizzeria:
    "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1200&auto=format",
  creperie:
    "https://images.unsplash.com/photo-1519676867240-f03562e64548?w=1200&auto=format",
  cafe: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&auto=format",
  glacier:
    "https://images.unsplash.com/photo-1501443762994-82bd5dace89a?w=1200&auto=format",

  // Santé / soin
  pharmacie:
    "https://images.unsplash.com/photo-1583912086096-8c60d75a53f9?w=1200&auto=format",
  cosmetiques:
    "https://images.unsplash.com/photo-1522335789203-aaa8ecaadf03?w=1200&auto=format",

  // Mode / accessoires
  vetements:
    "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format",
  chaussures:
    "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200&auto=format",
  bijouterie:
    "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1200&auto=format",

  // Maison / loisirs
  librairie:
    "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1200&auto=format",
  jouets:
    "https://images.unsplash.com/photo-1558877385-81a1c7e67d72?w=1200&auto=format",
  electronique:
    "https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=1200&auto=format",
  informatique:
    "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=1200&auto=format",
  electromenager:
    "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&auto=format",
  quincaillerie:
    "https://images.unsplash.com/photo-1530124566582-a618bc2615dc?w=1200&auto=format",
  decoration:
    "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=1200&auto=format",
  ameublement:
    "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200&auto=format",
  sport:
    "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1200&auto=format",
  animalerie:
    "https://images.unsplash.com/photo-1450778869180-41d0601e046e?w=1200&auto=format",
  fleuriste:
    "https://images.unsplash.com/photo-1487070183336-b863922373d4?w=1200&auto=format",
};

/**
 * Renvoie une image illustrative pour le code catégorie donné, ou `null` si
 * la catégorie n'est pas mappée.
 */
export function categoryImage(code: string | null | undefined): string | null {
  if (!code) return null;
  return CATEGORY_IMAGES[code] ?? null;
}

/**
 * Match souple par regex sur un libellé libre (au cas où le commerce a entré
 * "Boulangerie/Pâtisserie" plutôt que le code "boulangerie").
 */
const FUZZY: { pattern: RegExp; code: keyof typeof CATEGORY_IMAGES }[] = [
  { pattern: /boulang|patisserie|pâtisserie/i, code: "boulangerie" },
  { pattern: /super[éeè]?rette|épicerie|alimentation/i, code: "superette" },
  { pattern: /boucherie|viande/i, code: "boucherie" },
  { pattern: /poisson/i, code: "poissonnerie" },
  { pattern: /fruit|l[ée]gume|primeur/i, code: "fruits_legumes" },
  { pattern: /pharma/i, code: "pharmacie" },
  { pattern: /pizza/i, code: "pizzeria" },
  { pattern: /caf[ée]|salon de th/i, code: "cafe" },
  { pattern: /restau/i, code: "restaurant" },
  { pattern: /fast.?food/i, code: "fast_food" },
  { pattern: /glac/i, code: "glacier" },
  { pattern: /fleur/i, code: "fleuriste" },
];

/**
 * Variante qui accepte un libellé libre OU un code et tente plusieurs
 * stratégies pour trouver une image.
 */
export function categoryImageFor(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const exact = categoryImage(value);
  if (exact) return exact;
  const match = FUZZY.find((f) => f.pattern.test(value));
  return match ? CATEGORY_IMAGES[match.code] : null;
}
