import { headers } from "next/headers";
import { ShieldX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Écran « accès bloqué » servi (par réécriture middleware) aux IP bannies
 * (mig 0287). Affiche le message saisi par le super-admin s'il y en a un, sinon
 * un texte générique. Aucune action possible — la session est de toute façon
 * coupée et l'IP rejetée.
 */
export default async function BlockedPage() {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";

  let message: string | null = null;
  if (ip) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.rpc(
        "blocked_ip_message" as never,
        {
          p_ip: ip,
        } as never
      );
      message = (data as string | null) ?? null;
    } catch {
      message = null;
    }
  }

  return (
    <div className="bg-surface-2 flex min-h-screen items-center justify-center p-6">
      <div className="border-border w-full max-w-md rounded-[18px] border bg-white p-8 text-center shadow-sm">
        <div className="bg-danger-50 mx-auto flex size-14 items-center justify-center rounded-full">
          <ShieldX className="text-danger-600 size-7" />
        </div>
        <h1 className="text-foreground mt-4 text-xl font-bold">Accès bloqué</h1>
        <p className="text-muted mt-2 text-sm">
          {message ??
            "L'accès depuis cette connexion a été restreint. Si vous pensez qu'il s'agit d'une erreur, contactez le support."}
        </p>
      </div>
    </div>
  );
}
