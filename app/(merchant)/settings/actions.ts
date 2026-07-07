"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMerchant } from "@/lib/auth/merchant";
import {
  orderRulesSchema,
  parseOpeningHoursFromForm,
  passwordSchema,
  profileSchema,
} from "@/lib/validation/merchant-settings";
import { merchantDeliverySchema } from "@/lib/validation/delivery";
import { MIN_ORDER_CASH_DA } from "@/lib/config/payment-limits";
import { getAllCategories } from "@/lib/data/categories";
import {
  MAX_MERCHANT_TAGS,
  normalizeTagCode,
} from "@/lib/config/merchant-tags";

/** Parse + assainit les tags envoyés par le formulaire (JSON string). */
function parseTags(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v !== "string") continue;
    const code = normalizeTagCode(v);
    if (code && !out.includes(code)) out.push(code);
    if (out.length >= MAX_MERCHANT_TAGS) break;
  }
  return out;
}

const SettingsSchema = z.object({
  auto_accept_orders: z.boolean(),
  auto_print: z.enum(["off", "on_receive", "on_accept"]),
  print_copies: z.number().int().min(1).max(3),
  print_width: z.union([z.literal(50), z.literal(58), z.literal(80)]),
});

export type SettingsResult = { error?: string; success?: string; ok?: boolean };
export type SettingsFormState = SettingsResult;

/**
 * Réglages de VERSEMENT : cadence automatique (none/weekly/monthly) + méthode
 * + coordonnées (CCP/RIB). Si une cadence auto est choisie, méthode + détails
 * sont obligatoires (sinon le cron ne pourrait pas verser). RLS
 * `merchants_update_own` borne à sa propre boutique.
 */
const PayoutSettingsSchema = z
  .object({
    payout_auto: z.enum(["none", "weekly", "monthly"]),
    payout_method: z.enum(["ccp", "baridimob", "bank"]).nullable(),
    payout_details: z.string().trim().max(300).nullable(),
  })
  .refine(
    (v) =>
      v.payout_auto === "none" ||
      (!!v.payout_method && !!v.payout_details && v.payout_details.length > 0),
    {
      message: "Méthode et coordonnées requises pour un versement automatique.",
    }
  );

export async function updatePayoutSettings(
  _prev: SettingsResult,
  formData: FormData
): Promise<SettingsResult> {
  const m = await requireMerchant();
  if ("error" in m) return { error: m.error };

  const rawMethod = (formData.get("payout_method") as string) || "";
  const rawDetails = ((formData.get("payout_details") as string) || "").trim();
  const parsed = PayoutSettingsSchema.safeParse({
    payout_auto: formData.get("payout_auto"),
    payout_method: rawMethod || null,
    payout_details: rawDetails || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchants")
    .update({
      payout_auto: parsed.data.payout_auto,
      payout_method: parsed.data.payout_method,
      payout_details: parsed.data.payout_details,
    })
    .eq("id", m.id);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/finances");
  return { ok: true, success: "Réglages de versement enregistrés." };
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
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    description_fr: formData.get("description_fr"),
    description_ar: formData.get("description_ar"),
    phone_public: formData.get("phone_public"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const merchant = await requireMerchant();
  if ("error" in merchant) return { error: merchant.error };

  const tags = parseTags(formData.get("tags"));

  const supabase = await createClient();

  // PHASE 2 multi-catégories : liste depuis le champ `categories` (JSON, la
  // 1re = principale). Chaque NOUVEAU code doit être ACTIF (mig 0311) ; les
  // codes déjà portés par le commerçant restent conservables. Écriture des
  // liaisons sous RLS owner (mig 0312), FK = codes existants uniquement.
  let catList: string[] = [];
  try {
    const raw = formData.get("categories");
    if (typeof raw === "string" && raw) {
      catList = (JSON.parse(raw) as unknown[])
        .filter((x): x is string => typeof x === "string")
        .slice(0, 8);
    }
  } catch {
    /* champ absent/malformé → repli catégorie simple */
  }
  if (catList.length === 0 && parsed.data.category)
    catList = [parsed.data.category];
  catList = [...new Set(catList)];

  const [{ data: cur }, { data: curLinksRaw }, allCats] = await Promise.all([
    supabase
      .from("merchants")
      .select("category")
      .eq("id", merchant.id)
      .maybeSingle(),
    supabase
      .from("merchant_category_links" as never)
      .select("code")
      .eq("merchant_id", merchant.id),
    getAllCategories(),
  ]);
  const owned = new Set([
    ...((curLinksRaw ?? []) as unknown as { code: string }[]).map(
      (r) => r.code
    ),
    ...(cur?.category ? [cur.category] : []),
  ]);
  for (const code of catList) {
    if (owned.has(code)) continue;
    const cat = allCats.find((c) => c.code === code);
    if (!cat || cat.status !== "active" || !cat.showSignup) {
      return { error: "Une des catégories choisies n'est pas disponible." };
    }
  }

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
      // Catégorie PRINCIPALE = 1re de la sélection multiple.
      category: catList[0] ?? parsed.data.category,
      wilaya_code: parsed.data.wilaya_code,
      commune: parsed.data.commune,
      address: parsed.data.address,
      // Position exacte : on n'écrase QUE si une position valide est fournie
      // (évite d'effacer la position existante sur une sauvegarde partielle).
      ...(parsed.data.latitude != null && parsed.data.longitude != null
        ? {
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude,
          }
        : {}),
      description_fr: parsed.data.description_fr,
      description_ar: parsed.data.description_ar,
      phone_public: parsed.data.phone_public,
      tags,
    })
    .eq("id", merchant.id);

  if (error) return { error: `Erreur : ${error.message}` };

  // Synchronise les LIAISONS multi-catégories (RLS owner). La PRINCIPALE est
  // entièrement gérée par le trigger DEFINER (mig 0340 : upsert 'primary' +
  // rétrogradation de l'ancienne) pendant l'update ci-dessus — ici on ne
  // touche QUE les secondaires : retrait des décochées (la policy interdit de
  // toute façon de supprimer une 'primary'), ajout des nouvelles en 'manual'
  // (seule source autorisée à l'insert owner). Best-effort : un échec ici ne
  // perd pas le profil déjà enregistré.
  const primaryCode = catList[0] ?? parsed.data.category;
  if (catList.length > 0) {
    await supabase
      .from("merchant_category_links" as never)
      .delete()
      .eq("merchant_id", merchant.id)
      .not("code", "in", `(${catList.join(",")})`);
    const secondaries = catList.filter((code) => code !== primaryCode);
    if (secondaries.length > 0) {
      await supabase.from("merchant_category_links" as never).upsert(
        secondaries.map((code) => ({
          merchant_id: merchant.id,
          code,
          source: "manual",
        })) as never,
        { onConflict: "merchant_id,code", ignoreDuplicates: true }
      );
    }
  }

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
// AFFICHAGE DU CATALOGUE — liste classique ou cartes catégories d'abord.
// Le client peut ensuite basculer localement sur la boutique (préférence à lui).
// =============================================================================
export async function setCatalogDisplay(
  display: "list" | "categories"
): Promise<SettingsResult> {
  if (display !== "list" && display !== "categories") {
    return { error: "Affichage inconnu." };
  }
  const merchant = await requireMerchant();
  if ("error" in merchant) return { error: merchant.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchants")
    .update({ catalog_display: display })
    .eq("id", merchant.id);
  if (error) return { error: `Erreur : ${error.message}` };

  revalidatePath("/settings");
  return { ok: true };
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

  // Prix de tournée par bande — le trigger serveur (0119) plafonne au barème,
  // on n'a donc pas à valider le plafond ici (défense en profondeur).
  const { data: merchantRow } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchantRow?.id) {
    await supabase.rpc("ensure_merchant_delivery_zones", {
      p_merchant_id: merchantRow.id,
    });
    const { data: zoneRows } = await supabase
      .from("merchant_delivery_zones")
      .select("id, band_index")
      .eq("merchant_id", merchantRow.id);
    for (const z of zoneRows ?? []) {
      const raw = formData.get(`zone_price_${z.band_index}`);
      if (raw == null || raw === "") continue;
      const price = Math.max(0, Math.floor(Number(raw)));
      if (!Number.isFinite(price)) continue;
      await supabase
        .from("merchant_delivery_zones")
        .update({ price_da: price })
        .eq("id", z.id);
    }
  }

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

// =============================================================================
// CHANGEMENT D'EMAIL COMMERÇANT (code OTP 6 chiffres + anti-bruteforce)
// =============================================================================
// Même sécurité que le client : code à 6 chiffres (Supabase), 3 essais ratés →
// blocage 10 min puis 20 min (table partagée email_change_throttle), et refus
// si l'email est déjà associé à un autre compte (RPC email_already_used).
// L'email commerçant = auth.users.email (aucune colonne merchants.email à
// synchroniser).
const MERCHANT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function requestMerchantEmailChange(input: {
  email: string;
}): Promise<SettingsResult> {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!MERCHANT_EMAIL_RE.test(email))
    return { error: "Adresse email invalide." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };
  if (email === (user.email ?? "").toLowerCase()) {
    return { error: "C'est déjà ton adresse actuelle." };
  }

  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data: used } = await rpc("email_already_used", { p_email: email });
  if (used === true) {
    return { error: "Cette adresse est déjà associée à un autre compte." };
  }

  const admin = createAdminClient();
  const { data: th } = await admin
    .from("email_change_throttle")
    .select("locked_until")
    .eq("user_id", user.id)
    .maybeSingle();
  if (th?.locked_until && new Date(th.locked_until).getTime() > Date.now()) {
    const mins = Math.ceil(
      (new Date(th.locked_until).getTime() - Date.now()) / 60000
    );
    return { error: `Trop de tentatives. Réessaie dans ${mins} min.` };
  }

  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { error: `Erreur : ${error.message}` };
  return { ok: true, success: "Code envoyé à ta nouvelle adresse." };
}

export async function confirmMerchantEmailChange(input: {
  email: string;
  token: string;
}): Promise<SettingsResult> {
  const email = (input.email ?? "").trim().toLowerCase();
  const token = (input.token ?? "").replace(/\D/g, "");
  if (!MERCHANT_EMAIL_RE.test(email))
    return { error: "Adresse email invalide." };
  if (token.length < 6) return { error: "Entre le code à 6 chiffres reçu." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  const admin = createAdminClient();
  const { data: th } = await admin
    .from("email_change_throttle")
    .select("fails, lock_level, locked_until")
    .eq("user_id", user.id)
    .maybeSingle();
  if (th?.locked_until && new Date(th.locked_until).getTime() > Date.now()) {
    const mins = Math.ceil(
      (new Date(th.locked_until).getTime() - Date.now()) / 60000
    );
    return { error: `Trop de tentatives. Réessaie dans ${mins} min.` };
  }

  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email_change",
  });
  if (error) {
    const fails = (th?.fails ?? 0) + 1;
    if (fails >= 3) {
      const lock_level = (th?.lock_level ?? 0) + 1;
      const minutes = lock_level <= 1 ? 10 : 20;
      await admin.from("email_change_throttle").upsert({
        user_id: user.id,
        fails: 0,
        lock_level,
        locked_until: new Date(Date.now() + minutes * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      });
      return {
        error: `Code incorrect. Trop de tentatives : réessaie dans ${minutes} min.`,
      };
    }
    await admin.from("email_change_throttle").upsert({
      user_id: user.id,
      fails,
      updated_at: new Date().toISOString(),
    });
    return { error: `Code invalide. ${3 - fails} essai(s) restant(s).` };
  }

  await admin.from("email_change_throttle").delete().eq("user_id", user.id);
  revalidatePath("/settings");
  return { ok: true, success: "Adresse email mise à jour." };
}
