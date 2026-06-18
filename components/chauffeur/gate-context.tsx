"use client";

import { createContext, useContext } from "react";
import type { ChauffeurGate } from "@/app/(chauffeur)/actions";

/**
 * Contexte du GATE chauffeur (statut/profil : vérifié, gelé, dossier soumis,
 * gamme, avatar…). Le gate est résolu UNE SEULE FOIS côté serveur dans la coque
 * persistante `(app)` (cf. `ChauffeurGateGuard`) puis exposé ici. Les pages le
 * lisent en client → AUCUN aller-retour serveur à chaque changement d'onglet
 * (fin du « loading complet de chaque page »). La sécurité réelle reste serveur
 * (RLS + RPC) : ce contexte ne sert qu'au routage/affichage.
 */
const Ctx = createContext<ChauffeurGate | null>(null);

export function ChauffeurGateProvider({
  gate,
  children,
}: {
  gate: ChauffeurGate;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={gate}>{children}</Ctx.Provider>;
}

export function useChauffeurGate(): ChauffeurGate {
  const gate = useContext(Ctx);
  if (!gate) {
    throw new Error(
      "useChauffeurGate doit être utilisé sous ChauffeurGateProvider"
    );
  }
  return gate;
}
