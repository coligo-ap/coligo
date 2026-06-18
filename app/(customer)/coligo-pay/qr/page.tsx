import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { WalletQrView } from "@/components/customer/wallet-qr-view";
import {
  getMyPayHandle,
  getWalletPinStatus,
} from "@/app/(customer)/coligo-pay/qr/actions";

export const dynamic = "force-dynamic";

// =============================================================================
// /coligo-pay/qr — écran QR du wallet (façon Alipay), Payer / Recevoir.
// Page autonome (pas de shell ni bottom-nav) → plein écran violet immersif.
// =============================================================================
export default async function ColigoPayQrPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tab = (await searchParams).tab === "recv" ? "recv" : "pay";
  if (!(await getAuthUser())) redirect("/se-connecter?next=/coligo-pay/qr");
  if (await getCurrentMerchant()) redirect("/dashboard");

  const customer = await getCurrentCustomerFull();
  const name = customer?.full_name ?? "Coligo";

  // Handle de réception STABLE (code unique, généré au 1er appel) encodé dans le
  // QR « Recevoir ». Pas un secret : il sert à identifier le bénéficiaire d'un
  // transfert Coligo Pay (boucle fermée).
  const [pinStatus, handleRes] = await Promise.all([
    getWalletPinStatus(),
    getMyPayHandle(),
  ]);

  return (
    <WalletQrView
      customerName={name}
      myHandle={handleRes?.handle ?? null}
      initialTab={tab}
      hasPin={pinStatus.hasPin}
      locked={pinStatus.locked}
    />
  );
}
