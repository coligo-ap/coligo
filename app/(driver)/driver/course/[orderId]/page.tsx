import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { ExpressCard } from "@/components/driver/express-card";

export const dynamic = "force-dynamic";

/**
 * Page de COURSE EXPRESS autonome — SANS commerçant.
 *
 * L'Express n'inscrit plus le livreur chez le commerçant (cf. mig 0100) : la
 * course est attribuée directement sur la commande (`orders.delivery_driver_id`)
 * et le livreur arrive ici par son orderId. On vérifie simplement que la
 * commande lui est bien attribuée (RLS `orders_driver_select_assigned`) et
 * qu'elle est encore active, puis on rejoue le flux éprouvé via `ExpressCard`
 * (offre plein écran qui sonne → course → validation).
 */
export default async function DriverCoursePage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  type MerchantInfo = {
    name: string;
    latitude: number | null;
    longitude: number | null;
  };
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, customer_name, customer_phone, total_da, delivery_fee_da, payment_method, payment_status, delivery_address_text, delivery_phone, delivery_recipient_name, delivery_lat, delivery_lng, delivery_note, delivery_picked_up_at, delivery_arrived_at, status, delivery_mode, delivery_driver_id, delivery_delivered_at, merchants ( name, latitude, longitude )"
    )
    .eq("id", orderId)
    .maybeSingle();

  // Commande inexistante / non attribuée à ce livreur → retour accueil.
  if (!order || order.delivery_driver_id !== driver.id) redirect("/driver");

  // Course terminée (livrée / annulée) → plus rien à faire ici.
  if (
    order.status === "completed" ||
    order.status === "cancelled" ||
    order.delivery_delivered_at
  ) {
    redirect("/driver");
  }

  // Cette page ne gère que l'Express (la Tournée a son propre flux).
  if (order.delivery_mode !== "express") redirect("/driver");

  const merchant = (
    Array.isArray(order.merchants) ? order.merchants[0] : order.merchants
  ) as MerchantInfo | null;

  const { count: itemCount } = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);

  // Config de la part Coligo livraison (driver_fee) — figée en base, jamais en
  // dur. Sert à afficher dans l'offre le GAIN NET (D − driver_fee) du livreur.
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("driver_fee_rate, driver_fee_cap_rate, driver_fee_min_da")
    .eq("id", true)
    .single();
  const driverFeeConfig = {
    driverFeeRate: Number(settings?.driver_fee_rate ?? 0.08),
    driverFeeCapRate: Number(settings?.driver_fee_cap_rate ?? 0.1),
    driverFeeMinDa: Number(settings?.driver_fee_min_da ?? 10),
  };

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <ExpressCard
        currentOrder={
          order as Parameters<typeof ExpressCard>[0]["currentOrder"]
        }
        itemCount={itemCount ?? 0}
        merchantName={merchant?.name ?? "Commerçant"}
        merchantLat={merchant?.latitude}
        merchantLng={merchant?.longitude}
        driverFeeConfig={driverFeeConfig}
      />
    </DriverShell>
  );
}
