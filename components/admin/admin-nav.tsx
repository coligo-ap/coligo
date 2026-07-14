"use client";

import {
  ADMIN_NAV,
  isDomainActive,
  type AdminNavDomain,
} from "@/lib/admin/navigation";
import type { AlertDomain } from "@/lib/alerts/alert-model";

// =============================================================================
// Navigation super-admin — DÉRIVÉE du plan unique (lib/admin/navigation.ts).
//
// Ce fichier ne DÉCRIT plus rien : il expose l'arborescence aux composants de
// nav. Une page ajoutée au plan apparaît d'un coup dans le tiroir, dans les
// onglets de son hub et dans la recherche — impossible que l'un des trois
// ignore ce que les deux autres savent.
//
// `key` = clé du moteur d'alertes (mig 0274) : le badge de gravité affiché sur
// un domaine en est DÉRIVÉ (aucun compteur câblé à la main).
// =============================================================================

export type AdminDomain = AdminNavDomain;

export const ADMIN_DOMAINS: AdminDomain[] = ADMIN_NAV;

/**
 * Domaines VISIBLES pour la session : owner ⇒ tous ; staff ⇒ uniquement ceux de
 * `allowed`. Le filtrage nav est du CONFORT (la vraie barrière est serveur +
 * RLS) mais évite de montrer à un staff des hubs qui le redirigeraient aussitôt.
 */
export function visibleDomains(
  allowed: AlertDomain[],
  isOwner: boolean
): AdminDomain[] {
  if (isOwner) return ADMIN_DOMAINS;
  return ADMIN_DOMAINS.filter((d) => allowed.includes(d.key));
}

export function isAdminDomainActive(pathname: string, d: AdminDomain): boolean {
  return isDomainActive(pathname, d);
}
