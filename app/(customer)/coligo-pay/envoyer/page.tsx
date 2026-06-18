import { redirect } from "next/navigation";
import { CustomerShell } from "@/components/customer/customer-shell";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
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
  const user = await getAuthUser();
  if (!user) redirect("/se-connecter?next=/coligo-pay/envoyer");
  if (await getCurrentMerchant()) redirect("/dashboard");

  const customer = await getCurrentCustomerFull();

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
