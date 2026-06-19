import { redirect } from "next/navigation";
import { Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { algiersDateAndTime, isSlotExpired } from "@/lib/delivery/slots";
import { SlotsManager } from "@/components/merchant/livraison/slots-manager";

export const dynamic = "force-dynamic";

export default async function MerchantSlotsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id, tours_enabled, delivery_enabled")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!merchant) redirect("/login?error=no_merchant");

  const algiersNow = algiersDateAndTime();
  const { data: slotsRaw } = await supabase
    .from("delivery_slots")
    .select("id, slot_date, start_time, end_time, max_orders, status")
    .eq("merchant_id", merchant.id)
    .gte("slot_date", algiersNow.date)
    .order("slot_date", { ascending: true })
    .order("start_time", { ascending: true });

  // Masque les créneaux déjà écoulés aujourd'hui (heure de fin dépassée) — le
  // filtre SQL ne porte que sur la date.
  const slots = (slotsRaw ?? []).filter((s) => !isSlotExpired(s, algiersNow));

  // Compte des commandes par créneau (pour affichage X/Y).
  const slotIds = (slots ?? []).map((s) => s.id);
  const { data: ordersInSlots } = slotIds.length
    ? await supabase
        .from("orders")
        .select("delivery_slot_id, status")
        .in("delivery_slot_id", slotIds)
        .neq("status", "cancelled")
    : { data: [] };

  const counts = new Map<string, number>();
  for (const o of ordersInSlots ?? []) {
    if (o.delivery_slot_id) {
      counts.set(o.delivery_slot_id, (counts.get(o.delivery_slot_id) ?? 0) + 1);
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <header className="mb-5 flex items-center gap-2">
        <Calendar className="size-6" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Créneaux de tournée
          </h1>
          <p className="text-muted mt-1 text-sm">
            Définis les horaires de sortie de tes tournées.
          </p>
        </div>
      </header>

      {!merchant.tours_enabled && (
        <div className="border-warning-200 bg-warning-50 text-warning-700 mb-4 rounded-[12px] border px-4 py-3 text-sm">
          Active d&apos;abord le mode Tournée dans{" "}
          <a className="underline" href="/settings">
            Paramètres
          </a>
          .
        </div>
      )}

      <SlotsManager
        slots={(slots ?? []).map((s) => ({
          ...s,
          used: counts.get(s.id) ?? 0,
        }))}
      />
    </div>
  );
}
