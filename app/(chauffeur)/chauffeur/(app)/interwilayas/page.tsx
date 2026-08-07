"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChauffeurGate } from "@/components/chauffeur/gate-context";
import { DRequests } from "@/components/chauffeur/d-requests";
import { DWait } from "@/components/chauffeur/d-gate";

/**
 * Sous-page INTER-WILAYAS : les demandes de LONGS trajets entre wilayas,
 * cherchées dans un rayon d'approche élargi (config admin). Même écran que
 * les Demandes (composant partagé, scope "inter") — mêmes gestes Proposer /
 * Accepter / Refuser, même temps réel.
 */
export default function ChauffeurInterwilayasPage() {
  const gate = useChauffeurGate();
  const router = useRouter();

  useEffect(() => {
    if (!gate.submitted) router.replace("/chauffeur/documents");
  }, [gate.submitted, router]);

  if (!gate.submitted) return null;
  if (!gate.isVerified) return <DWait />;
  return <DRequests scope="inter" />;
}
