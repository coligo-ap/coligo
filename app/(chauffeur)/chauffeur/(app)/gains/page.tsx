"use client";

import { useChauffeurGate } from "@/components/chauffeur/gate-context";
import { DGains } from "@/components/chauffeur/d-gains";
import { DWait } from "@/components/chauffeur/d-gate";

export default function ChauffeurGainsPage() {
  const gate = useChauffeurGate();
  if (!gate.isVerified) return <DWait />;
  return <DGains />;
}
