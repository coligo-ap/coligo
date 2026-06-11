import { createClient } from "@/lib/supabase/server";
import { DAuth } from "@/components/chauffeur/d-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coligo Drive · Inscription chauffeur" };

export default async function ChauffeurSignupPage() {
  // Session chauffeur déjà active ? → DAuth affiche un bandeau « déconnexion »
  // (indispensable pour inscrire un NOUVEAU chauffeur depuis le même appareil).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const connectedPhone = user?.email?.endsWith("@chauffeurs.coligo.local")
    ? user.email.split("@")[0]
    : null;
  return <DAuth tab="reg" connectedPhone={connectedPhone} />;
}
