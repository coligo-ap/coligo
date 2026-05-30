import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Bolt, ChevronRight } from "lucide-react";
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
        <div className="space-y-4">
          <Link
            href="/driver"
            className="inline-flex items-center gap-1 text-sm font-medium text-[#757575]"
          >
            <ArrowLeft className="size-4" /> Accueil
          </Link>
          <div className="rounded-[14px] border border-[#f5e0a1] bg-[#fff8e5] p-4 text-sm font-medium text-[#8b6500]">
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
          "id, order_number, customer_name, customer_phone, total_da, delivery_fee_da, payment_method, delivery_address_text, delivery_phone, delivery_lat, delivery_lng, delivery_note, delivery_picked_up_at, delivery_arrived_at, status, delivery_mode"
        )
        .eq("id", avail.current_order_id)
        .maybeSingle()
    : { data: null };

  // Nombre d'articles (pour le chip de l'offre) — lecture autorisée par la
  // policy RLS 0057 sur les commandes attribuées au livreur.
  const { count: itemCount } = currentOrder
    ? await supabase
        .from("order_items")
        .select("id", { count: "exact", head: true })
        .eq("order_id", currentOrder.id)
    : { count: 0 };

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="space-y-5">
        <Link
          href="/driver"
          className="inline-flex items-center gap-1 text-sm font-medium text-[#757575]"
        >
          <ArrowLeft className="size-4" />
          Accueil
        </Link>
        <header className="space-y-0.5">
          <p className="text-xs font-bold tracking-wide text-[#757575] uppercase">
            Commerçant actif
          </p>
          <h1 className="text-[22px] font-extrabold tracking-tight text-[#0a0a0a]">
            {merchant.name}
          </h1>
        </header>

        {merchant.express_enabled && (
          <ExpressCard
            merchantDriverId={link.id}
            availStatus={avail?.status ?? "offline"}
            currentOrder={currentOrder ?? null}
            itemCount={itemCount ?? 0}
            merchantName={merchant.name}
            merchantLat={merchant.latitude}
            merchantLng={merchant.longitude}
          />
        )}

        {merchant.tours_enabled && (
          <Link
            href={`/driver/m/${link.id}/tours`}
            className="flex items-center gap-3 rounded-[14px] bg-white p-4 shadow-[0_4px_16px_rgba(0,0,0,.06)] active:scale-[0.99]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f5f5f5] text-lg">
              📅
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#0a0a0a]">Tournée</p>
              <p className="text-xs font-medium text-[#757575]">
                Choisis un créneau et fais ta tournée.
              </p>
            </div>
            <ChevronRight className="size-[18px] text-[#9e9e9e]" />
          </Link>
        )}

        {!merchant.express_enabled && !merchant.tours_enabled && (
          <p className="text-sm font-medium text-[#757575]">
            Le commerçant n&apos;a activé aucun mode de livraison.
          </p>
        )}

        {!merchant.express_enabled && (
          <p className="text-xs font-medium text-[#9e9e9e]">
            <Bolt className="mr-1 inline size-3" /> Le commerçant n&apos;a pas
            activé Express.
          </p>
        )}
      </div>
    </DriverShell>
  );
}
