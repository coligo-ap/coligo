"use client";

import {
  Bike,
  Car,
  LayoutDashboard,
  Megaphone,
  Settings2,
  ShieldCheck,
  Store,
  Wallet,
} from "lucide-react";
import type { AlertDomain } from "@/lib/alerts/alert-model";

// =============================================================================
// Navigation super-admin regroupée en 8 DOMAINES fonctionnels (chaque domaine
// est un hub à onglets — la sous-navigation se fait via les onglets du hub).
// `match` = préfixes de routes supplémentaires appartenant au domaine (pour
// l'état actif). `domain` = clé d'alerte (mig 0274) : le badge/pastille de
// gravité affiché sur le domaine est DÉRIVÉ du moteur d'alertes (plus de
// compteurs ad hoc câblés à la main).
// =============================================================================

export type AdminDomain = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  match?: string[];
  /** Clé du moteur d'alertes → pilote le badge de gravité + compteur. */
  domain: AlertDomain;
};

export const ADMIN_DOMAINS: AdminDomain[] = [
  {
    href: "/admin",
    label: "Pilotage",
    icon: LayoutDashboard,
    exact: true,
    match: ["/admin/orders", "/admin/alertes"],
    domain: "pilotage",
  },
  {
    href: "/admin/merchants",
    label: "Commerçants",
    icon: Store,
    domain: "commercants",
  },
  {
    href: "/admin/drivers",
    label: "Livraison",
    icon: Bike,
    match: ["/admin/livraison"],
    domain: "livraison",
  },
  {
    href: "/admin/chauffeurs",
    label: "Coligo Drive",
    icon: Car,
    match: ["/admin/drive"],
    domain: "drive",
  },
  {
    href: "/admin/coligo-pay",
    label: "Coligo Pay & Finances",
    icon: Wallet,
    match: ["/admin/agents", "/admin/recharges", "/admin/versements"],
    domain: "finances",
  },
  {
    href: "/admin/marketing",
    label: "Marketing",
    icon: Megaphone,
    match: ["/admin/bannieres", "/admin/notifications"],
    domain: "marketing",
  },
  {
    href: "/admin/reports",
    label: "Confiance & Sécurité",
    icon: ShieldCheck,
    match: ["/admin/devices", "/admin/security"],
    domain: "confiance",
  },
  {
    href: "/admin/controle",
    label: "Plateforme",
    icon: Settings2,
    match: ["/admin/settings", "/admin/config", "/admin/zones"],
    domain: "plateforme",
  },
];

/** Un préfixe matche la route s'il est égal ou suivi d'un « / » (évite que
 *  /admin/drive (Drive) capture /admin/drivers (Livraison)). */
function prefixMatches(pathname: string, p: string): boolean {
  return pathname === p || pathname.startsWith(p + "/");
}

export function isAdminDomainActive(pathname: string, d: AdminDomain): boolean {
  const hrefHit = d.exact
    ? pathname === d.href
    : prefixMatches(pathname, d.href);
  if (hrefHit) return true;
  return (d.match ?? []).some((m) => prefixMatches(pathname, m));
}
