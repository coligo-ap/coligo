"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  orderRulesSchema,
  parseOpeningHoursFromForm,
  passwordSchema,
  profileSchema,
} from "@/lib/validation/merchant-settings";
import { merchantDeliverySchema } from "@/lib/validation/delivery";
import { MIN_ORDER_CASH_DA } from "@/lib/config/payment-limits";

const SettingsSchema = z.object({
  auto_accept_orders: z.boolean(),
  auto_print: z.enum(["off", "on_receive", "on_accept"]),
  print_copies: z.number().int().min(1).max(3),
  print_width: z.union([z.literal(50), z.literal(58), z.literal(80)]),
});

export type SettingsResult = { error?: string; success?: string; ok?: boolean };
export type SettingsFormState = SettingsResult;

async function requireMerchant(): Promise<
  { id: string; name: string; slug: string } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };
  const { data: m } = await supabase
    .from("merchants")
    .select("id, name, slug")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!m) return { error: "Boutique introuvable." };
  return m;
}

/**
 * Réglages d'impression (legacy : appelée depuis order-realtime-bridge en JSON).
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

// =============================================================================
// PROFIL — nom, description, adresse, téléphone (slug recalculé si nom change)
// =============================================================================
export async function updateProfile(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    wilaya_code: formData.get("wilaya_code"),
    commune: formData.get("commune"),
    address: formData.get("address"),
    description_fr: formData.get("description_fr"),
    description_ar: formData.get("description_ar"),
    phone_public: formData.get("phone_public"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const merchant = await requireMerchant();
  if ("error" in merchant) return { error: merchant.error };

  const supabase = await createClient();

  // Si le nom change, on régénère un slug unique côté DB (fonction SQL).
  let slug = merchant.slug;
  if (parsed.data.name !== merchant.name) {
    const { data: newSlug, error: slugErr } = await supabase.rpc(
      "merchant_unique_slug",
      { p_base: parsed.data.name, p_self_id: merchant.id }
    );
    if (slugErr) return { error: `Slug : ${slugErr.message}` };
    if (typeof newSlug === "string" && newSlug.length > 0) slug = newSlug;
  }

  const { error } = await supabase
    .from("merchants")
    .update({
      name: parsed.data.name,
      slug,
      category: parsed.data.category,
      wilaya_code: parsed.data.wilaya_code,
      commune: parsed.data.commune,
      address: parsed.data.address,
      description_fr: parsed.data.description_fr,
      description_ar: parsed.data.description_ar,
      phone_public: parsed.data.phone_public,
    })
    .eq("id", merchant.id);

  if (error) return { error: `Erreur : ${error.message}` };

  revalidatePath("/settings");
  revalidatePath("/dashboard", "layout");
  return { ok: true, success: "Profil enregistré." };
}

// =============================================================================
// HORAIRES D'OUVERTURE
// =============================================================================
export async function updateOpeningHours(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  let hours;
  try {
    hours = parseOpeningHoursFromForm(formData.get("hours"));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Horaires invalides" };
  }

  const merchant = await requireMerchant();
  if ("error" in merchant) return { error: merchant.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchants")
    .update({ opening_hours: hours })
    .eq("id", merchant.id);

  if (error) return { error: `Erreur : ${error.message}` };

  revalidatePath("/settings");
  return { ok: true, success: "Horaires enregistrés." };
}

// =============================================================================
// RÈGLES DE COMMANDE
// =============================================================================
export async function updateOrderRules(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const parsed = orderRulesSchema.safeParse({
    min_order_da: formData.get("min_order_da"),
    prep_time_min: formData.get("prep_time_min"),
    accepts_cash: formData.get("accepts_cash") ?? false,
    accepts_online: formData.get("accepts_online") ?? false,
    pickup_slot_minutes: formData.get("pickup_slot_minutes"),
    max_orders_per_slot: formData.get("max_orders_per_slot"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  if (!parsed.data.accepts_cash && !parsed.data.accepts_online) {
    return { error: "Au moins un mode de paiement doit être accepté." };
  }

  // Plancher absolu Coligo : un commerçant peut monter son min_order mais
  // jamais descendre sous le seuil plateforme (rentabilité Chargily + ops).
  if (parsed.data.min_order_da < MIN_ORDER_CASH_DA) {
    return {
      error: `Le minimum de commande ne peut pas être inférieur à ${MIN_ORDER_CASH_DA} DA.`,
    };
  }

  const merchant = await requireMerchant();
  if ("error" in merchant) return { error: merchant.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchants")
    .update({
      min_order_da: parsed.data.min_order_da,
      prep_time_min: parsed.data.prep_time_min,
      accepts_cash: parsed.data.accepts_cash,
      accepts_online: parsed.data.accepts_online,
      pickup_slot_minutes: parsed.data.pickup_slot_minutes,
      max_orders_per_slot: parsed.data.max_orders_per_slot,
    })
    .eq("id", merchant.id);

  if (error) return { error: `Erreur : ${error.message}` };

  revalidatePath("/settings");
  return { ok: true, success: "Règles enregistrées." };
}

// =============================================================================
// LOGO / COVER — appelée depuis le composant MediaUpload après un upload réussi
// =============================================================================
export async function setMediaUrl(
  field: "logo_url" | "cover_url",
  url: string | null
): Promise<SettingsResult> {
  const merchant = await requireMerchant();
  if ("error" in merchant) return { error: merchant.error };

  const supabase = await createClient();
  const patch = field === "logo_url" ? { logo_url: url } : { cover_url: url };
  const { error } = await supabase
    .from("merchants")
    .update(patch)
    .eq("id", merchant.id);
  if (error) return { error: `Erreur : ${error.message}` };

  revalidatePath("/settings");
  return { ok: true };
}

// =============================================================================
// LIVRAISON — activation des modes + rayon (le barème reste plateforme)
// =============================================================================
export async function setDeliverySettings(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const parsed = merchantDeliverySchema.safeParse({
    delivery_enabled: formData.get("delivery_enabled") === "on",
    express_enabled: formData.get("express_enabled") === "on",
    tours_enabled: formData.get("tours_enabled") === "on",
    delivery_radius_km: formData.get("delivery_radius_km") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  // Position commerçant — obligatoire si livraison activée.
  const latRaw = formData.get("latitude");
  const lngRaw = formData.get("longitude");
  const latitude =
    typeof latRaw === "string" && latRaw.length > 0 ? Number(latRaw) : null;
  const longitude =
    typeof lngRaw === "string" && lngRaw.length > 0 ? Number(lngRaw) : null;
  if (parsed.data.delivery_enabled && (latitude == null || longitude == null)) {
    return {
      error:
        "Position de la boutique requise : pointe ta vitrine sur la carte pour activer la livraison.",
    };
  }
  if (
    latitude != null &&
    (latitude < -90 || latitude > 90 || isNaN(latitude))
  ) {
    return { error: "Latitude invalide." };
  }
  if (
    longitude != null &&
    (longitude < -180 || longitude > 180 || isNaN(longitude))
  ) {
    return { error: "Longitude invalide." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  // Borne le rayon par le max plateforme — on ne fait pas confiance au form.
  const { data: ps } = await supabase
    .from("platform_settings")
    .select("delivery_max_radius_km")
    .eq("id", true)
    .maybeSingle();
  const maxRadius = (ps?.delivery_max_radius_km as number | undefined) ?? 10;
  const radius =
    parsed.data.delivery_radius_km == null
      ? null
      : Math.min(parsed.data.delivery_radius_km, maxRadius);

  // On met à jour lat/lng UNIQUEMENT si fournies (pour ne pas effacer en
  // mode "désactiver la livraison").
  const update: {
    delivery_enabled: boolean;
    express_enabled: boolean;
    tours_enabled: boolean;
    delivery_radius_km: number | null;
    latitude?: number;
    longitude?: number;
  } = {
    delivery_enabled: parsed.data.delivery_enabled,
    express_enabled: parsed.data.express_enabled,
    tours_enabled: parsed.data.tours_enabled,
    delivery_radius_km: radius,
  };
  if (latitude != null) update.latitude = latitude;
  if (longitude != null) update.longitude = longitude;

  const { error } = await supabase
    .from("merchants")
    .update(update)
    .eq("user_id", user.id);

  if (error) return { error: `Erreur : ${error.message}` };

  revalidatePath("/settings");
  return { ok: true, success: "Livraison mise à jour." };
}

// =============================================================================
// MOT DE PASSE
// =============================================================================
export async function changePassword(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { error: `Erreur : ${error.message}` };

  return { ok: true, success: "Mot de passe mis à jour." };
}
