// =============================================================================
// Bibliothèque-catalogue Coligo (POSSÉDÉE) — modèles de remplissage automatique
// =============================================================================
// Le super-admin peut « remplir » le magasin d'un commerçant selon son TYPE de
// commerce à partir de ces modèles : catégories + produits courants en Algérie,
// avec des PRIX INDICATIFS (DA) que le commerçant ajuste ensuite (prix, détails,
// photos). Le commerçant garde la main : tout est éditable après remplissage.
//
// ⚠️ Données 100 % GÉNÉRIQUES & possédées par Coligo (descriptions de produits
// usuels, pas de copie d'un catalogue tiers). Pas de photos copiées : le
// commerçant ajoute ses propres photos (image_url laissé vide au remplissage).
// =============================================================================

export type CatalogTemplateProduct = {
  name_fr: string;
  name_ar?: string;
  /** Prix INDICATIF en DA (le commerçant ajuste). */
  price_da: number;
  unit?: "piece" | "kg" | "l";
};

export type CatalogTemplateCategory = {
  title: string;
  products: CatalogTemplateProduct[];
};

export type CatalogTemplate = {
  /** Type de commerce (code `merchants.category`). */
  type: string;
  label: string;
  categories: CatalogTemplateCategory[];
};

// ─── Supérette / Épicerie ────────────────────────────────────────────────────
const SUPERETTE: CatalogTemplate = {
  type: "superette",
  label: "Supérette / Épicerie",
  categories: [
    {
      title: "Boissons",
      products: [
        {
          name_fr: "Eau minérale 1,5 L",
          name_ar: "ماء معدني 1.5 ل",
          price_da: 40,
          unit: "piece",
        },
        {
          name_fr: "Eau minérale 0,5 L",
          name_ar: "ماء معدني 0.5 ل",
          price_da: 25,
          unit: "piece",
        },
        {
          name_fr: "Soda cola 1 L",
          name_ar: "مشروب غازي كولا 1 ل",
          price_da: 120,
          unit: "piece",
        },
        {
          name_fr: "Soda orange 2 L",
          name_ar: "مشروب غازي برتقال 2 ل",
          price_da: 180,
          unit: "piece",
        },
        {
          name_fr: "Jus d'orange 1 L",
          name_ar: "عصير برتقال 1 ل",
          price_da: 150,
          unit: "piece",
        },
        { name_fr: "Boisson énergisante 25 cl", price_da: 200, unit: "piece" },
        {
          name_fr: "Limonade 1 L",
          name_ar: "ليموناضة 1 ل",
          price_da: 100,
          unit: "piece",
        },
      ],
    },
    {
      title: "Produits laitiers",
      products: [
        {
          name_fr: "Lait UHT 1 L",
          name_ar: "حليب 1 ل",
          price_da: 110,
          unit: "piece",
        },
        {
          name_fr: "Lait en poudre 500 g",
          name_ar: "حليب مجفف 500 غ",
          price_da: 450,
          unit: "piece",
        },
        {
          name_fr: "Yaourt nature (pack 4)",
          name_ar: "ياغورت طبيعي",
          price_da: 130,
          unit: "piece",
        },
        {
          name_fr: "Fromage fondu (8 portions)",
          name_ar: "جبن",
          price_da: 220,
          unit: "piece",
        },
        {
          name_fr: "Beurre 250 g",
          name_ar: "زبدة 250 غ",
          price_da: 280,
          unit: "piece",
        },
        {
          name_fr: "Œufs (plateau 30)",
          name_ar: "بيض 30",
          price_da: 600,
          unit: "piece",
        },
      ],
    },
    {
      title: "Épicerie salée",
      products: [
        {
          name_fr: "Huile de table 1 L",
          name_ar: "زيت المائدة 1 ل",
          price_da: 230,
          unit: "piece",
        },
        {
          name_fr: "Huile de table 5 L",
          name_ar: "زيت المائدة 5 ل",
          price_da: 1100,
          unit: "piece",
        },
        {
          name_fr: "Semoule fine 1 kg",
          name_ar: "سميد ناعم 1 كغ",
          price_da: 90,
          unit: "kg",
        },
        {
          name_fr: "Semoule grosse 1 kg",
          name_ar: "سميد خشن 1 كغ",
          price_da: 90,
          unit: "kg",
        },
        {
          name_fr: "Farine 1 kg",
          name_ar: "دقيق 1 كغ",
          price_da: 80,
          unit: "kg",
        },
        { name_fr: "Riz 1 kg", name_ar: "أرز 1 كغ", price_da: 160, unit: "kg" },
        {
          name_fr: "Pâtes spaghetti 500 g",
          name_ar: "معكرونة 500 غ",
          price_da: 90,
          unit: "piece",
        },
        {
          name_fr: "Sucre 1 kg",
          name_ar: "سكر 1 كغ",
          price_da: 110,
          unit: "kg",
        },
        { name_fr: "Sel 1 kg", name_ar: "ملح 1 كغ", price_da: 40, unit: "kg" },
        {
          name_fr: "Concentré de tomate 400 g",
          name_ar: "رب الطماطم 400 غ",
          price_da: 130,
          unit: "piece",
        },
      ],
    },
    {
      title: "Conserves",
      products: [
        {
          name_fr: "Thon à l'huile 160 g",
          name_ar: "تونة 160 غ",
          price_da: 250,
          unit: "piece",
        },
        {
          name_fr: "Sardine en conserve 125 g",
          name_ar: "سردين معلب",
          price_da: 120,
          unit: "piece",
        },
        {
          name_fr: "Petits pois & carottes 400 g",
          price_da: 130,
          unit: "piece",
        },
        { name_fr: "Haricots blancs 400 g", price_da: 120, unit: "piece" },
        {
          name_fr: "Olives vertes 350 g",
          name_ar: "زيتون أخضر",
          price_da: 200,
          unit: "piece",
        },
      ],
    },
    {
      title: "Petit-déjeuner",
      products: [
        {
          name_fr: "Café moulu 250 g",
          name_ar: "قهوة مطحونة 250 غ",
          price_da: 350,
          unit: "piece",
        },
        { name_fr: "Café soluble 100 g", price_da: 480, unit: "piece" },
        {
          name_fr: "Thé vert 200 g",
          name_ar: "شاي أخضر",
          price_da: 250,
          unit: "piece",
        },
        {
          name_fr: "Confiture 350 g",
          name_ar: "مربى 350 غ",
          price_da: 240,
          unit: "piece",
        },
        { name_fr: "Pâte à tartiner 350 g", price_da: 520, unit: "piece" },
        {
          name_fr: "Miel 500 g",
          name_ar: "عسل 500 غ",
          price_da: 900,
          unit: "piece",
        },
        { name_fr: "Céréales 375 g", price_da: 360, unit: "piece" },
      ],
    },
    {
      title: "Snacks & Biscuits",
      products: [
        {
          name_fr: "Biscuits sablés 200 g",
          name_ar: "بسكويت",
          price_da: 120,
          unit: "piece",
        },
        { name_fr: "Gaufrettes chocolat", price_da: 60, unit: "piece" },
        {
          name_fr: "Chips nature 45 g",
          name_ar: "رقائق البطاطا",
          price_da: 50,
          unit: "piece",
        },
        {
          name_fr: "Chocolat tablette 100 g",
          name_ar: "شوكولاطة 100 غ",
          price_da: 180,
          unit: "piece",
        },
        {
          name_fr: "Bonbons (sachet)",
          name_ar: "حلويات",
          price_da: 100,
          unit: "piece",
        },
        { name_fr: "Cacahuètes 200 g", price_da: 150, unit: "piece" },
      ],
    },
    {
      title: "Fruits & Légumes",
      products: [
        {
          name_fr: "Pomme de terre",
          name_ar: "بطاطا",
          price_da: 70,
          unit: "kg",
        },
        { name_fr: "Oignon", name_ar: "بصل", price_da: 80, unit: "kg" },
        { name_fr: "Tomate", name_ar: "طماطم", price_da: 120, unit: "kg" },
        { name_fr: "Carotte", name_ar: "جزر", price_da: 90, unit: "kg" },
        { name_fr: "Banane", name_ar: "موز", price_da: 320, unit: "kg" },
        { name_fr: "Pomme", name_ar: "تفاح", price_da: 350, unit: "kg" },
        { name_fr: "Citron", name_ar: "ليمون", price_da: 250, unit: "kg" },
      ],
    },
    {
      title: "Hygiène & Entretien",
      products: [
        {
          name_fr: "Savon de toilette",
          name_ar: "صابون",
          price_da: 80,
          unit: "piece",
        },
        {
          name_fr: "Shampoing 400 ml",
          name_ar: "شامبو",
          price_da: 350,
          unit: "piece",
        },
        {
          name_fr: "Dentifrice 100 ml",
          name_ar: "معجون أسنان",
          price_da: 180,
          unit: "piece",
        },
        { name_fr: "Papier hygiénique (pack 4)", price_da: 200, unit: "piece" },
        {
          name_fr: "Détergent sol 1 L",
          name_ar: "منظف",
          price_da: 220,
          unit: "piece",
        },
        { name_fr: "Liquide vaisselle 1 L", price_da: 190, unit: "piece" },
        {
          name_fr: "Eau de javel 1 L",
          name_ar: "ماء جافيل",
          price_da: 90,
          unit: "piece",
        },
      ],
    },
    {
      title: "Bébé",
      products: [
        {
          name_fr: "Couches bébé (paquet)",
          name_ar: "حفاضات",
          price_da: 850,
          unit: "piece",
        },
        { name_fr: "Lingettes bébé", price_da: 250, unit: "piece" },
        { name_fr: "Lait infantile 400 g", price_da: 950, unit: "piece" },
      ],
    },
  ],
};

// ─── Boulangerie / Pâtisserie ────────────────────────────────────────────────
const BOULANGERIE: CatalogTemplate = {
  type: "boulangerie",
  label: "Boulangerie / Pâtisserie",
  categories: [
    {
      title: "Pains",
      products: [
        { name_fr: "Baguette", name_ar: "خبز", price_da: 15, unit: "piece" },
        {
          name_fr: "Pain complet",
          name_ar: "خبز كامل",
          price_da: 30,
          unit: "piece",
        },
        { name_fr: "Pain au son", price_da: 30, unit: "piece" },
        {
          name_fr: "Galette maison",
          name_ar: "مطلوع",
          price_da: 50,
          unit: "piece",
        },
      ],
    },
    {
      title: "Viennoiseries",
      products: [
        {
          name_fr: "Croissant",
          name_ar: "كرواسون",
          price_da: 50,
          unit: "piece",
        },
        {
          name_fr: "Pain au chocolat",
          name_ar: "بان شوكولا",
          price_da: 60,
          unit: "piece",
        },
        { name_fr: "Brioche", name_ar: "بريوش", price_da: 40, unit: "piece" },
        { name_fr: "Pain au lait", price_da: 40, unit: "piece" },
      ],
    },
    {
      title: "Pâtisseries",
      products: [
        { name_fr: "Mille-feuille", price_da: 120, unit: "piece" },
        { name_fr: "Éclair au chocolat", price_da: 120, unit: "piece" },
        { name_fr: "Tartelette aux fruits", price_da: 130, unit: "piece" },
        { name_fr: "Gâteau au yaourt (part)", price_da: 90, unit: "piece" },
      ],
    },
    {
      title: "Gâteaux traditionnels",
      products: [
        {
          name_fr: "Makrout (pièce)",
          name_ar: "مقروط",
          price_da: 40,
          unit: "piece",
        },
        {
          name_fr: "Baklava (pièce)",
          name_ar: "بقلاوة",
          price_da: 60,
          unit: "piece",
        },
        {
          name_fr: "Griwech (250 g)",
          name_ar: "قريوش",
          price_da: 250,
          unit: "piece",
        },
      ],
    },
  ],
};

export const CATALOG_TEMPLATES: Record<string, CatalogTemplate> = {
  superette: SUPERETTE,
  boulangerie: BOULANGERIE,
};

/** Modèle pour un type de commerce, ou null si non couvert. */
export function getCatalogTemplate(
  type: string | null
): CatalogTemplate | null {
  if (!type) return null;
  return CATALOG_TEMPLATES[type] ?? null;
}

/** Types de commerce disposant d'un modèle (pour l'UI admin). */
export function templateTypes(): { type: string; label: string }[] {
  return Object.values(CATALOG_TEMPLATES).map((t) => ({
    type: t.type,
    label: t.label,
  }));
}
