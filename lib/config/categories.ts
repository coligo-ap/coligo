export type MerchantCategory = {
  code: string;
  label: string;
  /** Libellé arabe (parcours client en AR). Codes stables, cf. i18n. */
  labelAr: string;
  emoji: string;
};

export const MERCHANT_CATEGORIES: MerchantCategory[] = [
  {
    code: "boulangerie",
    label: "Boulangerie / Pâtisserie",
    labelAr: "مخبزة / حلويات",
    emoji: "🥖",
  },
  {
    code: "superette",
    label: "Supérette / Épicerie",
    labelAr: "بقالة / سوبريت",
    emoji: "🛒",
  },
  {
    code: "fast_food",
    label: "Fast-food / Restauration rapide",
    labelAr: "وجبات سريعة",
    emoji: "🍔",
  },
  { code: "restaurant", label: "Restaurant", labelAr: "مطعم", emoji: "🍽️" },
  {
    code: "cafe",
    label: "Café / Salon de thé",
    labelAr: "مقهى / قاعة شاي",
    emoji: "☕",
  },
  { code: "pizzeria", label: "Pizzeria", labelAr: "بيتزا", emoji: "🍕" },
  {
    code: "creperie",
    label: "Crêperie / Gaufres",
    labelAr: "كريب / وافل",
    emoji: "🥞",
  },
  { code: "glacier", label: "Glacier", labelAr: "آيس كريم", emoji: "🍦" },
  {
    code: "boucherie",
    label: "Boucherie / Charcuterie",
    labelAr: "جزارة / لحوم",
    emoji: "🥩",
  },
  {
    code: "poissonnerie",
    label: "Poissonnerie",
    labelAr: "أسماك",
    emoji: "🐟",
  },
  {
    code: "fruits_legumes",
    label: "Fruits & Légumes",
    labelAr: "خضر وفواكه",
    emoji: "🥦",
  },
  {
    code: "produits_bio",
    label: "Produits bio / Terroir",
    labelAr: "منتجات عضوية",
    emoji: "🌿",
  },
  { code: "fleuriste", label: "Fleuriste", labelAr: "بائع ورود", emoji: "💐" },
  {
    code: "pharmacie",
    label: "Pharmacie / Parapharmacie",
    labelAr: "صيدلية",
    emoji: "💊",
  },
  {
    code: "cosmetiques",
    label: "Cosmétiques / Beauté",
    labelAr: "مستحضرات تجميل",
    emoji: "💄",
  },
  {
    code: "vetements",
    label: "Vêtements / Mode",
    labelAr: "ملابس / موضة",
    emoji: "👕",
  },
  {
    code: "chaussures",
    label: "Chaussures / Maroquinerie",
    labelAr: "أحذية / جلود",
    emoji: "👟",
  },
  {
    code: "bijouterie",
    label: "Bijouterie / Horlogerie",
    labelAr: "مجوهرات / ساعات",
    emoji: "💍",
  },
  {
    code: "librairie",
    label: "Librairie / Papeterie",
    labelAr: "مكتبة / قرطاسية",
    emoji: "📚",
  },
  {
    code: "jouets",
    label: "Jouets / Enfants",
    labelAr: "ألعاب / أطفال",
    emoji: "🧸",
  },
  {
    code: "electronique",
    label: "Électronique / Téléphonie",
    labelAr: "إلكترونيات / هواتف",
    emoji: "📱",
  },
  {
    code: "informatique",
    label: "Informatique",
    labelAr: "إعلام آلي",
    emoji: "💻",
  },
  {
    code: "electromenager",
    label: "Électroménager",
    labelAr: "أجهزة كهرومنزلية",
    emoji: "🔌",
  },
  {
    code: "quincaillerie",
    label: "Quincaillerie / Bricolage",
    labelAr: "أدوات / عتاد",
    emoji: "🔧",
  },
  {
    code: "decoration",
    label: "Décoration / Maison",
    labelAr: "ديكور / منزل",
    emoji: "🏠",
  },
  {
    code: "ameublement",
    label: "Ameublement / Mobilier",
    labelAr: "أثاث",
    emoji: "🛋️",
  },
  {
    code: "sport",
    label: "Articles de sport",
    labelAr: "مستلزمات رياضية",
    emoji: "⚽",
  },
  {
    code: "animalerie",
    label: "Animalerie",
    labelAr: "محل حيوانات",
    emoji: "🐾",
  },
  { code: "autre", label: "Autre", labelAr: "أخرى", emoji: "🏷️" },
];

export function getCategory(code: string): MerchantCategory | undefined {
  return MERCHANT_CATEGORIES.find((c) => c.code === code);
}

/**
 * Libellé d'une catégorie de commerçant. Par défaut français ; passe
 * `locale="ar"` (parcours client en arabe) pour le libellé arabe. Repli sur le
 * code si inconnu.
 */
export function getCategoryLabel(code: string, locale: string = "fr"): string {
  const cat = getCategory(code);
  if (!cat) return code;
  return locale === "ar" ? cat.labelAr : cat.label;
}
