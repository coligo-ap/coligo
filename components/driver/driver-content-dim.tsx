"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { OfflineDim } from "@/components/shared/offline-dim";

/**
 * Floutage hors-ligne du CONTENU des pages livreur « consultables » (gains,
 * historique, compte, documents, tournées…) — rendu DANS `DriverShell`, donc la
 * barre du bas (`DriverBottomNav`, sœur de `<main>`) reste nette.
 *
 * EXCLU : la course active (`/driver/course/*`) qui affiche `ExpressRun`, une
 * carte plein écran fixe — la flouter serait contre-productif. L'accueil
 * (`/driver`) n'utilise pas `DriverShell` : il est déjà hors périmètre.
 */
export function DriverContentDim({ children }: { children: ReactNode }) {
  const p = usePathname() || "";
  const isMap = p.startsWith("/driver/course");
  return <OfflineDim disabled={isMap}>{children}</OfflineDim>;
}
