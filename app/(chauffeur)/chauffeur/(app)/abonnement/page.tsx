"use client";

import { Suspense } from "react";
import { DSubs } from "@/components/chauffeur/d-subs";
import { PriorityCard } from "@/components/partner/priority-card";

export default function ChauffeurAbonnementPage() {
  // Suspense : requis par useSearchParams (retour ?card=… de Chargily).
  return (
    <Suspense fallback={null}>
      <div className="p-4">
        <PriorityCard />
      </div>
      <DSubs />
    </Suspense>
  );
}
