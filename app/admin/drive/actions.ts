"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import { simulateMargins } from "@/lib/drive/margins";

export type DriveConfig = {
  pricing: Record<
    "classic" | "confort" | "moto",
    { base: number; per_km: number; min: number }
  >;
  night_coef: number;
  night_start_h: number;
  night_end_h: number;
  floor_rate: number;
  price_step_da: number;
  boost_min_da: number;
  boost_step_da: number;
  boost_default_rate: number;
  cashback_rate: number;
  female_filter_enabled: boolean;
  /** Remise « bienvenue » nouveau client (ancrage cosmétique, coût plateforme 0). */
  newcustomer_enabled: boolean;
  newcustomer_rate: number;
  /** Réservation programmée (OFF + masquée par défaut). */
  scheduled_enabled: boolean;
  freeze_debt_da: number;
  freeze_cancel_rate: number;
  freeze_cancel_window: number;
  freeze_min_rating: number;
  freeze_rating_window: number;
  plan_pro_fee_da: number;
  plan_pro_rate: number;
  plan_premium_fee_da: number;
  plan_premium_rate: number;
  /** Facteurs de tarif par durée (× tarif mensuel) : 1 sem / 2 sem. */
  sub_week_factor: number;
  sub_2week_factor: number;
  free_rate: number; // = vtc_commission_rate
  /** Abonnements payants Pro/Premium proposés au chauffeur (OFF au lancement :
   *  seul le plan Gratuit 0 % est visible). L'abonnement Prioritaire reste à part. */
  paid_plans_enabled: boolean;
  sub_grace_days: number;
  ccp_number: string;
  ccp_key: string;
  ccp_name: string;
  home_dir_max_per_day: number;
  request_ttl_min: number;
  offer_ttl_min: number;
  b2b_radius_km: number;
  /** Rayon de réception PAR DÉFAUT (km) : distance position chauffeur ↔ départ
   *  client, tant que le chauffeur n'a pas personnalisé « Ma zone ». Min 5, max 20. */
  default_radius_km: number;
  pickup_wait_min: number;
  deviation_km: number;
  deviation_min: number;
  chargily_fee: number;
};

export async function getDriveConfig(): Promise<DriveConfig | null> {
  if (!(await isSuperAdmin())) return null;
  const admin = createAdminClient();
  const { data: s } = await admin
    .from("platform_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (!s) return null;
  const pricing = s.drive_pricing as DriveConfig["pricing"];
  return {
    pricing,
    night_coef: Number(s.drive_night_coef),
    night_start_h: s.drive_night_start_h,
    night_end_h: s.drive_night_end_h,
    floor_rate: Number(s.drive_floor_rate),
    price_step_da: s.drive_price_step_da,
    boost_min_da: s.drive_boost_min_da,
    boost_step_da: s.drive_boost_step_da,
    boost_default_rate: Number(s.drive_boost_default_rate),
    cashback_rate: Number(s.drive_cashback_rate),
    female_filter_enabled: s.drive_female_filter_enabled,
    newcustomer_enabled: s.drive_newcustomer_enabled ?? true,
    newcustomer_rate: Number(s.drive_newcustomer_rate ?? 0.3),
    scheduled_enabled: s.drive_scheduled_enabled ?? false,
    freeze_debt_da: s.drive_freeze_debt_da,
    freeze_cancel_rate: Number(s.drive_freeze_cancel_rate),
    freeze_cancel_window: s.drive_freeze_cancel_window,
    freeze_min_rating: Number(s.drive_freeze_min_rating),
    freeze_rating_window: s.drive_freeze_rating_window,
    plan_pro_fee_da: s.drive_plan_pro_fee_da,
    plan_pro_rate: Number(s.drive_plan_pro_rate),
    plan_premium_fee_da: s.drive_plan_premium_fee_da,
    plan_premium_rate: Number(s.drive_plan_premium_rate),
    sub_week_factor: Number(s.drive_sub_week_factor ?? 0.35),
    sub_2week_factor: Number(s.drive_sub_2week_factor ?? 0.6),
    free_rate: Number(s.vtc_commission_rate),
    paid_plans_enabled: s.drive_paid_plans_enabled ?? false,
    sub_grace_days: s.drive_sub_grace_days,
    ccp_number: s.drive_ccp_number,
    ccp_key: s.drive_ccp_key,
    ccp_name: s.drive_ccp_name,
    home_dir_max_per_day: s.drive_home_dir_max_per_day,
    request_ttl_min: s.drive_request_ttl_min,
    offer_ttl_min: s.drive_offer_ttl_min,
    b2b_radius_km: Number(s.drive_b2b_radius_km),
    // Colonne récente (0247) hors types générés → cast local.
    default_radius_km: Number(
      (s as { drive_default_radius_km?: number }).drive_default_radius_km ?? 10
    ),
    pickup_wait_min: s.drive_pickup_wait_min,
    deviation_km: Number(s.drive_deviation_km),
    deviation_min: s.drive_deviation_min,
    chargily_fee: Number(s.chargily_fee),
  };
}

export async function updateDriveConfig(
  cfg: DriveConfig
): Promise<{ ok?: boolean; error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };

  // ── Garde-fous DURS (bloquants) ──
  if (cfg.night_coef < 0 || cfg.night_coef > 0.2)
    return { error: "Majoration nuit : maximum +20 % (règle dure)." };
  if (
    cfg.cashback_rate < 0 ||
    cfg.cashback_rate > Math.min(cfg.free_rate, cfg.plan_pro_rate)
  )
    return {
      error:
        "Cashback refusé : il doit rester ≤ à la commission de CHAQUE plan payant (financé par la commission, jamais en plus).",
    };
  for (const [g, p] of Object.entries(cfg.pricing)) {
    if (p.base < 0 || p.per_km < 0 || p.min < 0)
      return { error: `Barème ${g} : valeurs négatives interdites.` };
  }
  if (
    !Number.isFinite(cfg.default_radius_km) ||
    cfg.default_radius_km < 5 ||
    cfg.default_radius_km > 20
  )
    return {
      error: "Rayon de réception par défaut : entre 5 et 20 km (règle dure).",
    };
  // Simulateur pire-cas : marge plateforme jamais négative (espèces ET en ligne).
  const sims = simulateMargins({ ...cfg, basket: 300 });
  const losing = sims.find((s) => s.cash < 0 || s.online < 0);
  if (losing)
    return {
      error: `Config refusée : marge négative sur le plan ${losing.plan} (espèces ${losing.cash} DA · en ligne ${losing.online} DA sur une course de 300 DA). Baissez le cashback ou montez la commission.`,
    };

  const admin = createAdminClient();
  const { error } = await admin
    .from("platform_settings")
    .update({
      drive_pricing: cfg.pricing,
      drive_night_coef: cfg.night_coef,
      drive_night_start_h: cfg.night_start_h,
      drive_night_end_h: cfg.night_end_h,
      drive_floor_rate: cfg.floor_rate,
      drive_price_step_da: cfg.price_step_da,
      drive_boost_min_da: cfg.boost_min_da,
      drive_boost_step_da: cfg.boost_step_da,
      drive_boost_default_rate: cfg.boost_default_rate,
      drive_cashback_rate: cfg.cashback_rate,
      drive_female_filter_enabled: cfg.female_filter_enabled,
      drive_newcustomer_enabled: cfg.newcustomer_enabled,
      drive_newcustomer_rate: cfg.newcustomer_rate,
      drive_scheduled_enabled: cfg.scheduled_enabled,
      drive_freeze_debt_da: cfg.freeze_debt_da,
      drive_freeze_cancel_rate: cfg.freeze_cancel_rate,
      drive_freeze_cancel_window: cfg.freeze_cancel_window,
      drive_freeze_min_rating: cfg.freeze_min_rating,
      drive_freeze_rating_window: cfg.freeze_rating_window,
      drive_plan_pro_fee_da: cfg.plan_pro_fee_da,
      drive_plan_pro_rate: cfg.plan_pro_rate,
      drive_plan_premium_fee_da: cfg.plan_premium_fee_da,
      drive_plan_premium_rate: cfg.plan_premium_rate,
      drive_sub_week_factor: cfg.sub_week_factor,
      drive_sub_2week_factor: cfg.sub_2week_factor,
      vtc_commission_rate: cfg.free_rate,
      drive_paid_plans_enabled: cfg.paid_plans_enabled,
      drive_sub_grace_days: cfg.sub_grace_days,
      drive_ccp_number: cfg.ccp_number,
      drive_ccp_key: cfg.ccp_key,
      drive_ccp_name: cfg.ccp_name,
      drive_home_dir_max_per_day: cfg.home_dir_max_per_day,
      drive_request_ttl_min: cfg.request_ttl_min,
      drive_offer_ttl_min: cfg.offer_ttl_min,
      drive_b2b_radius_km: cfg.b2b_radius_km,
      drive_pickup_wait_min: cfg.pickup_wait_min,
      drive_deviation_km: cfg.deviation_km,
      drive_deviation_min: cfg.deviation_min,
    })
    .eq("id", true);
  if (error) return { error: error.message };
  // Colonne récente (0247) hors types générés → update casté à part.
  await (
    admin.from("platform_settings") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, val: boolean) => Promise<{ error: unknown }>;
      };
    }
  )
    .update({ drive_default_radius_km: Math.round(cfg.default_radius_km) })
    .eq("id", true);
  revalidatePath("/admin/drive");
  return { ok: true };
}

/* ───────────── Monitoring auto-calibrage (coefs appris) ───────────── */

export type LearningRow = {
  zone: string;
  band: number;
  coef: number;
  signal: number;
  n_obs: number;
  updated_at: string;
};

export async function getDriveLearning(): Promise<LearningRow[]> {
  if (!(await isSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("drive_price_learning")
    .select("zone, band, coef, signal, n_obs, updated_at")
    .order("zone", { ascending: true })
    .order("band", { ascending: true });
  return (data ?? []).map((r) => ({
    zone: r.zone,
    band: r.band,
    coef: Number(r.coef),
    signal: Number(r.signal),
    n_obs: r.n_obs,
    updated_at: r.updated_at,
  }));
}

/** Recalcule l'apprentissage à la demande (bouton admin). */
export async function recomputeDriveLearning(): Promise<{
  ok: boolean;
  bands?: number;
  error?: string;
}> {
  if (!(await isSuperAdmin())) return { ok: false, error: "Accès refusé." };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("drive_recompute_learning");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/drive");
  return { ok: true, bands: typeof data === "number" ? data : 0 };
}
