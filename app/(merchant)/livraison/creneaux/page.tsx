import { redirect } from "next/navigation";
import { Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { algiersDateAndTime, isSlotExpired } from "@/lib/delivery/slots";
import {
  TourScheduleEditor,
  type ScheduleRange,
} from "@/components/merchant/livraison/tour-schedule-editor";

export const dynamic = "force-dynamic";

export default async function MerchantSlotsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id, tours_enabled, delivery_enabled, max_days_ahead")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!merchant) redirect("/login?error=no_merchant");

  // Re-synchronise les créneaux datés depuis le planning (création/nettoyage)
  // avant d'afficher l'aperçu des prochaines sorties.
  await supabase.rpc("ensure_tour_slots", { p_merchant_id: merchant.id });

  const algiersNow = algiersDateAndTime();
  const [scheduleRes, slotsRes] = await Promise.all([
    supabase
      .from("merchant_tour_schedule")
      .select("weekday, start_time, end_time, max_orders")
      .eq("merchant_id", merchant.id),
    supabase
      .from("delivery_slots")
      .select("id, slot_date, start_time, end_time, max_orders, status")
      .eq("merchant_id", merchant.id)
      .eq("status", "open")
      .gte("slot_date", algiersNow.date)
      .order("slot_date", { ascending: true })
      .order("start_time", { ascending: true }),
  ]);

  const schedule = (scheduleRes.data ?? []) as ScheduleRange[];

  const upcoming = (slotsRes.data ?? []).filter(
    (s) => !isSlotExpired(s, algiersNow)
  );
  const slotIds = upcoming.map((s) => s.id);
  const { data: ordersInSlots } = slotIds.length
    ? await supabase
        .from("orders")
        .select("delivery_slot_id")
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
            Planning de tournée
          </h1>
          <p className="text-muted mt-1 text-sm">
            Définis tes sorties par jour de la semaine. Les clients peuvent
            réserver jusqu&apos;à {merchant.max_days_ahead ?? 7} jour
            {(merchant.max_days_ahead ?? 7) > 1 ? "s" : ""} à l&apos;avance.
          </p>
        </div>
      </header>

      {!merchant.tours_enabled && (
        <div className="border-warning-200 bg-warning-50 text-warning-700 mb-4 rounded-md border px-4 py-3 text-sm">
          Active d&apos;abord le mode Tournée dans{" "}
          <a className="underline" href="/settings">
            Paramètres
          </a>
          .
        </div>
      )}

      <TourScheduleEditor
        initial={schedule}
        disabled={!merchant.tours_enabled}
      />

      {/* Aperçu des prochaines sorties générées (lecture seule). */}
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">
          Prochaines sorties générées
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-muted text-sm">
            Aucune sortie à venir — ajoute des plages dans le planning
            ci-dessus.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {upcoming.map((s) => {
              const used = counts.get(s.id) ?? 0;
              const full = used >= s.max_orders;
              return (
                <li
                  key={s.id}
                  className={
                    "rounded-control flex items-center justify-between border px-3 py-2 text-sm " +
                    (full
                      ? "border-warning-200 bg-warning-50"
                      : "border-border bg-surface")
                  }
                >
                  <span className="font-medium tabular-nums">
                    {new Date(s.slot_date).toLocaleDateString("fr-FR", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                    })}{" "}
                    · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                  </span>
                  <span className="text-muted text-xs tabular-nums">
                    {used}/{s.max_orders} commandes
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
