import { redirect } from "next/navigation";
import { Gift } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getFeatureFlags } from "@/lib/data/feature-flags";
import {
  LoyaltyProgramForm,
  type LoyaltyState,
} from "@/components/merchant/loyalty-program-form";

export const dynamic = "force-dynamic";

// Programme de fidélité du commerçant (SPEC-FIDELITE, étape 1.2) : cartes
// physiques + QR client, cashback et bons CLOISONNÉS à cette boutique.
// Le commerçant règle SON programme dans les bornes fixées par l'équipe
// Coligo ; la simulation en direct montre ce qu'un client gagnera.
export default async function LoyaltyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RPC hors types générés → bind obligatoire.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string
  ) => Promise<{ data: LoyaltyState | null; error: unknown }>;
  const [{ data: state, error }, flags] = await Promise.all([
    rpc("merchant_loyalty_state"),
    getFeatureFlags(),
  ]);
  if (error || !state) redirect("/login?error=no_merchant");

  const dormant = flags.loyalty.status !== "active";

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 lg:px-6">
      <header className="flex items-center gap-3">
        <div className="bg-primary-50 text-primary-700 rounded-control flex size-10 items-center justify-center">
          <Gift className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold">Fidélité</h1>
          <p className="text-muted text-sm">
            Cashback et bons d&apos;achat valables uniquement dans votre
            boutique.
          </p>
        </div>
      </header>

      {dormant && (
        <div className="rounded-control border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Lancement en préparation : vos réglages sont enregistrés, le programme
          sera ouvert aux clients par l&apos;équipe Coligo.
        </div>
      )}

      <LoyaltyProgramForm state={state} />
    </div>
  );
}
