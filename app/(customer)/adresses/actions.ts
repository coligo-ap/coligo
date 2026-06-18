"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCustomer } from "@/lib/auth/customer";

export type AddressActionState = { error?: string; ok?: boolean };

const addressSchema = z.object({
  label: z.string().min(1).max(60),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  address_text: z.string().max(200).optional().or(z.literal("")),
  phone_override: z.string().max(40).optional().or(z.literal("")),
  is_default: z.string().optional(),
});

export async function addAddress(
  _prev: AddressActionState,
  formData: FormData
): Promise<AddressActionState> {
  const parsed = addressSchema.safeParse({
    label: formData.get("label"),
    lat: formData.get("lat"),
    lng: formData.get("lng"),
    address_text: formData.get("address_text"),
    phone_override: formData.get("phone_override"),
    is_default: formData.get("is_default"),
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };

  const c = await requireCustomer();
  if ("error" in c) return c;

  const supabase = await createClient();
  const isDefault = parsed.data.is_default === "on";

  if (isDefault) {
    // Démarque l'éventuel default existant.
    await supabase
      .from("customer_addresses")
      .update({ is_default: false })
      .eq("customer_id", c.id);
  }

  const { error } = await supabase.from("customer_addresses").insert({
    customer_id: c.id,
    label: parsed.data.label,
    lat: parsed.data.lat,
    lng: parsed.data.lng,
    address_text: parsed.data.address_text || null,
    phone_override: parsed.data.phone_override || null,
    is_default: isDefault,
  });

  if (error) return { error: error.message };
  revalidatePath("/adresses");
  revalidatePath("/checkout");
  return { ok: true };
}

/**
 * Enregistre une adresse depuis le checkout (appel JSON direct, pas un form).
 * La position vient de la carte plein écran + recherche. Best-effort.
 */
export async function saveCustomerAddress(input: {
  label: string;
  lat: number;
  lng: number;
  address_text?: string | null;
}): Promise<AddressActionState> {
  const label = (input.label ?? "").trim();
  if (!label) return { error: "Donne un nom à l'adresse." };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return { error: "Position invalide." };
  }
  const c = await requireCustomer();
  if ("error" in c) return c;
  const supabase = await createClient();
  const { error } = await supabase.from("customer_addresses").insert({
    customer_id: c.id,
    label: label.slice(0, 60),
    lat: input.lat,
    lng: input.lng,
    address_text: (input.address_text ?? "").slice(0, 200) || null,
    is_default: false,
  });
  if (error) return { error: error.message };
  revalidatePath("/adresses");
  revalidatePath("/checkout");
  return { ok: true };
}

export async function setDefaultAddress(
  id: string
): Promise<AddressActionState> {
  const c = await requireCustomer();
  if ("error" in c) return c;
  const supabase = await createClient();
  await supabase
    .from("customer_addresses")
    .update({ is_default: false })
    .eq("customer_id", c.id);
  const { error } = await supabase
    .from("customer_addresses")
    .update({ is_default: true })
    .eq("customer_id", c.id)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/adresses");
  revalidatePath("/checkout");
  return { ok: true };
}

export async function deleteAddress(id: string): Promise<AddressActionState> {
  const c = await requireCustomer();
  if ("error" in c) return c;
  const supabase = await createClient();
  const { error } = await supabase
    .from("customer_addresses")
    .delete()
    .eq("customer_id", c.id)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/adresses");
  return { ok: true };
}
