import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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

export default nextConfig;
