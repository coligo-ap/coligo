import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { TourSlotsList } from "@/components/driver/tour-slots-list";

export const dynamic = "force-dynamic";

export default async function DriverToursPage({
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
    .select("id, merchant_id, status, merchants ( id, name )")
    .eq("id", mdId)
    .eq("driver_id", driver.id)
    .maybeSingle();
  if (!link) notFound();
  const merchant = Array.isArray(link.merchants)
    ? link.merchants[0]
    : link.merchants;

  // Tournées en cours de CE livreur chez CE commerçant (toujours récupérées,
  // même si le lien n'est plus actif — pour pouvoir TERMINER une tournée déjà
  // démarrée si le commerçant a régénéré le code / coupé l'accès entre-temps).
  const { data: myTours } = await supabase
    .from("delivery_tours")
    .select("id, slot_id, status")
    .eq("driver_id", driver.id)
    .eq("merchant_id", link.merchant_id)
    .in("status", ["planned", "in_progress"]);

  // Lien non actif : on ne propose PLUS de nouveaux créneaux, mais on laisse
  // finir une tournée déjà en cours (le RPC validate_delivery l'autorise déjà —
  // ici on évite juste un cul-de-sac UI).
  if (link.status !== "active") {
    const ongoing = myTours?.[0];
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
              ? `Ton accès chez ${merchant?.name} est en attente de validation.`
              : `Ton accès chez ${merchant?.name} a été retiré.`}
            {ongoing
              ? " Tu peux quand même terminer la tournée déjà commencée."
              : " Tu ne peux pas démarrer de nouvelle tournée pour l'instant."}
          </div>
          {ongoing && (
            <Link
              href={`/driver/m/${mdId}/tours/${ongoing.id}`}
              className="flex items-center justify-center rounded-[14px] bg-[#0a0a0a] px-4 py-3 text-sm font-bold text-white active:scale-[0.99]"
            >
              Terminer ma tournée en cours
            </Link>
          )}
        </div>
      </DriverShell>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: slots } = await supabase
    .from("delivery_slots")
    .select("id, slot_date, start_time, end_time, max_orders, status")
    .eq("merchant_id", link.merchant_id)
    .eq("status", "open")
    .gte("slot_date", today)
    .order("slot_date", { ascending: true })
    .order("start_time", { ascending: true });

  // Compte commandes par slot
  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: orders } = slotIds.length
    ? await supabase
        .from("orders")
        .select("delivery_slot_id")
        .in("delivery_slot_id", slotIds)
        .eq("delivery_mode", "tour")
        .neq("status", "cancelled")
        .neq("status", "completed")
    : { data: [] };
  const counts = new Map<string, number>();
  for (const o of orders ?? []) {
    if (o.delivery_slot_id) {
      counts.set(o.delivery_slot_id, (counts.get(o.delivery_slot_id) ?? 0) + 1);
    }
  }

  // `myTours` (tournées en cours de ce livreur chez ce commerçant) est déjà
  // chargé plus haut — réutilisé ici pour relier chaque créneau à sa tournée.

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="space-y-5">
        <Link
          href={`/driver/m/${mdId}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-[#757575]"
        >
          <ArrowLeft className="size-4" /> Retour
        </Link>
        <header>
          <h1 className="text-[18px] font-bold tracking-tight text-[#0a0a0a]">
            Tournées
          </h1>
          <p className="text-xs font-medium text-[#757575]">{merchant?.name}</p>
        </header>

        <TourSlotsList
          merchantDriverId={mdId}
          slots={(slots ?? []).map((s) => ({
            ...s,
            pendingCount: counts.get(s.id) ?? 0,
            myTourId: myTours?.find((t) => t.slot_id === s.id)?.id ?? null,
          }))}
        />
      </div>
    </DriverShell>
  );
}
