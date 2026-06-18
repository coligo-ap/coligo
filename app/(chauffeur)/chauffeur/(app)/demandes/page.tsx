"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChauffeurGate } from "@/components/chauffeur/gate-context";
import { DRequests } from "@/components/chauffeur/d-requests";
import { DWait } from "@/components/chauffeur/d-gate";

export default function ChauffeurDemandesPage() {
  const gate = useChauffeurGate();
  const router = useRouter();

  useEffect(() => {
    if (!gate.submitted) router.replace("/chauffeur/documents");
  }, [gate.submitted, router]);

  if (!gate.submitted) return null;
  if (!gate.isVerified) return <DWait />;
  return <DRequests />;
}
