import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Images produits servies depuis Supabase Storage (bucket public).
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
