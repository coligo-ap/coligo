import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// i18n sans routing par segment d'URL : la locale vient d'un cookie
// (cf. i18n/request.ts). On ne préfixe pas les routes par /fr ou /ar, ce qui
// évite de restructurer tout le routing par rôle existant.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // ── Pipeline ML IDV (docs/IDV-KYC.md) ─────────────────────────────────────
  // Modules natifs : jamais bundlés par webpack/turbopack, chargés au runtime.
  serverExternalPackages: ["onnxruntime-node", "sharp", "tesseract.js"],
  // Les modèles ONNX + tessdata (models/idv/) voyagent avec les fonctions
  // IDV, ainsi que tesseract.js (worker_threads : chemins résolus au runtime,
  // le traçage statique ne les voit pas)…
  outputFileTracingIncludes: {
    "/api/idv/**": [
      "./models/idv/**",
      "./node_modules/tesseract.js/**",
      "./node_modules/tesseract.js-core/**",
    ],
  },
  // …et les binaires onnxruntime des AUTRES plateformes (222 Mo sur 259) sont
  // exclus, sinon la fonction dépasse la limite Vercel de 250 Mo (vécu :
  // 338,89 Mo → échec du build). Vercel exécute du linux x64 : on ne garde
  // que lui. ⚠️ Le préfixe « ./ » est REQUIS par le matcher de Next — sans
  // lui, l'exclusion est ignorée silencieusement.
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/win32/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**",
    ],
  },
  // /search → / (la recherche vit sur l'accueil). Redirection HTTP RÉELLE,
  // AVANT tout rendu : l'ancienne page qui faisait redirect() pendant le
  // rendu streamait d'abord sa coque (200 + script de redirection) → le
  // client hydratait /search puis se faisait rediriger en plein vol =
  // erreur React #310 en prod (bug vécu). Les query params (q, category…)
  // sont transmis automatiquement.
  async redirects() {
    return [{ source: "/search", destination: "/", permanent: false }];
  },
  experimental: {
    serverActions: {
      // Upload des documents chauffeur (photos téléphone) via server action :
      // la limite par défaut (1 Mo) rejetait TOUTES les photos réelles.
      bodySizeLimit: "10mb",
    },
    // ── Router Cache (client) : fluidité du « retour arrière » ──────────────
    // Par défaut sur Next 15, `dynamic = 0` → revenir sur une page déjà visitée
    // RE-REND le Server Component depuis zéro (re-fetch réseau + flash du
    // loading.tsx + perte de l'état UI). On garde les segments visités en cache
    // client 5 MINUTES : naviguer drive → commandes → accueil → drive… réutilise
    // les rendus déjà montés (instantané, AUCUN aller-retour serveur) — plus
    // jamais la sensation « chaque page se recharge comme un F5 » (30 s était
    // trop court : au-delà, chaque retour re-téléchargeait tout). La FRAÎCHEUR
    // n'y perd rien : les mutations invalident ce cache (revalidatePath /
    // router.refresh), le retour au premier plan re-streame la page courante
    // (RouteRefreshOnFocus, sondé), et le « live » reste porté par polling /
    // Realtime / TanStack Query. NE PAS redescendre ces valeurs.
    staleTimes: {
      dynamic: 300,
      static: 300,
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
