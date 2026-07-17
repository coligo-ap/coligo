"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
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
  if (!(await adminCan("drive"))) return null;
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
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };

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
  revalidatePath("/admin/chauffeurs/courses");
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
  if (!(await adminCan("drive"))) return [];
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
  if (!(await adminCan("drive"))) return { ok: false, error: "Accès refusé." };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("drive_recompute_learning");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/drive");
  revalidatePath("/admin/chauffeurs/courses");
  return { ok: true, bands: typeof data === "number" ? data : 0 };
}

// =============================================================================
// Courses BLOQUÉES (mig 0342) — le support tranche : annuler (+ remboursement
// séquestre) ou clôturer comme terminée (chauffeur payé). Chaque action est
// auditée (admin_audit_log, target_kind='ride', avant/après + IP) et notifie
// chauffeur + client (push ; leurs apps se resynchronisent via poll/Realtime).
// =============================================================================

/** IP client (même extraction que la télémétrie : x-forwarded-for en tête). */
async function rideActionIp(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return (
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null
    );
  } catch {
    return null;
  }
}

async function auditRide(
  action: string,
  rideId: string,
  note: string | null,
  values?: {
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
  }
) {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const from = supabase.from.bind(supabase) as unknown as (t: string) => {
      insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
    };
    await from("admin_audit_log").insert({
      admin_email: user?.email ?? null,
      action,
      target_kind: "ride",
      target_id: rideId,
      note,
      old_value: values?.oldValue ?? null,
      new_value: values?.newValue ?? null,
      ip: await rideActionIp(),
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action métier */
  }
}

export type StuckRide = {
  id: string;
  status: string;
  paymentMethod: string;
  priceDa: number;
  escrowDa: number;
  pickupText: string | null;
  destText: string | null;
  customerName: string | null;
  chauffeurName: string | null;
  chauffeurId: string | null;
  /** Dernier signe de vie (accepted/arrived/started… selon l'étape). */
  sinceAt: string;
  /** Classe : attribuée sans progression / recherche carte expirée. */
  kind: "active" | "card_expired";
};

/**
 * Courses à TRANCHER (mêmes définitions que les alertes 0342) :
 *  - attribuées (accepted/arriving/arrived/in_progress) sans progression
 *    depuis drive_stuck_ride_alert_min ;
 *  - recherches payées CARTE expirées (0250 ne les auto-annule pas).
 * Lecture service_role AUTO-GARDÉE (adminCan → []).
 */
export async function getStuckRides(): Promise<StuckRide[]> {
  if (!(await adminCan("drive"))) return [];
  const admin = createAdminClient();

  const { data: settings } = await admin
    .from("platform_settings")
    .select("drive_stuck_ride_alert_min" as never)
    .eq("id", true)
    .maybeSingle();
  const thresholdMin = Number(
    (settings as { drive_stuck_ride_alert_min?: number } | null)
      ?.drive_stuck_ride_alert_min ?? 120
  );

  const { data: rides } = await admin
    .from("rides")
    .select(
      "id, status, payment_method, agreed_price_da, proposed_price_da, boost_amount_da, escrow_da, pickup_text, dest_text, customer_id, chauffeur_id, created_at, accepted_at, arrived_at, started_at, expires_at, online_paid_at"
    )
    .not("status", "in", "(completed,cancelled)")
    .order("created_at", { ascending: true })
    .limit(100);

  const now = Date.now();
  type RideRow = NonNullable<typeof rides>[number] & {
    customer_id: string | null;
    chauffeur_id: string | null;
  };
  const rows: StuckRide[] = [];
  const custIds = new Set<string>();
  const chIds = new Set<string>();
  for (const raw of rides ?? []) {
    const r = raw as RideRow;
    const sinceAt =
      r.started_at ?? r.arrived_at ?? r.accepted_at ?? r.created_at;
    const ageMin = (now - new Date(sinceAt).getTime()) / 60000;
    const isActive = [
      "accepted",
      "arriving",
      "arrived",
      "in_progress",
    ].includes(r.status);
    const isCardExpired =
      r.status === "searching" &&
      r.payment_method === "card" &&
      !!r.online_paid_at &&
      !!r.expires_at &&
      new Date(r.expires_at).getTime() < now;
    if (
      !(isActive && thresholdMin > 0 && ageMin >= thresholdMin) &&
      !isCardExpired
    )
      continue;
    if (r.customer_id) custIds.add(r.customer_id);
    if (r.chauffeur_id) chIds.add(r.chauffeur_id);
    rows.push({
      id: r.id,
      status: r.status,
      paymentMethod: r.payment_method,
      priceDa: Math.max(
        0,
        r.agreed_price_da ??
          (r.proposed_price_da ?? 0) + (r.boost_amount_da ?? 0)
      ),
      escrowDa: r.escrow_da ?? 0,
      pickupText: r.pickup_text,
      destText: r.dest_text,
      customerName: r.customer_id,
      chauffeurName: r.chauffeur_id,
      chauffeurId: r.chauffeur_id,
      sinceAt,
      kind: isCardExpired ? "card_expired" : "active",
    });
  }
  if (rows.length === 0) return rows;

  // Résolution des noms (tables courtes filtrées par id, best-effort).
  const [{ data: custs }, { data: chs }] = await Promise.all([
    custIds.size
      ? admin
          .from("customers")
          .select("id, full_name")
          .in("id", [...custIds])
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    chIds.size
      ? admin
          .from("chauffeurs")
          .select("id, full_name")
          .in("id", [...chIds])
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const custName = new Map((custs ?? []).map((c) => [c.id, c.full_name]));
  const chName = new Map((chs ?? []).map((c) => [c.id, c.full_name]));
  for (const row of rows) {
    row.customerName = row.customerName
      ? (custName.get(row.customerName) ?? null)
      : null;
    row.chauffeurName = row.chauffeurName
      ? (chName.get(row.chauffeurName) ?? null)
      : null;
  }
  return rows;
}

/** Annule une course bloquée (remboursement séquestre automatique). */
export async function adminCancelRide(input: {
  rideId: string;
  reason: string;
}): Promise<{ ok?: boolean; error?: string }> {
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };
  const reason = input.reason?.trim();
  if (!reason) return { error: "Le motif est obligatoire." };

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_cancel_ride", {
    p_ride_id: input.rideId,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    from_status?: string;
    refunded_da?: number;
  };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      ride_not_found: "Course introuvable.",
      already_terminal: "Course déjà terminée ou annulée.",
    };
    return { error: map[res.reason ?? ""] ?? "Annulation impossible." };
  }

  await auditRide("cancel_ride", input.rideId, reason, {
    oldValue: res.from_status ? { status: res.from_status } : null,
    newValue: {
      status: "cancelled",
      ...(res.refunded_da ? { refunded_da: res.refunded_da } : {}),
    },
  });
  // Anti-fraude : trace de l'annulation admin (phase, position chauffeur)
  {
    const { fraudIngestCancel } = await import("@/lib/fraud/events");
    void fraudIngestCancel("ride", input.rideId, "admin");
  }
  try {
    const { notifyRideClosedByAdmin } = await import("@/lib/fcm/triggers");
    await notifyRideClosedByAdmin({
      rideId: input.rideId,
      outcome: "cancelled",
      refundedDa: res.refunded_da ?? 0,
    });
  } catch {
    /* noop */
  }
  revalidatePath("/admin/drive");
  revalidatePath("/admin/chauffeurs/courses");
  return { ok: true };
}

/** Clôture une course bloquée COMME TERMINÉE (chauffeur payé, motif requis). */
export async function adminCompleteRide(input: {
  rideId: string;
  reason: string;
}): Promise<{ ok?: boolean; error?: string }> {
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };
  const reason = input.reason?.trim();
  if (!reason) return { error: "Le motif est obligatoire." };

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_complete_ride", {
    p_ride_id: input.rideId,
    p_note: reason,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    from_status?: string;
    chauffeur_net_da?: number;
  };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      ride_not_found: "Course introuvable.",
      cancelled: "Course déjà annulée.",
      no_chauffeur: "Aucun chauffeur attribué — annule plutôt la course.",
      escrow_missing:
        "Séquestre carte incomplet — contacte la finance avant de clôturer.",
    };
    return { error: map[res.reason ?? ""] ?? "Clôture impossible." };
  }

  await auditRide("complete_ride", input.rideId, reason, {
    oldValue: res.from_status ? { status: res.from_status } : null,
    newValue: {
      status: "completed",
      ...(res.chauffeur_net_da
        ? { chauffeur_net_da: res.chauffeur_net_da }
        : {}),
    },
  });
  try {
    const { notifyRideClosedByAdmin } = await import("@/lib/fcm/triggers");
    await notifyRideClosedByAdmin({
      rideId: input.rideId,
      outcome: "completed",
    });
  } catch {
    /* noop */
  }
  revalidatePath("/admin/drive");
  revalidatePath("/admin/chauffeurs/courses");
  return { ok: true };
}

/**
 * Remboursement MANUEL du client d'une course TERMINÉE (partiel/total) →
 * crédit Coligo Pay via admin_refund_ride_customer (0345 : plafonné au payé
 * réel, anti-double sous FOR UPDATE). Une course non terminée s'ANNULE
 * (le séquestre est déjà recrédité par ce circuit).
 */
export async function adminRefundRideCustomer(input: {
  rideId: string;
  amountDa: number;
  reason: string;
}): Promise<{ ok?: boolean; error?: string }> {
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };
  const amt = Math.floor(Number(input.amountDa));
  if (!Number.isFinite(amt) || amt < 1) return { error: "Montant invalide." };
  const reason = input.reason?.trim();
  if (!reason) return { error: "Le motif est obligatoire." };

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_refund_ride_customer", {
    p_ride_id: input.rideId,
    p_amount_da: amt,
    p_note: reason,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    remaining_da?: number;
    total_refunded_da?: number;
  };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      bad_amount: "Montant invalide.",
      note_required: "Le motif est obligatoire.",
      ride_not_found: "Course introuvable.",
      cancelled_already_refunded:
        "Course annulée : le séquestre a déjà été remboursé automatiquement.",
      not_completed_use_cancel:
        "Course non terminée : utilise l'annulation (elle rembourse le séquestre).",
      nothing_refundable: "Plus rien à rembourser sur cette course.",
      exceeds_refundable: `Montant supérieur au remboursable restant (${res.remaining_da ?? 0} DA).`,
    };
    return { error: map[res.reason ?? ""] ?? "Remboursement impossible." };
  }

  await auditRide("refund_ride_customer", input.rideId, reason, {
    newValue: {
      refund_da: amt,
      total_refunded_da: res.total_refunded_da ?? amt,
    },
  });
  try {
    const { notifyRideCustomerRefund } = await import("@/lib/fcm/triggers");
    await notifyRideCustomerRefund({ rideId: input.rideId, amountDa: amt });
  } catch {
    /* noop */
  }
  revalidatePath("/admin/drive");
  revalidatePath("/admin/chauffeurs/courses");
  return { ok: true };
}

/**
 * INDEMNISE le chauffeur d'une course : crédit motivé de son PORTEFEUILLE
 * OPÉRATEUR (admin_operator_credit 0185 — grand livre immuable, idempotent
 * via op_id dérivé de la course : UNE indemnité par course). Audit ride.
 */
export async function adminCompensateChauffeur(input: {
  rideId: string;
  amountDa: number;
  reason: string;
}): Promise<{ ok?: boolean; error?: string }> {
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };
  const amt = Math.floor(Number(input.amountDa));
  if (!Number.isFinite(amt) || amt < 1 || amt > 20000) {
    return { error: "Montant invalide (1 à 20 000 DA)." };
  }
  const reason = input.reason?.trim();
  if (!reason) return { error: "Le motif est obligatoire." };

  const admin = createAdminClient();
  const { data: ride } = await admin
    .from("rides")
    .select("id, chauffeur_id")
    .eq("id", input.rideId)
    .maybeSingle();
  if (!ride) return { error: "Course introuvable." };
  if (!ride.chauffeur_id) return { error: "Aucun chauffeur sur cette course." };
  // operator_wallets hors database.types.ts généré → accès casté (pattern).
  const { data: wallet } = await admin
    .from("operator_wallets" as never)
    .select("id")
    .eq("owner_type" as never, "chauffeur" as never)
    .eq("owner_id" as never, ride.chauffeur_id as never)
    .maybeSingle<{ id: string }>();
  if (!wallet)
    return { error: "Portefeuille opérateur du chauffeur introuvable." };

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { error } = await rpc("admin_operator_credit", {
    p_wallet_id: wallet.id,
    p_amount_da: amt,
    p_type: "bonus",
    p_note: `Indemnité course Drive ${input.rideId.slice(0, 8)} — ${reason}`,
    // Idempotence structurelle : UNE indemnité par course (rejouer ne double pas).
    p_op_id: `ride-compensation-${input.rideId}`,
  });
  if (error) return { error: error.message };

  await auditRide("compensate_chauffeur", input.rideId, reason, {
    newValue: { chauffeur_id: ride.chauffeur_id, compensation_da: amt },
  });
  try {
    const { notifyChauffeurCompensation } = await import("@/lib/fcm/triggers");
    await notifyChauffeurCompensation({
      chauffeurId: ride.chauffeur_id,
      amountDa: amt,
    });
  } catch {
    /* noop */
  }
  revalidatePath("/admin/drive");
  revalidatePath("/admin/chauffeurs/courses");
  return { ok: true };
}
