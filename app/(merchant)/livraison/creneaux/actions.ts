"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMerchant } from "@/lib/auth/merchant";

export type ScheduleActionState = { error?: string; ok?: boolean };

const rangeSchema = z
  .object({
    weekday: z.coerce.number().int().min(0).max(6),
    start_time: z.string().regex(/^\d{2}:\d{2}/),
    end_time: z.string().regex(/^\d{2}:\d{2}/),
    max_orders: z.coerce.number().int().min(1).max(500),
  })
  .refine((r) => r.start_time < r.end_time, {
    message: "L'heure de début doit être avant l'heure de fin.",
  });

const payloadSchema = z.object({
  rows: z.array(rangeSchema).max(70),
});

/**
 * Remplace l'INTÉGRALITÉ du planning hebdomadaire de tournée du commerçant
 * (delete + insert), puis re-matérialise les créneaux datés à venir.
 */
export async function setTourSchedule(
  rowsJson: string
): Promise<ScheduleActionState> {
  let parsedInput: unknown;
  try {
    parsedInput = { rows: JSON.parse(rowsJson) };
  } catch {
    return { error: "Données invalides." };
  }
  const parsed = payloadSchema.safeParse(parsedInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  // Refuse les chevauchements au sein d'un même jour.
  const byDay = new Map<number, { start_time: string; end_time: string }[]>();
  for (const r of parsed.data.rows) {
    const list = byDay.get(r.weekday) ?? [];
    for (const e of list) {
      if (r.start_time < e.end_time && e.start_time < r.end_time) {
        return {
          error: "Deux plages se chevauchent sur le même jour.",
        };
      }
    }
    list.push({ start_time: r.start_time, end_time: r.end_time });
    byDay.set(r.weekday, list);
  }

  const ctx = await requireMerchant();
  if ("error" in ctx) return ctx;

  const supabase = await createClient();

  const { error: delErr } = await supabase
    .from("merchant_tour_schedule")
    .delete()
    .eq("merchant_id", ctx.id);
  if (delErr) return { error: delErr.message };

  if (parsed.data.rows.length > 0) {
    const { error: insErr } = await supabase
      .from("merchant_tour_schedule")
      .insert(
        parsed.data.rows.map((r) => ({
          merchant_id: ctx.id,
          weekday: r.weekday,
          start_time: r.start_time,
          end_time: r.end_time,
          max_orders: r.max_orders,
        }))
      );
    if (insErr) return { error: insErr.message };
  }

  // Re-synchronise les créneaux datés (création/maj capacité/nettoyage).
  await supabase.rpc("ensure_tour_slots", { p_merchant_id: ctx.id });

  revalidatePath("/livraison/creneaux");
  return { ok: true };
}
