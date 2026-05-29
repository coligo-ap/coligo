import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Bolt, Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { ExpressCard } from "@/components/driver/express-card";

export const dynamic = "force-dynamic";

export default async function DriverMerchantSpacePage({
  params,
}: {
  params: Promise<{ mdId: string }>;
}) {
  const { mdId } = await params;
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  const { data: link } = await supabase
    .from("merchant_drivers")
    .select(
      "id, status, sessions_revoked_at, merchants ( id, name, express_enabled, tours_enabled, latitude, longitude )"
    )
    .eq("id", mdId)
    .eq("driver_id", driver.id)
    .maybeSingle();

  if (!link) notFound();
  const merchant = Array.isArray(link.merchants)
    ? link.merchants[0]
    : link.merchants;
  if (!merchant) notFound();

  if (link.status !== "active") {
    return (
      <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
        <div className="space-y-4 pt-6">
          <Link
            href="/driver"
            className="text-muted inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-4" /> Retour
          </Link>
          <div className="border-warning-200 bg-warning-50 text-warning-700 rounded-[14px] border p-4 text-sm">
            {link.status === "pending"
              ? `Demande en attente chez ${merchant.name}.`
              : `Accès retiré chez ${merchant.name}.`}
          </div>
        </div>
      </DriverShell>
    );
  }

  const { data: avail } = await supabase
    .from("driver_availability")
    .select("status, current_order_id")
    .eq("merchant_driver_id", link.id)
    .maybeSingle();

  // Commande en cours pour ce livreur chez ce commerçant
  const { data: currentOrder } = avail?.current_order_id
    ? await supabase
        .from("orders")
        .select(
          "id, customer_name, customer_phone, total_da, payment_method, delivery_address_text, delivery_phone, delivery_lat, delivery_lng, delivery_note, delivery_picked_up_at, delivery_arrived_at, status, delivery_mode"
        )
        .eq("id", avail.current_order_id)
        .maybeSingle()
    : { data: null };

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="space-y-5">
        <Link
          href="/driver"
          className="text-muted inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          Mes commerçants
        </Link>
        <header className="space-y-0.5">
          <p className="text-muted text-xs font-medium tracking-wide uppercase">
            Commerçant actif
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{merchant.name}</h1>
        </header>

        {merchant.express_enabled && (
          <ExpressCard
            merchantDriverId={link.id}
            availStatus={avail?.status ?? "offline"}
            currentOrder={currentOrder ?? null}
            merchantName={merchant.name}
            merchantLat={merchant.latitude}
            merchantLng={merchant.longitude}
          />
        )}

        {merchant.tours_enabled && (
          <Link
            href={`/driver/m/${link.id}/tours`}
            className="border-border bg-surface flex items-center gap-3 rounded-[14px] border p-4"
          >
            <Calendar className="text-success-600 size-5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Tournée</p>
              <p className="text-muted text-xs">
                Choisis un créneau et fais ta tournée.
              </p>
            </div>
          </Link>
        )}

        {!merchant.express_enabled && !merchant.tours_enabled && (
          <p className="text-muted text-sm">
            Le commerçant n&apos;a activé aucun mode de livraison.
          </p>
        )}

        {!merchant.express_enabled && (
          <p className="text-subtle text-xs">
            <Bolt className="mr-1 inline size-3" /> Le commerçant n&apos;a pas
            activé Express.
          </p>
        )}
      </div>
    </DriverShell>
  );
}
