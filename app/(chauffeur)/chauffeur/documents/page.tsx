import { redirect } from "next/navigation";
import { getChauffeurGate, getChauffeurIdv } from "@/app/(chauffeur)/actions";
import { DDocs } from "@/components/chauffeur/d-docs";

export const dynamic = "force-dynamic";

export default async function ChauffeurDocumentsPage() {
  const [gate, idv] = await Promise.all([
    getChauffeurGate(),
    getChauffeurIdv(),
  ]);
  if (!gate) redirect("/chauffeur/login");
  return <DDocs rejectedReason={gate.rejectedReason} idv={idv} />;
}
