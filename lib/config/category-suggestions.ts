/**
 * Catégories de catalogue suggérées selon le TYPE de commerce (merchant.category).
 * Permet de pré-remplir le catalogue d'un commerçant en 1 clic, adapté à son
 * activité. Fallback générique si le type n'est pas listé.
 */

const SUGGESTIONS: Record<string, string[]> = {
  boulangerie: ["Pains", "Viennoiseries", "Pâtisseries", "Gâteaux", "Boissons"],
  superette: [
    "Épicerie salée",
    "Épicerie sucrée",
    "Boissons",
    "Frais",
    "Hygiène & entretien",
  ],
  fast_food: ["Burgers", "Sandwichs", "Tacos", "Accompagnements", "Boissons"],
  restaurant: ["Entrées", "Plats", "Desserts", "Boissons", "Menus"],
  cafe: ["Boissons chaudes", "Boissons fraîches", "Pâtisseries", "Snacks"],
  pizzeria: ["Pizzas", "Calzones", "Entrées", "Desserts", "Boissons"],
  creperie: ["Crêpes salées", "Crêpes sucrées", "Gaufres", "Boissons"],
  glacier: ["Glaces", "Sorbets", "Coupes", "Boissons"],
  boucherie: ["Bœuf", "Agneau", "Volaille", "Charcuterie", "Préparations"],
  poissonnerie: ["Poissons", "Fruits de mer", "Préparations"],
  fruits_legumes: ["Fruits", "Légumes", "Herbes & aromates", "Paniers"],
  produits_bio: ["Épicerie bio", "Fruits & légumes", "Boissons", "Cosmétiques"],
  fleuriste: ["Bouquets", "Plantes", "Compositions", "Accessoires"],
  pharmacie: ["Médicaments", "Parapharmacie", "Hygiène", "Bébé", "Compléments"],
  cosmetiques: ["Soin visage", "Maquillage", "Parfums", "Cheveux", "Corps"],
  vetements: ["Homme", "Femme", "Enfant", "Accessoires"],
  chaussures: ["Homme", "Femme", "Enfant", "Maroquinerie"],
  bijouterie: ["Bagues", "Colliers", "Bracelets", "Montres"],
  librairie: ["Livres", "Papeterie", "Fournitures scolaires", "Cadeaux"],
  jouets: ["0-3 ans", "3-6 ans", "6+ ans", "Jeux de société"],
  electronique: ["Téléphones", "Accessoires", "Audio", "Objets connectés"],
  informatique: ["Ordinateurs", "Composants", "Périphériques", "Accessoires"],
  electromenager: ["Gros électroménager", "Petit électroménager", "Cuisine"],
  quincaillerie: ["Outillage", "Plomberie", "Électricité", "Peinture"],
  decoration: ["Luminaires", "Textile", "Objets déco", "Cuisine"],
  ameublement: ["Salon", "Chambre", "Cuisine", "Rangement"],
  sport: ["Vêtements", "Chaussures", "Équipement", "Accessoires"],
  animalerie: ["Chien", "Chat", "Alimentation", "Accessoires"],
};

const GENERIC = ["Nouveautés", "Populaires", "Promotions", "Divers"];

export function suggestedCategoriesFor(
  merchantCategoryCode: string | null
): string[] {
  if (!merchantCategoryCode) return GENERIC;
  return SUGGESTIONS[merchantCategoryCode] ?? GENERIC;
}
