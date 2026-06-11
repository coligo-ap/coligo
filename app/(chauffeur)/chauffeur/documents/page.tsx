import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DDocs } from "@/components/chauffeur/d-docs";

export const dynamic = "force-dynamic";

export default async function ChauffeurDocumentsPage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  return <DDocs />;
}
