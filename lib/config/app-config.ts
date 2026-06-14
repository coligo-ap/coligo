export const APP_CONFIG = {
  name: process.env.NEXT_PUBLIC_APP_NAME ?? "Coligo",
  shortName: process.env.NEXT_PUBLIC_APP_SHORT_NAME ?? "Coligo",
  tagline:
    process.env.NEXT_PUBLIC_APP_TAGLINE ??
    "Commandez à l'avance chez vos commerces de proximité",
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ??
    "Marketplace algérienne de commande à l'avance",

  domains: {
    customer: process.env.NEXT_PUBLIC_APP_DOMAIN ?? "coligo.app",
    merchant:
      process.env.NEXT_PUBLIC_MERCHANT_DOMAIN ?? "commercant.coligo.app",
    admin: process.env.NEXT_PUBLIC_ADMIN_DOMAIN ?? "admin.coligo.app",
  },

  locale: {
    country: process.env.NEXT_PUBLIC_DEFAULT_COUNTRY ?? "DZ",
    currency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY ?? "DA",
    phonePrefix: process.env.NEXT_PUBLIC_PHONE_PREFIX ?? "+213",
    locales: ["fr", "ar"] as const,
    defaultLocale: "fr" as const,
  },

  contact: {
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@coligo.app",
    salesEmail: process.env.NEXT_PUBLIC_SALES_EMAIL ?? "hello@coligo.app",
  },

  brand: {
    // Violet de marque Coligo (#6C2BD9) + accent rose (#FF2D7A, rare).
    primary: process.env.NEXT_PUBLIC_BRAND_PRIMARY ?? "#6C2BD9",
    accent: process.env.NEXT_PUBLIC_BRAND_ACCENT ?? "#FF2D7A",
  },

  // Commission prélevée par Coligo sur chaque commande (affichage commerçant).
  commission: {
    rate: Number(process.env.NEXT_PUBLIC_COMMISSION_RATE ?? "0.05"),
  },

  catalog: {
    // En-dessous (ou égal), un produit suivi en stock est signalé « stock bas ».
    lowStockThreshold: Number(
      process.env.NEXT_PUBLIC_LOW_STOCK_THRESHOLD ?? "5"
    ),
  },

  promotions: {
    // Plancher anti-abus : un prix après réduction ne peut jamais descendre
    // sous ce minimum (jamais 0 ni négatif). En DA.
    minPriceDa: Number(process.env.NEXT_PUBLIC_PROMO_MIN_PRICE_DA ?? "1"),
  },

  // APK Android « Coligo Commerçant » distribué hors Play Store (sideload).
  // L'URL est une variable d'environnement Vercel : on héberge le .apk où on
  // veut (Supabase Storage, Vercel Blob, etc.) et on remplace juste le lien
  // sans redéployer le code. Vide = bouton « bientôt disponible ».
  // L'impression thermique Sunmi intégrée ne fonctionne QUE via cet APK.
  merchantApk: {
    url: process.env.NEXT_PUBLIC_MERCHANT_APK_URL ?? "",
    version: process.env.NEXT_PUBLIC_MERCHANT_APK_VERSION ?? "",
    // Taille affichée (ex. « 8 Mo ») — purement indicatif.
    size: process.env.NEXT_PUBLIC_MERCHANT_APK_SIZE ?? "",
  },

  // APK « Coligo Livreur » (ouvre /driver) et « Coligo Drive » (ouvre
  // /chauffeur). Même principe que merchantApk : URL = variable d'env Vercel.
  driverApk: {
    url: process.env.NEXT_PUBLIC_DRIVER_APK_URL ?? "",
    version: process.env.NEXT_PUBLIC_DRIVER_APK_VERSION ?? "",
    size: process.env.NEXT_PUBLIC_DRIVER_APK_SIZE ?? "",
  },
  driveApk: {
    url: process.env.NEXT_PUBLIC_DRIVE_APK_URL ?? "",
    version: process.env.NEXT_PUBLIC_DRIVE_APK_VERSION ?? "",
    size: process.env.NEXT_PUBLIC_DRIVE_APK_SIZE ?? "",
  },
} as const;

/** Part commission Coligo (en DA, arrondie) pour un montant donné. */
export function commissionDA(totalDa: number): number {
  return Math.round(totalDa * APP_CONFIG.commission.rate);
}

export function isMerchantHost(host: string | null | undefined): boolean {
  if (!host) return false;
  if (host.startsWith("commercant.")) return true;
  return host === APP_CONFIG.domains.merchant;
}

export function isAdminHost(host: string | null | undefined): boolean {
  if (!host) return false;
  if (host.startsWith("admin.")) return true;
  return host === APP_CONFIG.domains.admin;
}
