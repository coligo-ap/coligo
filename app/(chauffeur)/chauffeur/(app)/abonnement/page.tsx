"use client";

import { Suspense } from "react";
import { DSubs } from "@/components/chauffeur/d-subs";

export default function ChauffeurAbonnementPage() {
  // Suspense : requis par useSearchParams (retour ?card=… de Chargily).
  return (
    <Suspense fallback={null}>
      <DSubs />
    </Suspense>
  );
}
