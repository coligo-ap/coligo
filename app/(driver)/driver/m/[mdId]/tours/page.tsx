import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
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
  if (!link || link.status !== "active") notFound();
  const merchant = Array.isArray(link.merchants)
    ? link.merchants[0]
    : link.merchants;

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

  // Tournées DÉJÀ démarrées par ce livreur
  const { data: myTours } = await supabase
    .from("delivery_tours")
    .select("id, slot_id, status")
    .eq("driver_id", driver.id)
    .in("status", ["planned", "in_progress"]);

  return (
    <div className="space-y-5">
      <Link
        href={`/driver/m/${mdId}`}
        className="text-muted inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Retour
      </Link>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Tournées</h1>
        <p className="text-muted text-xs">{merchant?.name}</p>
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
  );
}
