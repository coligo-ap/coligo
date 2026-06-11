import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { DCourse } from "@/components/chauffeur/d-course";

export const dynamic = "force-dynamic";

export default async function ChauffeurCoursePage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");
  if (!gate.isVerified) redirect("/chauffeur");
  return <DCourse />;
}
