import type { Metadata } from "next";
import { MerchantShell } from "@/components/merchant/merchant-shell";
import { APP_CONFIG } from "@/lib/config/app-config";
import { pwaMetadata } from "@/lib/config/pwa";
import { headers } from "next/headers";
import { IdvRequiredScreen } from "@/components/idv/idv-required-screen";
import { idvBlocksAccess, idvRouteFor } from "@/lib/idv/compliance";

// Titre propre à l'espace commerçant (le layout racine est neutre « Coligo »)
// + PWA dédiée (manifest/icône/nom « Coligo Commerçant »).
export const metadata: Metadata = {
  title: `${APP_CONFIG.name} — Espace commerçant`,
  ...pwaMetadata("commercant"),
};

/**
 * Coque commerçant PARTAGÉE par toutes les sections (dashboard, orders,
 * catalog, stats, promotions, finances). Rendue UNE fois : en naviguant d'une
 * section à l'autre, l'auth + la requête boutique ne sont PAS rejouées et la
 * coque (sidebar / topbar / bottom-nav) ne se re-monte pas → navigation rapide.
 *
 * (login / signup vivent dans le groupe (auth) : ils ne doivent PAS être
 * enveloppés par la coque qui exige un utilisateur connecté.)
 */
export default async function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Vérification d'identité OBLIGATOIRE et non confirmée → écran bloquant RENDU
  // à la place de tout l'espace (jamais un redirect : React #310 en prod, cf.
  // lib/idv/compliance.ts). La page du parcours elle-même reste accessible.
  const idvRoute = idvRouteFor("merchant");
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (!pathname.startsWith(idvRoute) && (await idvBlocksAccess("merchant"))) {
    return <IdvRequiredScreen route={idvRoute} />;
  }
  return <MerchantShell>{children}</MerchantShell>;
}
