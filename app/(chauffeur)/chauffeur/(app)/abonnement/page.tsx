"use client";

import { Suspense } from "react";
import { DSubs } from "@/components/chauffeur/d-subs";

// Affichage UNIFIÉ : la carte Prioritaire est désormais rendue DANS DSubs, en
// tête de la liste (Prioritaire → Gratuit → plans de commission), même design.
export default function ChauffeurAbonnementPage() {
  // Suspense : requis par useSearchParams (retour ?card=… de Chargily).
  return (
    <Suspense fallback={null}>
      <div className="pt-4">
        <DSubs />
      </div>
    </Suspense>
  );
}
