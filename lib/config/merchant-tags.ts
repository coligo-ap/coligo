// =============================================================================
// Tags commerçant (volet 1) — sous-spécialités choisies DANS une liste proposée
// selon la catégorie principale du commerce (pas de texte libre par défaut →
// recherche cohérente). Bilingue (fr / ar). Le `code` est stocké tel quel dans
// `merchants.tags[]` (déjà normalisé : minuscule, sans accent) et alimente la
// recherche par produit + les filtres.
// =============================================================================

export type MerchantTag = { code: string; fr: string; ar: string };

/** Tags suggérés par code de catégorie (cf. lib/config/categories.ts). */
export const TAGS_BY_CATEGORY: Record<string, MerchantTag[]> = {
  superette: [
    { code: "pates", fr: "Pâtes", ar: "معكرونة" },
    { code: "farine", fr: "Farine", ar: "دقيق" },
    { code: "riz", fr: "Riz", ar: "أرز" },
    { code: "huile", fr: "Huile", ar: "زيت" },
    { code: "sucre", fr: "Sucre", ar: "سكر" },
    { code: "conserves", fr: "Conserves", ar: "معلبات" },
    { code: "boissons", fr: "Boissons", ar: "مشروبات" },
    { code: "produits-frais", fr: "Produits frais", ar: "منتجات طازجة" },
    {
      code: "produits-laitiers",
      fr: "Produits laitiers",
      ar: "منتجات الألبان",
    },
    { code: "produits-menagers", fr: "Produits ménagers", ar: "مواد التنظيف" },
    { code: "epicerie-fine", fr: "Épicerie fine", ar: "بقالة فاخرة" },
    { code: "surgeles", fr: "Surgelés", ar: "مجمدات" },
  ],
  boulangerie: [
    { code: "pain", fr: "Pain", ar: "خبز" },
    { code: "baguette", fr: "Baguette", ar: "خبز فرنسي" },
    { code: "viennoiserie", fr: "Viennoiserie", ar: "معجنات" },
    { code: "patisserie", fr: "Pâtisserie", ar: "حلويات" },
    { code: "gateaux", fr: "Gâteaux", ar: "كعك" },
    { code: "msemen", fr: "Msemen / Galette", ar: "مسمن" },
  ],
  fast_food: [
    { code: "burger", fr: "Burger", ar: "برغر" },
    { code: "tacos", fr: "Tacos", ar: "تاكوس" },
    { code: "sandwich", fr: "Sandwich", ar: "ساندويتش" },
    { code: "americaine", fr: "Américaine", ar: "أمريكان" },
    { code: "crispy", fr: "Crispy / Poulet", ar: "كريسبي / دجاج" },
    { code: "panini", fr: "Panini", ar: "بانيني" },
    { code: "frites", fr: "Frites", ar: "بطاطا مقلية" },
    { code: "plats", fr: "Plats", ar: "أطباق" },
  ],
  pizzeria: [
    { code: "pizza", fr: "Pizza", ar: "بيتزا" },
    { code: "calzone", fr: "Calzone", ar: "كالزوني" },
    { code: "pates", fr: "Pâtes", ar: "معكرونة" },
  ],
  restaurant: [
    { code: "plats", fr: "Plats", ar: "أطباق" },
    { code: "grillades", fr: "Grillades", ar: "مشاوي" },
    { code: "couscous", fr: "Couscous", ar: "كسكس" },
    { code: "poisson", fr: "Poisson", ar: "سمك" },
    { code: "traditionnel", fr: "Traditionnel", ar: "تقليدي" },
  ],
  cafe: [
    { code: "cafe", fr: "Café", ar: "قهوة" },
    { code: "boissons-chaudes", fr: "Boissons chaudes", ar: "مشروبات ساخنة" },
    { code: "petit-dejeuner", fr: "Petit-déjeuner", ar: "فطور" },
    { code: "snacks", fr: "Snacks", ar: "وجبات خفيفة" },
    { code: "jus", fr: "Jus", ar: "عصائر" },
  ],
  creperie: [
    { code: "crepe", fr: "Crêpe", ar: "كريب" },
    { code: "gaufre", fr: "Gaufre", ar: "وافل" },
    { code: "pancake", fr: "Pancake", ar: "بانكيك" },
  ],
  glacier: [
    { code: "glace", fr: "Glace", ar: "آيس كريم" },
    { code: "sorbet", fr: "Sorbet", ar: "سوربيه" },
    { code: "milkshake", fr: "Milkshake", ar: "ميلك شيك" },
  ],
  boucherie: [
    { code: "boeuf", fr: "Bœuf", ar: "لحم بقر" },
    { code: "mouton", fr: "Mouton", ar: "لحم غنم" },
    { code: "poulet", fr: "Poulet", ar: "دجاج" },
    { code: "charcuterie", fr: "Charcuterie", ar: "لحوم مصنعة" },
    { code: "merguez", fr: "Merguez", ar: "مرقاز" },
    { code: "viande-hachee", fr: "Viande hachée", ar: "لحم مفروم" },
  ],
  poissonnerie: [
    { code: "poisson-frais", fr: "Poisson frais", ar: "سمك طازج" },
    { code: "crevettes", fr: "Crevettes", ar: "قمرون" },
    { code: "fruits-de-mer", fr: "Fruits de mer", ar: "مأكولات بحرية" },
    { code: "sardine", fr: "Sardine", ar: "سردين" },
  ],
  fruits_legumes: [
    { code: "fruits", fr: "Fruits", ar: "فواكه" },
    { code: "legumes", fr: "Légumes", ar: "خضر" },
    { code: "herbes", fr: "Herbes fraîches", ar: "أعشاب طازجة" },
    { code: "fruits-secs", fr: "Fruits secs", ar: "فواكه جافة" },
  ],
  produits_bio: [
    { code: "bio", fr: "Bio", ar: "عضوي" },
    { code: "complements", fr: "Compléments", ar: "مكملات" },
    { code: "miel", fr: "Miel", ar: "عسل" },
    { code: "plantes", fr: "Plantes / Tisanes", ar: "أعشاب" },
  ],
  pharmacie: [
    { code: "parapharmacie", fr: "Parapharmacie", ar: "شبه صيدلية" },
    { code: "hygiene", fr: "Hygiène", ar: "نظافة" },
    { code: "bebe", fr: "Bébé", ar: "أطفال رضع" },
    { code: "complements", fr: "Compléments", ar: "مكملات" },
  ],
  cosmetiques: [
    { code: "maquillage", fr: "Maquillage", ar: "مكياج" },
    { code: "soins", fr: "Soins", ar: "عناية" },
    { code: "parfums", fr: "Parfums", ar: "عطور" },
    { code: "cheveux", fr: "Cheveux", ar: "شعر" },
  ],
};

const ALL_TAGS = new Map<string, MerchantTag>();
for (const list of Object.values(TAGS_BY_CATEGORY)) {
  for (const tag of list)
    if (!ALL_TAGS.has(tag.code)) ALL_TAGS.set(tag.code, tag);
}

/** Tags suggérés pour une catégorie (vide si catégorie inconnue/non couverte). */
export function tagsForCategory(categoryCode: string | null): MerchantTag[] {
  if (!categoryCode) return [];
  return TAGS_BY_CATEGORY[categoryCode] ?? [];
}

/** Libellé d'un tag (par code) dans la langue voulue ; humanise un tag custom. */
export function getTagLabel(code: string, locale: string = "fr"): string {
  const tag = ALL_TAGS.get(code);
  if (tag) return locale === "ar" ? tag.ar : tag.fr;
  // Tag custom (hors liste) : on humanise le code.
  const human = code.replace(/[-_]+/g, " ").trim();
  return human.charAt(0).toUpperCase() + human.slice(1);
}

/** Normalise un tag (custom inclus) : minuscule, sans accent, tirets. */
export function normalizeTagCode(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
}

export const MAX_MERCHANT_TAGS = 10;
