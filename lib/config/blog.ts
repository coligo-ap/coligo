// =============================================================================
// Blog Coligo — SOURCE UNIQUE du contenu (même esprit que lib/config/legal.ts).
// =============================================================================
// Articles éditoriaux statiques : pas de CMS ni de table (le blog change
// rarement, un commit = une publication ; zéro coût, zéro surface d'attaque).
// Les visuels réutilisent les mêmes photos HD que la marketplace
// (lib/images/category-images.ts) via une CLÉ `coverKey` → cohérence visuelle
// et optimisation Cloudinary identique partout.
//
// `requiresFlag` : un article qui présente un service masquable (Drive, Pay)
// disparaît de la liste ET renvoie 404 si le service est masqué par le
// super-admin — même logique que les CGU dynamiques.

export type BlogSection = {
  heading?: string;
  paragraphs: string[];
};

export type BlogArticle = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  /** Date de publication (ISO, affichée en fr-DZ). */
  publishedAt: string;
  readMinutes: number;
  /** Clé dans CATEGORY_IMAGES (photo HD partagée avec la marketplace). */
  coverKey: string;
  /** Alt descriptif de la photo de couverture. */
  coverAlt: string;
  /** Feature flag requis pour que l'article soit visible (sinon 404). */
  requiresFlag?: "drive" | "coligo_pay" | "express";
  body: BlogSection[];
};

export const BLOG_ARTICLES: BlogArticle[] = [
  {
    slug: "pourquoi-coligo",
    title: "Pourquoi Coligo : la fin de la file d'attente chez vos commerçants",
    excerpt:
      "Nous avons créé Coligo avec une conviction simple : le commerce de quartier mérite les mêmes outils que les grandes enseignes — sans perdre son âme.",
    category: "Coligo",
    publishedAt: "2026-06-01",
    readMinutes: 4,
    coverKey: "superette",
    coverAlt: "Rayons d'une supérette de quartier",
    body: [
      {
        paragraphs: [
          "Tout est parti d'une scène que chaque Algérien connaît par cœur : la file devant la boulangerie le vendredi matin, le passage éclair à la supérette qui se transforme en vingt minutes d'attente, le boucher débordé qui fait patienter trois clients au téléphone. Le commerce de proximité est vivant, chaleureux, irremplaçable — mais il fait perdre du temps, des deux côtés du comptoir.",
          "Coligo est né pour régler exactement ce problème. Vous commandez à l'avance depuis votre téléphone, votre commerçant reçoit la commande instantanément, la prépare au calme, et vous passez la récupérer à l'heure convenue. Pas de file, pas d'aller-retour pour rien, pas de « revenez dans une heure ».",
        ],
      },
      {
        heading: "Le quartier d'abord",
        paragraphs: [
          "Contrairement aux plateformes qui centralisent tout dans des entrepôts, Coligo ne vend rien : ce sont vos commerces, ceux devant lesquels vous passez chaque jour, qui restent aux commandes. Le catalogue, les prix, les promotions — tout vient d'eux. Nous leur apportons la vitrine numérique, l'encaissement moderne et la logistique ; ils gardent la relation client et la qualité qui ont fait leur réputation.",
          "C'est aussi un choix économique assumé : chaque dinar dépensé sur Coligo reste dans le circuit local. Le commerçant développe son chiffre, le livreur du quartier gagne sa course, et le client gagne son temps.",
        ],
      },
      {
        heading: "Et ce n'est que le début",
        paragraphs: [
          "Commande à l'avance, retrait sans attente, livraison express, paiement simplifié : la boîte à outils s'agrandit mois après mois, toujours avec la même boussole — être utile au quartier. Bienvenue sur Coligo.",
        ],
      },
    ],
  },
  {
    slug: "guide-commander-a-lavance",
    title: "Commander à l'avance sur Coligo : le guide complet",
    excerpt:
      "Du choix du commerce au retrait de la commande, tout ce qu'il faut savoir pour ne plus jamais faire la queue — en cinq minutes de lecture.",
    category: "Guide client",
    publishedAt: "2026-06-10",
    readMinutes: 5,
    coverKey: "boulangerie",
    coverAlt: "Pains et viennoiseries en boulangerie",
    body: [
      {
        heading: "1. Trouvez votre commerce",
        paragraphs: [
          "Ouvrez Coligo : les commerces s'affichent triés par proximité, avec leur note, leur temps de préparation et leur statut (ouvert, fermé, pause). Utilisez les catégories — supérette, boulangerie, restaurant, pharmacie… — ou la recherche pour aller droit au but. Chaque fiche montre le vrai catalogue du commerçant, mis à jour par lui-même.",
        ],
      },
      {
        heading: "2. Composez votre panier",
        paragraphs: [
          "Ajoutez vos produits ; certains se vendent au poids ou au litre (viande, fruits, olives…) : indiquez simplement la quantité voulue, le prix se calcule tout seul. Les promotions du commerçant s'appliquent automatiquement — le prix barré que vous voyez est le vrai prix en boutique.",
          "Le minimum de commande et le temps de préparation sont affichés avant de valider : aucune surprise.",
        ],
      },
      {
        heading: "3. Choisissez retrait ou livraison",
        paragraphs: [
          "Au moment de valider, choisissez votre créneau de retrait — ou la livraison express si le commerce la propose : un livreur partenaire vous apporte la commande, avec suivi en temps réel sur la carte.",
          "Vous recevez un numéro de commande et un code de retrait secret. En boutique, montrez le code (ou votre ticket) : le commerçant vous remet votre commande, déjà prête.",
        ],
      },
      {
        heading: "4. Payez comme vous voulez",
        paragraphs: [
          "Espèces au retrait ou à la livraison, solde Coligo Pay, ou paiement en ligne quand il est proposé : le détail (produits, frais éventuels, remises) est toujours affiché avant confirmation, et repris dans votre historique.",
          "Un imprévu ? Le chat intégré vous met en relation avec le commerçant ou le livreur, et le support Coligo veille 7j/7.",
        ],
      },
    ],
  },
  {
    slug: "conseils-commercants-reussir",
    title: "Commerçants : 7 réflexes pour cartonner sur Coligo",
    excerpt:
      "Belles photos, catalogue à jour, promotions honnêtes, préparation carrée : les habitudes des commerçants qui transforment les visites en habitués.",
    category: "Partenaires",
    publishedAt: "2026-06-20",
    readMinutes: 6,
    coverKey: "fruits_legumes",
    coverAlt: "Étal de fruits et légumes frais",
    body: [
      {
        paragraphs: [
          "Des centaines de commerçants utilisent déjà Coligo au quotidien. Ceux qui décollent le plus vite partagent les mêmes réflexes — les voici, sans langue de bois.",
        ],
      },
      {
        heading: "Soignez l'image, vraiment",
        paragraphs: [
          "1 — Une photo de couverture nette et lumineuse. C'est la première chose que voit le client : une devanture propre, un étal colorié, un four qui sort une fournée. Évitez les photos sombres ou floues prises à la va-vite ; l'équipe Coligo peut vous proposer un visuel professionnel adapté à votre catégorie si vous n'en avez pas.",
          "2 — Des photos de produits en gros plan, sur fond clair. Un client achète ce qu'il voit. Dix produits bien photographiés valent mieux que cent vignettes grises.",
        ],
      },
      {
        heading: "Un catalogue vivant",
        paragraphs: [
          "3 — Tenez les stocks à jour : un produit en rupture affiché disponible, c'est une commande annulée et un client déçu. L'archivage doux permet de masquer un produit en un geste, sans le supprimer.",
          "4 — Utilisez les promotions pour les vraies occasions : fin de journée en boulangerie, arrivage du jour chez le primeur. Les clients repèrent vite les fausses remises — et la plateforme aussi.",
        ],
      },
      {
        heading: "Une préparation carrée",
        paragraphs: [
          "5 — Acceptez vite : une commande acceptée dans les minutes rassure le client et améliore votre visibilité.",
          "6 — Respectez le créneau : « prêt à 17 h » veut dire prêt à 17 h. Le temps de préparation affiché sur votre fiche se règle dans votre espace — soyez honnête avec lui.",
          "7 — Le petit plus qui fidélise : un mot sur le ticket, un produit bien emballé, une suggestion au retrait. Le numérique amène le client, c'est votre accueil qui le fait revenir.",
        ],
      },
    ],
  },
  {
    slug: "coligo-pay-payer-sans-monnaie",
    title: "Coligo Pay : payer sans monnaie, recharger près de chez vous",
    excerpt:
      "Un solde prépayé, rechargeable en espèces chez un agent agréé du quartier, pour régler ses commandes en un geste. Voici comment ça marche.",
    category: "Coligo Pay",
    publishedAt: "2026-06-28",
    readMinutes: 4,
    coverKey: "cafe",
    coverAlt: "Comptoir d'un café de quartier",
    requiresFlag: "coligo_pay",
    body: [
      {
        paragraphs: [
          "« Vous n'avez pas de monnaie ? » — la phrase qui ralentit tous les comptoirs du pays. Coligo Pay la fait disparaître : un solde prépayé attaché à votre compte, que vous utilisez pour régler vos commandes en un geste, au dinar près.",
        ],
      },
      {
        heading: "Recharger : simple et humain",
        paragraphs: [
          "Pas besoin de carte bancaire : vous rechargez en espèces auprès d'un Agent Coligo Pay agréé — souvent un commerce que vous connaissez déjà. L'application vous montre les points de recharge autour de vous, avec horaires et itinéraire. Vous donnez le montant, l'agent crédite, le solde apparaît instantanément.",
          "Chaque opération — recharge, paiement, remboursement — est inscrite dans un registre horodaté et infalsifiable, consultable depuis votre application.",
        ],
      },
      {
        heading: "Payer : un geste, zéro friction",
        paragraphs: [
          "Au moment de commander, choisissez « Coligo Pay » : le montant exact est débité, pas de monnaie à rendre, pas d'attente au comptoir. En boutique, le paiement par QR code permet aussi de régler un achat direct en quelques secondes.",
          "Votre solde est protégé par un code PIN, et le support peut geler un compte en cas de perte du téléphone. Simple ne veut pas dire fragile.",
        ],
      },
    ],
  },
  {
    slug: "coulisses-livraison-express",
    title: "Dans les coulisses de la livraison express",
    excerpt:
      "Que se passe-t-il entre le moment où vous validez votre panier et celui où l'on sonne à votre porte ? Suivez une commande, étape par étape.",
    category: "Livraison",
    publishedAt: "2026-07-05",
    readMinutes: 5,
    coverKey: "fast_food",
    coverAlt: "Préparation d'une commande à emporter",
    requiresFlag: "express",
    body: [
      {
        heading: "Minute 0 : la commande part",
        paragraphs: [
          "Vous validez votre panier en livraison express. Le commerçant reçoit la commande sur sa tablette et commence la préparation ; en parallèle, Coligo cherche le bon livreur : disponible, proche, dans sa zone de travail. Pas d'attribution au hasard — c'est ce qui fait la différence entre « en route » et « où est ma commande ? ».",
        ],
      },
      {
        heading: "La course, en toute transparence",
        paragraphs: [
          "Le livreur accepte, récupère la commande auprès du commerçant, et vous suivez tout en direct sur la carte : départ de la boutique, trajet, arrivée. Le chat intégré permet de préciser un digicode ou un point de repère sans donner votre numéro.",
          "À la livraison, vous payez en espèces ou tout est déjà réglé en ligne — le livreur, lui, est rémunéré à la course, avec un relevé transparent de chaque dinar.",
        ],
      },
      {
        heading: "Et si ça se passe mal ?",
        paragraphs: [
          "Client injoignable, adresse introuvable, litige : chaque cas passe par le support, qui tranche selon des règles claires — remboursement, nouvelle livraison ou compensation. La confiance ne se décrète pas, elle se construit commande après commande.",
        ],
      },
    ],
  },
  {
    slug: "coligo-drive-prix-annonce",
    title: "Coligo Drive : se déplacer au prix annoncé, sans surprise",
    excerpt:
      "Une course dont le prix est connu avant de confirmer, des chauffeurs vérifiés, un suivi en direct : la mise en relation de transport, version Coligo.",
    category: "Coligo Drive",
    publishedAt: "2026-07-07",
    readMinutes: 4,
    coverKey: "restaurant",
    coverAlt: "Rue commerçante en ville",
    requiresFlag: "drive",
    body: [
      {
        paragraphs: [
          "Le principe de Coligo Drive tient en une phrase : le prix que vous voyez est le prix que vous payez. Vous indiquez départ et destination, le tarif s'affiche, vous confirmez — ou pas. Aucun compteur qui tourne, aucune surprise à l'arrivée.",
        ],
      },
      {
        heading: "Des chauffeurs partenaires vérifiés",
        paragraphs: [
          "Chaque chauffeur passe une validation de dossier complète — pièces, véhicule, selfie de vérification — avant de pouvoir prendre sa première course. Notes et signalements sont suivis par l'équipe : la qualité de service n'est pas optionnelle.",
          "Votre numéro de téléphone peut rester masqué : le chauffeur vous joint via l'application, votre vie privée reste la vôtre.",
        ],
      },
      {
        heading: "Pensé pour l'Algérie",
        paragraphs: [
          "Paiement en espèces ou via Coligo Pay, recherche de lieux qui comprend les noms de quartiers comme on les dit vraiment, suivi de course partageable avec un proche : Drive est conçu ici, pour les trajets d'ici.",
        ],
      },
    ],
  },
];

/** Article par slug (ou undefined). */
export function blogArticle(slug: string): BlogArticle | undefined {
  return BLOG_ARTICLES.find((a) => a.slug === slug);
}

/** Date lisible fr-DZ (ex. « 5 juillet 2026 ») — sans Intl côté rendu mixte,
 *  format manuel stable (cf. piège hydratation formatDA/Intl). */
const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
export function blogDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_FR[(m ?? 1) - 1]} ${y}`;
}
