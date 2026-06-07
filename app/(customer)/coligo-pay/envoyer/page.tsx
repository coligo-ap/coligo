import { redirect } from "next/navigation";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { getMyTopupBalance } from "@/lib/customer/cashback";
import { EnvoyerAmiView } from "@/components/customer/envoyer-ami-view";
import {
  getRecentRecipients,
  getWalletPinStatus,
} from "@/app/(customer)/coligo-pay/qr/actions";

export const dynamic = "force-dynamic";

// =============================================================================
// /coligo-pay/envoyer — « Envoyer à un ami » (transfert P2P Coligo Pay).
// Flux : recherche → montant → confirmation + PIN. Boucle fermée (bénéficiaire
// = compte Coligo). Sécurité côté SQL (PIN, idempotence, anti double-dépense,
// double-entrée). Header de sous-page + nav bas (CustomerShell hideHeader).
// =============================================================================
export default async function EnvoyerAmiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/coligo-pay/envoyer");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) redirect("/dashboard");

  const { data: customer } = await supabase
    .from("customers")
    .select("full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const [balance, recents, pin] = await Promise.all([
    getMyTopupBalance(),
    getRecentRecipients(),
    getWalletPinStatus(),
  ]);

  return (
    <CustomerShell hideHeader>
      <EnvoyerAmiView
        senderName={customer?.full_name ?? "Toi"}
        balanceDa={balance}
        recents={recents}
        hasPin={pin.hasPin}
        locked={pin.locked}
      />
    </CustomerShell>
  );
}
