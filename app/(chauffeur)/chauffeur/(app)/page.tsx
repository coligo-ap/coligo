"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChauffeurGate } from "@/components/chauffeur/gate-context";
import { DHome } from "@/components/chauffeur/d-home";
import { DWait } from "@/components/chauffeur/d-gate";

/**
 * Accueil chauffeur. Le gate (statut) vient du contexte de la coque — résolu une
 * seule fois côté serveur → navigation instantanée, sans aller-retour à chaque
 * onglet. Routage propre à l'accueil : dossier non soumis → /documents ; soumis
 * mais non vérifié → écran d'attente. (auth/gel/blocage déjà gérés par la coque)
 */
export default function ChauffeurHomePage() {
  const gate = useChauffeurGate();
  const router = useRouter();

  useEffect(() => {
    if (!gate.submitted) router.replace("/chauffeur/documents");
  }, [gate.submitted, router]);

  if (!gate.submitted) return null;
  if (!gate.isVerified) return <DWait />;
  return <DHome gate={gate} />;
}
