// =============================================================================
// Icône professionnelle par type de commerce (style Uber Eats).
// =============================================================================
// Les catégories commerçant peuvent être un CODE connu (MERCHANT_CATEGORIES) ou
// du texte libre saisi au profil ("Restauration", "Santé & Beauté"…). On mappe
// donc par MOTS-CLÉS (insensible aux accents/casse) vers une icône lucide, plutôt
// que par emoji. Robuste au texte libre, rendu net et cohérent.
// =============================================================================

import {
  Apple,
  Baby,
  Beef,
  BookOpen,
  CakeSlice,
  Coffee,
  Croissant,
  Dumbbell,
  Fish,
  Flower2,
  Footprints,
  Gem,
  HeartPulse,
  Home,
  IceCreamCone,
  Laptop,
  LayoutGrid,
  Leaf,
  PawPrint,
  Pill,
  Pizza,
  Plug,
  Sandwich,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sofa,
  Sparkles,
  Store,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Icône utilisée pour le filtre « Tous ». */
export const ALL_CATEGORIES_ICON: LucideIcon = LayoutGrid;

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Ordre = du PLUS spécifique au plus générique (1re règle qui matche gagne).
const RULES: { kw: string[]; icon: LucideIcon }[] = [
  { kw: ["boulang", "patiss", "viennoiser", "pain"], icon: Croissant },
  { kw: ["pizz"], icon: Pizza },
  { kw: ["cafe", "salon de the", "coffee", "the "], icon: Coffee },
  { kw: ["crep", "gaufre"], icon: CakeSlice },
  { kw: ["glac", "glace", "ice cream"], icon: IceCreamCone },
  { kw: ["fast", "burger", "snack", "sandwich"], icon: Sandwich },
  { kw: ["restaur", "traiteur", "gastronom"], icon: UtensilsCrossed },
  { kw: ["bouch", "charcut", "viande"], icon: Beef },
  { kw: ["poisson", "fruits de mer", "maree"], icon: Fish },
  { kw: ["fruit", "legume", "primeur", "verger", "maraich"], icon: Apple },
  { kw: ["bio", "terroir", "naturel"], icon: Leaf },
  {
    kw: ["superet", "epiceri", "supermarch", "alimentation", "grocer"],
    icon: ShoppingBasket,
  },
  { kw: ["fleur", "floris"], icon: Flower2 },
  { kw: ["pharma"], icon: Pill }, // attrape aussi parapharmacie
  { kw: ["sante", "medic", "clinic", "optic"], icon: HeartPulse },
  { kw: ["cosmet", "beaut", "maquill", "parfum", "coiff"], icon: Sparkles },
  {
    kw: ["vetement", "mode", "habill", "pret-a-porter", "pret a porter"],
    icon: Shirt,
  },
  { kw: ["chaussure", "maroquin", "sac "], icon: Footprints },
  { kw: ["bijou", "horlog", "montre", "joaill"], icon: Gem },
  { kw: ["librairi", "papeteri", "livre"], icon: BookOpen },
  { kw: ["jouet", "enfant", "bebe", "puericul"], icon: Baby },
  { kw: ["telephon", "phone", "mobile", "electroniq"], icon: Smartphone },
  { kw: ["informatiq", "ordinateur"], icon: Laptop },
  { kw: ["electromenager", "menager"], icon: Plug },
  { kw: ["quincaill", "bricolage", "outil", "droguerie"], icon: Wrench },
  { kw: ["ameublement", "mobilier", "meuble"], icon: Sofa },
  { kw: ["decor", "maison"], icon: Home },
  { kw: ["sport", "fitness", "gym"], icon: Dumbbell },
  { kw: ["animal"], icon: PawPrint },
];

/** Renvoie l'icône lucide la plus représentative pour une catégorie (code ou
 *  libellé libre). Fallback : Store (vitrine générique). */
export function categoryIcon(input: string | null | undefined): LucideIcon {
  if (!input) return Store;
  const n = normalize(input);
  for (const rule of RULES) {
    if (rule.kw.some((k) => n.includes(k))) return rule.icon;
  }
  return Store;
}
