"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";

// =============================================================================
// Gestion des PLANS D'ABONNEMENT DRIVE (super-admin, domaine « drive »).
// Source de vérité = table drive_plans (0304). Écriture EXCLUSIVEMENT via
// service_role ici (garde adminCan + RLS/trigger côté base). Le chauffeur/client
// ne peut jamais fixer un prix ou un taux : ils sont imposés par cette table.
// =============================================================================

export type BillingPeriod = "day" | "week" | "month";

export type DrivePlan = {
  code: string;
  title: string;
  subtitle: string | null;
  price_da: number;
  billing_period: BillingPeriod;
  duration_days: number;
  commission_rate: number;
  cashback_rate: number;
  advantages: string[];
  badge_label: string | null;
  badge_color: string | null;
  display_rank: number;
  is_priority: boolean;
  is_default: boolean;
  is_active: boolean;
  subscribers?: number; // abonnés actifs (lecture seule)
};

// drive_plans absente des types générés → client non-générique (lint-clean).
const db = () => createAdminClient() as unknown as SupabaseClient;

const DAYS: Record<BillingPeriod, number> = { day: 1, week: 7, month: 30 };
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

export async function getDrivePlans(): Promise<DrivePlan[] | null> {
  if (!(await adminCan("drive"))) return null;
  const admin = db();
  const { data } = await admin
    .from("drive_plans")
    .select("*")
    .order("display_rank", { ascending: false });
  const plans = (data ?? []) as DrivePlan[];

  // Abonnés actifs par plan (aperçu).
  const { data: subs } = await admin
    .from("chauffeur_subscriptions")
    .select("plan")
    .eq("status", "active")
    .gte("period_end", new Date().toISOString());
  const counts = new Map<string, number>();
  for (const r of (subs ?? []) as { plan: string }[])
    counts.set(r.plan, (counts.get(r.plan) ?? 0) + 1);

  return plans.map((p) => ({
    ...p,
    price_da: Number(p.price_da),
    duration_days: Number(p.duration_days),
    commission_rate: Number(p.commission_rate),
    cashback_rate: Number(p.cashback_rate),
    display_rank: Number(p.display_rank),
    advantages: p.advantages ?? [],
    subscribers: counts.get(p.code) ?? 0,
  }));
}

/** Validation partagée serveur (jamais faire confiance au client). */
function validate(p: DrivePlan): string | null {
  if (!p.title?.trim()) return "Le titre est obligatoire.";
  if (!["day", "week", "month"].includes(p.billing_period))
    return "Période invalide (jour / semaine / mois).";
  if (!Number.isFinite(p.price_da) || p.price_da < 0)
    return "Le prix doit être positif ou nul.";
  if (
    !Number.isInteger(p.duration_days) ||
    p.duration_days < 1 ||
    p.duration_days > 366
  )
    return "Durée invalide (1 à 366 jours).";
  if (p.commission_rate < 0 || p.commission_rate > 1)
    return "Commission : entre 0 et 100 %.";
  if (p.cashback_rate < 0 || p.cashback_rate > 1)
    return "Cashback : entre 0 et 100 %.";
  // INVARIANT DUR : le cashback est financé par la commission.
  if (p.cashback_rate > p.commission_rate)
    return "Cashback refusé : il ne peut pas dépasser la commission du plan (financé par elle).";
  return null;
}

export async function upsertDrivePlan(
  input: DrivePlan & { originalCode?: string }
): Promise<{ ok?: boolean; error?: string; code?: string }> {
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };
  const err = validate(input);
  if (err) return { error: err };

  const admin = db();
  const isNew = !input.originalCode;
  const code = input.originalCode ?? slug(input.code || input.title);
  if (!code) return { error: "Code de plan invalide." };

  // Un plan par défaut ne peut pas être payant (c'est la formule de base).
  if (input.is_default && input.price_da > 0)
    return { error: "Le plan par défaut (base) doit être gratuit." };

  const row = {
    code,
    title: input.title.trim(),
    subtitle: input.subtitle?.trim() || null,
    price_da: Math.round(input.price_da),
    billing_period: input.billing_period,
    duration_days: input.duration_days || DAYS[input.billing_period],
    commission_rate: input.commission_rate,
    cashback_rate: input.cashback_rate,
    advantages: (input.advantages ?? []).map((a) => a.trim()).filter(Boolean),
    badge_label: input.badge_label?.trim() || null,
    badge_color: input.badge_color?.trim() || null,
    display_rank: Math.round(input.display_rank ?? 0),
    is_priority: !!input.is_priority,
    is_active: !!input.is_active,
    // is_default n'est modifiable que via setDefaultPlan (unicité garantie).
  };

  if (isNew) {
    const { error } = await admin.from("drive_plans").insert(row);
    if (error)
      return {
        error: /duplicate|unique/i.test(error.message)
          ? "Un plan avec ce code existe déjà."
          : error.message,
      };
  } else {
    const { error } = await admin
      .from("drive_plans")
      .update(row)
      .eq("code", code);
    if (error) return { error: error.message };
  }

  // Le plan par défaut pilote la commission/cashback « de base » : on garde
  // platform_settings synchronisé (compat lecteurs directs de vtc_commission_rate).
  if (input.is_default) {
    await admin
      .from("platform_settings")
      .update({
        vtc_commission_rate: input.commission_rate,
        drive_cashback_rate: input.cashback_rate,
      })
      .eq("id", true);
  }
  revalidatePath("/admin/chauffeurs/abonnements");
  return { ok: true, code };
}

export async function setPlanActive(
  code: string,
  active: boolean
): Promise<{ ok?: boolean; error?: string }> {
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };
  const { error } = await db()
    .from("drive_plans")
    .update({ is_active: active })
    .eq("code", code);
  if (error) return { error: error.message };
  revalidatePath("/admin/chauffeurs/abonnements");
  return { ok: true };
}

export async function deleteDrivePlan(
  code: string
): Promise<{ ok?: boolean; error?: string }> {
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };
  const admin = db();
  const { data: plan } = await admin
    .from("drive_plans")
    .select("is_default")
    .eq("code", code)
    .maybeSingle();
  if ((plan as { is_default?: boolean } | null)?.is_default)
    return { error: "Le plan par défaut ne peut pas être supprimé." };

  // Refus si des abonnements actifs pointent dessus (sécurité métier).
  const { count } = await admin
    .from("chauffeur_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("plan", code)
    .eq("status", "active");
  if ((count ?? 0) > 0)
    return {
      error: `Impossible : ${count} chauffeur(s) sont abonnés à ce plan. Désactivez-le plutôt.`,
    };

  const { error } = await admin.from("drive_plans").delete().eq("code", code);
  if (error) return { error: error.message };
  revalidatePath("/admin/chauffeurs/abonnements");
  return { ok: true };
}

// =============================================================================
// PASS PRIORITAIRE (mig 0210) — géré ici « comme un abonnement », commun aux
// livreurs ET aux chauffeurs. Prix / promo / fenêtre dispatch / interrupteur
// vivent dans platform_settings ; écriture service_role gardée par adminCan.
// =============================================================================
export type PriorityPass = {
  enabled: boolean;
  monthly_da: number;
  first_month_da: number;
  window_sec: number;
  subs_drivers: number; // abonnés actifs livreurs (lecture seule)
  subs_chauffeurs: number; // abonnés actifs chauffeurs (lecture seule)
};

export async function getPriorityPass(): Promise<PriorityPass | null> {
  if (!(await adminCan("drive"))) return null;
  const admin = db();
  const { data: s } = await admin
    .from("platform_settings")
    .select(
      "priority_pass_enabled, sub_priority_monthly_da, sub_priority_first_month_da, dispatch_priority_delay_sec"
    )
    .eq("id", true)
    .maybeSingle();
  const row = (s ?? {}) as {
    priority_pass_enabled?: boolean;
    sub_priority_monthly_da?: number;
    sub_priority_first_month_da?: number;
    dispatch_priority_delay_sec?: number;
  };

  // Abonnés actifs (non expirés), ventilés par type de partenaire.
  const { data: subs } = await admin
    .from("priority_subscriptions")
    .select("subject_type")
    .eq("status", "active")
    .gte("period_end", new Date().toISOString());
  let subs_drivers = 0;
  let subs_chauffeurs = 0;
  for (const r of (subs ?? []) as { subject_type: string }[]) {
    if (r.subject_type === "driver") subs_drivers++;
    else if (r.subject_type === "chauffeur") subs_chauffeurs++;
  }

  return {
    enabled: row.priority_pass_enabled ?? true,
    monthly_da: Number(row.sub_priority_monthly_da ?? 0),
    first_month_da: Number(row.sub_priority_first_month_da ?? 0),
    window_sec: Number(row.dispatch_priority_delay_sec ?? 10),
    subs_drivers,
    subs_chauffeurs,
  };
}

export async function updatePriorityPass(input: {
  enabled: boolean;
  monthly_da: number;
  first_month_da: number;
  window_sec: number;
}): Promise<{ ok?: boolean; error?: string }> {
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };

  const monthly = Math.round(input.monthly_da);
  const first = Math.round(input.first_month_da);
  const win = Math.round(input.window_sec);
  if (!Number.isFinite(monthly) || monthly < 0)
    return { error: "Le prix mensuel doit être positif ou nul." };
  if (!Number.isFinite(first) || first < 0)
    return { error: "La promo 1er mois doit être positive ou nulle." };
  if (first > monthly)
    return {
      error: "La promo du 1er mois ne peut pas dépasser le prix mensuel.",
    };
  if (!Number.isFinite(win) || win < 5 || win > 30)
    return {
      error: "La fenêtre de priorité doit être entre 5 et 30 secondes.",
    };

  const { error } = await db()
    .from("platform_settings")
    .update({
      priority_pass_enabled: !!input.enabled,
      sub_priority_monthly_da: monthly,
      sub_priority_first_month_da: first,
      dispatch_priority_delay_sec: win,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) return { error: error.message };
  revalidatePath("/admin/chauffeurs/abonnements");
  return { ok: true };
}

/** Réordonne l'affichage (le 1er de la liste = rang le plus élevé). */
export async function reorderDrivePlans(
  codes: string[]
): Promise<{ ok?: boolean; error?: string }> {
  if (!(await adminCan("drive"))) return { error: "Accès refusé." };
  const admin = db();
  const n = codes.length;
  for (let i = 0; i < n; i++) {
    const { error } = await admin
      .from("drive_plans")
      .update({ display_rank: (n - i) * 10 })
      .eq("code", codes[i]);
    if (error) return { error: error.message };
  }
  revalidatePath("/admin/chauffeurs/abonnements");
  return { ok: true };
}
