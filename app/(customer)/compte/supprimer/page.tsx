import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import {
  getMyCashbackBalance,
  getMyTopupBalance,
} from "@/lib/customer/cashback";
import { DeleteAccountScreen } from "@/components/customer/delete-account-screen";

export const dynamic = "force-dynamic";

// =============================================================================
// /compte/supprimer — suppression de compte client.
// =============================================================================
// Exigence Google Play : toute app avec création de compte doit proposer la
// suppression IN-APP et via une URL WEB — cette page (coligo.app/compte/
// supprimer) sert les deux. Page autonome (pattern /compte/infos : topbar
// propre, pas de bottom-nav). Les compteurs ci-dessous ne servent qu'à
// l'affichage : l'action serveur re-vérifie tout via service_role.
// =============================================================================

/** Statuts de course Drive « en vol » (mêmes valeurs que l'action serveur). */
const ACTIVE_RIDE_STATUSES = [
  "searching",
  "accepted",
  "arriving",
  "arrived",
  "in_progress",
];

export default async function DeleteAccountPage() {
  const t = await getTranslations("account");
  const user = await getAuthUser();
  if (!user) redirect("/se-connecter?next=/compte/supprimer");
  if (await getCurrentMerchant()) redirect("/dashboard");
  const customer = await getCurrentCustomerFull();
  if (!customer) redirect("/compte");

  const supabase = await createClient();
  const [ordersRes, ridesRes, cashbackDa, topupDa] = await Promise.all([
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customer.id)
      .not("status", "in", "(completed,cancelled)"),
    supabase
      .from("rides")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customer.id)
      .in("status", ACTIVE_RIDE_STATUSES),
    getMyCashbackBalance(),
    getMyTopupBalance(),
  ]);
  const blocked = (ordersRes.count ?? 0) > 0 || (ridesRes.count ?? 0) > 0;

  return (
    <div className="bg-surface-2 min-h-screen">
      {/* En-tête simple : retour + titre (pattern /compte/infos). */}
      <header className="border-border sticky top-0 z-20 flex items-center gap-3 border-b bg-white px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
        <Link
          href="/compte"
          aria-label={t("back")}
          className="bg-surface-2 grid size-9 place-items-center rounded-full transition-transform active:scale-90"
        >
          <ChevronLeft className="size-[18px] rtl:-scale-x-100" />
        </Link>
        <h1 className="text-[19px] font-black tracking-tight">
          {t("delPageTitle")}
        </h1>
      </header>

      <main className="mx-auto max-w-2xl">
        <DeleteAccountScreen
          blocked={blocked}
          cashbackDa={cashbackDa}
          topupDa={topupDa}
        />
      </main>
    </div>
  );
}
