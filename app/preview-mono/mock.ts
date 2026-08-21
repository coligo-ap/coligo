import type { MonoCategory } from "@/components/customer/mono/mono-category-rail";
import type { MonoMerchant } from "@/components/customer/mono/mono-merchant-card";

// Données MOCKÉES de l'écran de validation : aucune requête, aucun hook. Les
// formes reprennent celles des vraies données (`PublicMerchant`, catégories) →
// brancher revient à mapper, pas à réécrire les composants.

export const CATEGORIES: MonoCategory[] = [
  { code: "superette", label: "Supérette", image: "/hub/superette.webp" },
  { code: "fast_food", label: "Fast-food", image: "/hub/fastfood.webp" },
  {
    code: "boulangerie",
    label: "Boulangerie",
    image: "/categories/boulangerie.png",
  },
  { code: "epicerie", label: "Épicerie", image: "/categories/superette.png" },
  { code: "promos", label: "Promos", image: "/promo/percent.png" },
  { code: "livraison", label: "Livraison", image: "/promo/scooter.png" },
  { code: "cashback", label: "Cashback", image: "/promo/cashback.png" },
  { code: "trajets", label: "Trajets", image: "/hub/trajets.webp" },
];

export const NEARBY: MonoMerchant[] = [
  {
    slug: "burger-house-draria",
    name: "Burger House",
    cover: "/categories/photos/fast_food.jpg",
    rating: 4.7,
    reviews: 312,
    category: "Fast-food",
    eta: "20-30 min",
    fee: "150 DA",
    feeBefore: "250 DA",
    promos: ["-30 % sur les menus"],
    systemBadges: ["Sponsorisé"],
  },
  {
    slug: "le-pain-d-or",
    name: "Boulangerie Le Pain d'Or",
    cover: "/categories/photos/boulangerie.jpg",
    rating: 4.9,
    reviews: 128,
    category: "Boulangerie",
    eta: "15-25 min",
    fee: "Gratuit",
    feeBefore: "200 DA",
  },
  {
    slug: "superette-didouche",
    name: "Supérette Didouche",
    cover: "/categories/photos/superette.jpg",
    rating: 4.4,
    reviews: 87,
    category: "Supérette",
    eta: "25-40 min",
    fee: "200 DA",
    systemBadges: ["Précommande"],
  },
];

export const PROMOS: MonoMerchant[] = [
  {
    slug: "pizza-napoli",
    name: "Pizza Napoli",
    cover: "/categories/photos/pizzeria.jpg",
    rating: 4.6,
    reviews: 204,
    category: "Pizzeria",
    eta: "30-40 min",
    fee: "Gratuit",
    feeBefore: "300 DA",
    promos: ["2 achetées = 1 offerte", "Livraison offerte"],
  },
  {
    slug: "resto-la-baie",
    name: "Resto La Baie",
    cover: "/categories/photos/restaurant.jpg",
    rating: 4.8,
    reviews: 451,
    category: "Restaurant",
    eta: "35-50 min",
    fee: "250 DA",
    promos: ["-20 %"],
    systemBadges: ["Sponsorisé"],
  },
];

export const NEW_IN: MonoMerchant[] = [
  {
    slug: "boucherie-el-bahdja",
    name: "Boucherie El Bahdja",
    cover: "/categories/photos/boucherie.jpg",
    rating: 4.5,
    reviews: 36,
    category: "Boucherie",
    eta: "25-35 min",
    fee: "180 DA",
  },
  {
    slug: "fleurs-de-draria",
    name: "Fleurs de Draria",
    cover: "/categories/photos/fleuriste.jpg",
    rating: 5,
    reviews: 12,
    category: "Fleuriste",
    eta: "40-55 min",
    fee: "220 DA",
    systemBadges: ["Précommande"],
  },
];
