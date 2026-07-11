"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { OfflineDim } from "@/components/shared/offline-dim";

/**
 * Floutage hors-ligne du CONTENU des pages chauffeur « consultables » (gains,
 * historique, compte, relevé, abonnement…) — rendu dans le layout `(app)`, où
 * `DNav` (barre du bas) est une SŒUR de `children` et reste donc nette.
 *
 * EXCLU : l'accueil (`/chauffeur`), une carte plein écran — la flouter serait
 * contre-productif. La course active et les documents vivent HORS du groupe
 * `(app)` : ils ne passent pas par ici.
 */
export function ChauffeurContentDim({ children }: { children: ReactNode }) {
  const p = usePathname() || "";
  const isMap = p === "/chauffeur";
  return <OfflineDim disabled={isMap}>{children}</OfflineDim>;
}
