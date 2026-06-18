import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// i18n sans routing par segment d'URL : la locale vient d'un cookie
// (cf. i18n/request.ts). On ne préfixe pas les routes par /fr ou /ar, ce qui
// évite de restructurer tout le routing par rôle existant.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Upload des documents chauffeur (photos téléphone) via server action :
      // la limite par défaut (1 Mo) rejetait TOUTES les photos réelles.
      bodySizeLimit: "10mb",
    },
    // ── Router Cache (client) : fluidité du « retour arrière » ──────────────
    // Par défaut sur Next 15, `dynamic = 0` → revenir sur une page déjà visitée
    // RE-REND le Server Component depuis zéro (re-fetch réseau + flash du
    // loading.tsx + perte de l'état UI). On garde les segments dynamiques en
    // cache client 30 s : A → B → A réutilise le rendu déjà monté (instantané,
    // scroll + état préservés, AUCUN aller-retour serveur). Les mutations
    // (revalidatePath / router.refresh) invalident ce cache → pas de données
    // périmées après une écriture. La fraîcheur « live » reste assurée par le
    // polling / Realtime / TanStack Query des composants concernés.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  images: {
    remotePatterns: [
      // Images produits servies depuis Supabase Storage (bucket public).
      { protocol: "https", hostname: "*.supabase.co" },
      // Optimisation via Cloudinary Fetch (couche au-dessus de Supabase).
      { protocol: "https", hostname: "res.cloudinary.com" },
      // Photos libres de droits utilisées comme images de catégorie / fallbacks.
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
};

export default withNextIntl(nextConfig);
