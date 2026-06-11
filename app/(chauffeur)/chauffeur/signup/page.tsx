import { DAuth } from "@/components/chauffeur/d-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coligo Drive · Inscription chauffeur" };

export default function ChauffeurSignupPage() {
  return <DAuth tab="reg" />;
}
