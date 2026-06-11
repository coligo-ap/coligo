import { DAuth } from "@/components/chauffeur/d-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coligo Drive · Espace chauffeur" };

export default function ChauffeurLoginPage() {
  return <DAuth tab="log" />;
}
