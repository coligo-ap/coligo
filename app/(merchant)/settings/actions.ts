"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const SettingsSchema = z.object({
  auto_accept_orders: z.boolean(),
  auto_print: z.enum(["off", "on_receive", "on_accept"]),
  print_copies: z.number().int().min(1).max(3),
  print_width: z.union([z.literal(58), z.literal(80)]),
});

export type SettingsResult = { error?: string; success?: string };

/**
 * Met à jour les réglages d'impression du commerçant connecté.
 * RLS `merchants_update_own` garantit qu'il ne peut modifier que sa boutique.
 */
export async function setPrintSettings(
  input: unknown
): Promise<SettingsResult> {
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Réglages invalides." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  const { error } = await supabase
    .from("merchants")
    .update({
      auto_accept_orders: parsed.data.auto_accept_orders,
      auto_print: parsed.data.auto_print,
      print_copies: parsed.data.print_copies,
      print_width: parsed.data.print_width,
    })
    .eq("user_id", user.id);

  if (error) return { error: `Erreur : ${error.message}` };

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/orders");
  return { success: "Réglages enregistrés." };
}
