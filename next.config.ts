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
