"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChauffeurGate } from "@/components/chauffeur/gate-context";
import { DCarpool } from "@/components/chauffeur/d-carpool";
import { DWait } from "@/components/chauffeur/d-gate";

/**
 * COVOITURAGE PAR PLACES : le chauffeur publie un départ inter-wilayas
 * programmé et vend ses places (mig 0443). Même gate que les Demandes.
 */
export default function ChauffeurCovoituragePage() {
  const gate = useChauffeurGate();
  const router = useRouter();

  useEffect(() => {
    if (!gate.submitted) router.replace("/chauffeur/documents");
  }, [gate.submitted, router]);

  if (!gate.submitted) return null;
  if (!gate.isVerified) return <DWait />;
  return <DCarpool />;
}
