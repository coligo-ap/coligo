"use client";

import { useChauffeurGate } from "@/components/chauffeur/gate-context";
import { DCompte } from "@/components/chauffeur/d-compte";

export default function ChauffeurComptePage() {
  const gate = useChauffeurGate();
  return <DCompte gate={gate} />;
}
