import type { MetadataRoute } from "next";

// =============================================================================
// robots.txt — SEO professionnel :
//   - PUBLIC (crawlé) : accueil, boutiques /m/*, blog, pages légales/aide.
//   - PRIVÉ (disallow) : admin (ultra-sécurisé, jamais indexé), API, espaces
//     applicatifs (client connecté, commerçant, livreur, chauffeur, partner)
//     — ces URLs redirigent vers la connexion pour un robot, les crawler ne
//     sert à rien et pollue les rapports Search Console.
//   - Les pages d'AUTH (/se-connecter, /inscription, /login, /signup…) ne
//     sont PAS bloquées ici : elles portent un meta `noindex` que Google doit
//     pouvoir LIRE pour les retirer de l'index (un blocage robots empêcherait
//     de voir le noindex — cause des « doublons sans canonique »).
// =============================================================================

const PRIVATE_PATHS = [
  "/admin",
  "/api/",
  "/auth/",
  "/dev/",
  "/idv",
  "/print/",
  "/portail",
  "/bloque",
  "/offline",
  "/wallet",
  "/t/",
  "/r/",
  "/p/",
  "/payer/",
  // Espace client connecté
  "/compte",
  "/checkout",
  "/commandes",
  "/cart",
  "/adresses",
  "/favoris",
  "/cashback",
  "/coligo-pay",
  "/codes-promo",
  "/course",
  "/drive",
  "/parrainage",
  "/roue",
  // Espace commerçant
  "/dashboard",
  "/catalog",
  "/orders",
  "/encaisser",
  "/finances",
  "/identite",
  "/livraison",
  "/livreurs",
  "/promotions",
  "/recharger",
  "/settings",
  "/stats",
  "/aide",
  "/telecharger",
  // Espaces partenaires
  "/driver",
  "/chauffeur",
  "/partenaire",
];

export default function robots(): MetadataRoute.Robots {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://coligo.app"
  ).replace(/\/+$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
