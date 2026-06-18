"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMerchant } from "@/lib/auth/merchant";

export type SlotActionState = { error?: string; ok?: boolean };

const slotSchema = z.object({
  slot_date: z.string().min(10),
  start_time: z.string().regex(/^\d{2}:\d{2}/),
  end_time: z.string().regex(/^\d{2}:\d{2}/),
  max_orders: z.coerce.number().int().min(1).max(500),
});

export async function createSlot(
  _prev: SlotActionState,
  formData: FormData
): Promise<SlotActionState> {
  const parsed = slotSchema.safeParse({
    slot_date: formData.get("slot_date"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    max_orders: formData.get("max_orders"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  if (parsed.data.start_time >= parsed.data.end_time) {
    return { error: "L'heure de début doit être avant l'heure de fin." };
  }

  const ctx = await requireMerchant();
  if ("error" in ctx) return ctx;

  const supabase = await createClient();
  const { error } = await supabase.from("delivery_slots").insert({
    merchant_id: ctx.id,
    slot_date: parsed.data.slot_date,
    start_time: parsed.data.start_time,
    end_time: parsed.data.end_time,
    max_orders: parsed.data.max_orders,
  });
  if (error) return { error: error.message };

  revalidatePath("/livraison/creneaux");
  return { ok: true };
}

export async function setSlotStatus(
  id: string,
  status: "open" | "closed" | "cancelled"
): Promise<SlotActionState> {
  const ctx = await requireMerchant();
  if ("error" in ctx) return ctx;
  const supabase = await createClient();
  const { error } = await supabase
    .from("delivery_slots")
    .update({ status })
    .eq("id", id)
    .eq("merchant_id", ctx.id);
  if (error) return { error: error.message };
  revalidatePath("/livraison/creneaux");
  return { ok: true };
}

export async function deleteSlot(id: string): Promise<SlotActionState> {
  const ctx = await requireMerchant();
  if ("error" in ctx) return ctx;
  const supabase = await createClient();
  // Garde-fou : refuser la suppression si des commandes y sont attachées.
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("delivery_slot_id", id);
  if ((count ?? 0) > 0) {
    return {
      error:
        "Des commandes sont rattachées à ce créneau — passe-le en `annulé` plutôt.",
    };
  }
  const { error } = await supabase
    .from("delivery_slots")
    .delete()
    .eq("id", id)
    .eq("merchant_id", ctx.id);
  if (error) return { error: error.message };
  revalidatePath("/livraison/creneaux");
  return { ok: true };
}
