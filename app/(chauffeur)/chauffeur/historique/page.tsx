import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DHisto } from "@/components/chauffeur/d-gains";

export const dynamic = "force-dynamic";

export default async function ChauffeurHistoriquePage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  return <DHisto />;
}
