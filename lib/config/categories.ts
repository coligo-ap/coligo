export type MerchantCategory = {
  code: string;
  label: string;
  emoji: string;
};

export const MERCHANT_CATEGORIES: MerchantCategory[] = [
  { code: "boulangerie", label: "Boulangerie / Pâtisserie", emoji: "🥖" },
  { code: "superette", label: "Supérette / Épicerie", emoji: "🛒" },
  { code: "fast_food", label: "Fast-food / Restauration rapide", emoji: "🍔" },
  { code: "restaurant", label: "Restaurant", emoji: "🍽️" },
  { code: "cafe", label: "Café / Salon de thé", emoji: "☕" },
  { code: "pizzeria", label: "Pizzeria", emoji: "🍕" },
  { code: "creperie", label: "Crêperie / Gaufres", emoji: "🥞" },
  { code: "glacier", label: "Glacier", emoji: "🍦" },
  { code: "boucherie", label: "Boucherie / Charcuterie", emoji: "🥩" },
  { code: "poissonnerie", label: "Poissonnerie", emoji: "🐟" },
  { code: "fruits_legumes", label: "Fruits & Légumes", emoji: "🥦" },
  { code: "produits_bio", label: "Produits bio / Terroir", emoji: "🌿" },
  { code: "fleuriste", label: "Fleuriste", emoji: "💐" },
  { code: "pharmacie", label: "Pharmacie / Parapharmacie", emoji: "💊" },
  { code: "cosmetiques", label: "Cosmétiques / Beauté", emoji: "💄" },
  { code: "vetements", label: "Vêtements / Mode", emoji: "👕" },
  { code: "chaussures", label: "Chaussures / Maroquinerie", emoji: "👟" },
  { code: "bijouterie", label: "Bijouterie / Horlogerie", emoji: "💍" },
  { code: "librairie", label: "Librairie / Papeterie", emoji: "📚" },
  { code: "jouets", label: "Jouets / Enfants", emoji: "🧸" },
  { code: "electronique", label: "Électronique / Téléphonie", emoji: "📱" },
  { code: "informatique", label: "Informatique", emoji: "💻" },
  { code: "electromenager", label: "Électroménager", emoji: "🔌" },
  { code: "quincaillerie", label: "Quincaillerie / Bricolage", emoji: "🔧" },
  { code: "decoration", label: "Décoration / Maison", emoji: "🏠" },
  { code: "ameublement", label: "Ameublement / Mobilier", emoji: "🛋️" },
  { code: "sport", label: "Articles de sport", emoji: "⚽" },
  { code: "animalerie", label: "Animalerie", emoji: "🐾" },
  { code: "autre", label: "Autre", emoji: "🏷️" },
];

export function getCategory(code: string): MerchantCategory | undefined {
  return MERCHANT_CATEGORIES.find((c) => c.code === code);
}

export function getCategoryLabel(code: string): string {
  return getCategory(code)?.label ?? code;
}
