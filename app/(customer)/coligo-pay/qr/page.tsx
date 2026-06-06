import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/coligo-pay/qr");

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
