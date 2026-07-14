"use client";

import { usePathname } from "next/navigation";
import {
  ADMIN_DOMAINS,
  isAdminDomainActive,
} from "@/components/admin/admin-nav";
import { DomainAlertBanner } from "@/components/admin/domain-alert-banner";

/**
 * Détermine le domaine de la page courante (via le pathname + ADMIN_DOMAINS) et
 * affiche son bandeau d'alertes contextuel. Monté une seule fois dans la coque
 * admin → CHAQUE page de domaine montre automatiquement ses propres alertes,
 * sans toucher aux composants de hub. Masqué sur le centre d'alertes lui-même
 * (`/admin/alertes`), où l'info serait redondante.
 */
export function AdminContextualAlerts() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin/alertes")) return null;
  const active = ADMIN_DOMAINS.find((d) => isAdminDomainActive(pathname, d));
  if (!active) return null;
  return <DomainAlertBanner domain={active.key} />;
}
