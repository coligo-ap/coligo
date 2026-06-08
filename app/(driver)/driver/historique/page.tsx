import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { DeliveryHistory } from "@/components/driver/delivery-history";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  customer_name: string | null;
  total_da: number | null;
  delivery_fee_da: number | null;
  payment_method: "cash" | "online";
  delivery_mode: "express" | "tour" | null;
  status: string;
  delivery_address_text: string | null;
  delivery_delivered_at: string | null;
  delivery_picked_up_at: string | null;
  created_at: string;
  merchant_id: string;
  validated_without_code: boolean;
};

export default async function DriverHistoryPage() {
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  const supabase = await createClient();

  // Toutes les commandes attribuées au livreur (RLS 0044 garantit qu'il
  // ne voit que les siennes).
  const { data: orders } = await supabase
    .from("orders")
    .select(
      `id, customer_name, total_da, delivery_fee_da, payment_method,
       delivery_mode, status, delivery_address_text, delivery_delivered_at,
       delivery_picked_up_at, created_at, merchant_id, validated_without_code`
    )
    .eq("delivery_driver_id", driver.id)
    .order("created_at", { ascending: false })
    .limit(500);

  // Confidentialité client : une fois la commande LIVRÉE (ou terminée /
  // annulée), le livreur ne doit plus voir les infos personnelles du client.
  // On masque le nom AVANT envoi au navigateur (le composant retombe sur
  // « Client »). Restent visibles : n° commande, commerçant, date/heure,
  // montants, adresse — tout ce qui est utile sans être personnel.
  const rows = ((orders ?? []) as OrderRow[]).map((r) => {
    const done =
      r.status === "completed" ||
      r.status === "cancelled" ||
      r.delivery_delivered_at != null;
    return done ? { ...r, customer_name: null } : r;
  });
  const merchantIds = Array.from(new Set(rows.map((r) => r.merchant_id)));

  // Lookup nom du commerçant (pour affichage + filtre).
  const { data: merchants } = merchantIds.length
    ? await supabase
        .from("merchants_public")
        .select("id, name")
        .in("id", merchantIds)
    : { data: [] };
  const merchantMap = new Map<string, string>(
    (merchants ?? []).map((m) => [m.id, m.name])
  );

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="space-y-4">
        <Link
          href="/driver"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#757575]"
        >
          <ArrowLeft className="size-4" />
          Accueil
        </Link>
        <h1 className="text-[18px] font-bold tracking-tight text-[#0a0a0a]">
          Historique
        </h1>
        <DeliveryHistory
          rows={rows}
          merchants={Array.from(merchantMap.entries()).map(([id, name]) => ({
            id,
            name,
          }))}
        />
      </div>
    </DriverShell>
  );
}
