import { MerchantShell } from "@/components/merchant/merchant-shell";

/**
 * Coque commerçant PARTAGÉE par toutes les sections (dashboard, orders,
 * catalog, stats, promotions, finances). Rendue UNE fois : en naviguant d'une
 * section à l'autre, l'auth + la requête boutique ne sont PAS rejouées et la
 * coque (sidebar / topbar / bottom-nav) ne se re-monte pas → navigation rapide.
 *
 * (login / signup vivent dans le groupe (auth) : ils ne doivent PAS être
 * enveloppés par la coque qui exige un utilisateur connecté.)
 */
export default function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MerchantShell>{children}</MerchantShell>;
}
