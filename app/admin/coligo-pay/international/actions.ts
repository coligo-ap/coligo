"use server";

// =============================================================================
// Actions admin — pilotage des paiements internationaux (€).
// Domaine RBAC : finances. Chaque changement de réglage est AUDITÉ
// (admin_audit_log, action='intl_settings_update', avec le détail).
// =============================================================================

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  auditIntl,
  fetchAndRecordParallelRate,
  getIntlSettings,
  resolveEffectiveRate,
} from "@/lib/payments/intl";

type State = { ok?: boolean; error?: string };

const PATH = "/admin/coligo-pay/international";

function cents(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100); // saisi en €, stocké en centimes
}

/** Met à jour les réglages (kill-switch, pays, taux, plafonds, PayPal). */
export async function updateIntlSettings(
  _prev: State,
  formData: FormData
): Promise<State> {
  if (!(await adminCan("finances"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? "admin";

  const enabled = formData.get("enabled") === "on";
  const paypal = formData.get("paypal_enabled") === "on";
  const rateMode = formData.get("rate_mode") === "manual" ? "manual" : "auto";

  const manualRate = Number(
    String(formData.get("manual_rate_da") ?? "").replace(",", ".")
  );
  const marginDa = Number(
    String(formData.get("auto_margin_da") ?? "").replace(",", ".")
  );
  const floorDa = Number(
    String(formData.get("rate_floor_da") ?? "").replace(",", ".")
  );
  const ceilDa = Number(
    String(formData.get("rate_ceiling_da") ?? "").replace(",", ".")
  );

  // Pays : codes ISO-2 séparés par virgules/espaces, ou '*' (monde entier).
  const countriesRaw = String(formData.get("allowed_countries") ?? "");
  const countries = countriesRaw
    .split(/[\s,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c === "*" || /^[A-Z]{2}$/.test(c));
  if (countries.length === 0) {
    return { error: "Liste de pays vide ou invalide (codes ISO-2, ex. FR)." };
  }

  if (
    rateMode === "manual" &&
    (!Number.isFinite(manualRate) || manualRate <= 0)
  ) {
    return { error: "Mode manuel : saisissez un taux valide (DA pour 1 €)." };
  }
  if (!Number.isFinite(marginDa) || marginDa < 0) {
    return { error: "Marge automatique invalide." };
  }
  if (
    !Number.isFinite(floorDa) ||
    !Number.isFinite(ceilDa) ||
    floorDa <= 0 ||
    ceilDa <= floorDa
  ) {
    return { error: "Bornes de taux invalides (plancher < plafond requis)." };
  }

  const perOrderMin = cents(formData.get("per_order_min_eur"));
  const perOrderMax = cents(formData.get("per_order_max_eur"));
  const perUserDay = cents(formData.get("per_user_day_eur"));
  const perUserMonth = cents(formData.get("per_user_month_eur"));
  const platformDay = cents(formData.get("platform_day_eur"));
  const platformMonth = cents(formData.get("platform_month_eur"));
  if (
    perOrderMin == null ||
    perOrderMax == null ||
    perUserDay == null ||
    perUserMonth == null ||
    platformDay == null ||
    platformMonth == null ||
    perOrderMax <= 0 ||
    perOrderMax < perOrderMin ||
    perUserDay <= 0 ||
    perUserMonth <= 0 ||
    platformDay <= 0 ||
    platformMonth <= 0
  ) {
    return { error: "Plafonds invalides (montants en € positifs, max ≥ min)." };
  }

  const admin = createAdminClient();
  const { error } = await (
    admin.from("intl_payment_settings" as never) as unknown as {
      update: (row: Record<string, unknown>) => {
        eq: (
          c: string,
          v: unknown
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({
      enabled,
      allowed_countries: countries,
      rate_mode: rateMode,
      manual_rate_da: rateMode === "manual" ? manualRate : null,
      auto_margin_da: marginDa,
      rate_floor_da: floorDa,
      rate_ceiling_da: ceilDa,
      per_order_min_eur_cents: perOrderMin,
      per_order_max_eur_cents: perOrderMax,
      per_user_day_eur_cents: perUserDay,
      per_user_month_eur_cents: perUserMonth,
      platform_day_eur_cents: platformDay,
      platform_month_eur_cents: platformMonth,
      paypal_enabled: paypal,
      updated_by: email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) return { error: error.message };

  await auditIntl(
    admin,
    "intl_settings_update",
    `${email} : enabled=${enabled}, pays=[${countries.join(",")}], taux=${rateMode}` +
      (rateMode === "manual"
        ? ` (${manualRate} DA/€)`
        : ` (parallèle − ${marginDa} DA, borné ${floorDa}–${ceilDa})`) +
      `, plafonds €: commande ${perOrderMin / 100}–${perOrderMax / 100}, ` +
      `client ${perUserDay / 100}/j ${perUserMonth / 100}/mois, ` +
      `plateforme ${platformDay / 100}/j ${platformMonth / 100}/mois, paypal=${paypal}`
  );

  revalidatePath(PATH);
  return { ok: true };
}

/** Force un rafraîchissement du taux parallèle (fetch immédiat, tracé). */
export async function refreshIntlRate(): Promise<
  State & { rate_da?: number; source?: string }
> {
  if (!(await adminCan("finances"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const settings = await getIntlSettings(admin);
  // Fetch immédiat (tracé en snapshot, succès ou échec), puis résolution du
  // taux effectif — qui lira ce snapshot tout frais.
  const fetched = await fetchAndRecordParallelRate(admin);
  const rate = await resolveEffectiveRate(admin, settings, {
    networkFetch: false,
  });
  revalidatePath(PATH);
  if (!rate) {
    return {
      error:
        fetched == null
          ? "Fetch du marché parallèle échoué et aucun snapshot exploitable."
          : "Taux non résolvable (mode manuel sans valeur ?).",
    };
  }
  return { ok: true, rate_da: rate.rate_da, source: rate.source };
}

/** Notifie (push) les clients de la liste d'attente « capacité » et marque
 *  notified_at. À utiliser après avoir relevé les plafonds. */
export async function notifyIntlWaitlist(): Promise<
  State & { notified?: number }
> {
  if (!(await adminCan("finances"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data: rows } = await (
    admin.from("intl_capacity_waitlist" as never) as unknown as {
      select: (cols: string) => {
        is: (
          c: string,
          v: null
        ) => Promise<{ data: { customer_id: string }[] | null }>;
      };
    }
  )
    .select("customer_id")
    .is("notified_at", null);
  const targets = rows ?? [];
  if (targets.length === 0) return { ok: true, notified: 0 };

  const { storeAndPushNotification } =
    await import("@/lib/notifications/notify");
  let sent = 0;
  for (const r of targets) {
    try {
      const { data: cust } = await admin
        .from("customers")
        .select("user_id")
        .eq("id", r.customer_id)
        .maybeSingle();
      if (!cust?.user_id) continue;
      await storeAndPushNotification({
        userId: cust.user_id,
        audience: "customer",
        kind: "intl_reopened",
        title: "Paiements en euros disponibles",
        body: "Tu peux de nouveau payer par carte internationale sur Coligo.",
        route: "/",
      });
      sent += 1;
    } catch (e) {
      console.error("[intl] waitlist notify failed:", e);
    }
  }
  await (
    admin.from("intl_capacity_waitlist" as never) as unknown as {
      update: (row: Record<string, unknown>) => {
        is: (
          c: string,
          v: null
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ notified_at: new Date().toISOString() })
    .is("notified_at", null);

  await auditIntl(
    admin,
    "intl_waitlist_notified",
    `${sent}/${targets.length} clients de la liste d'attente notifiés (réouverture €).`
  );
  revalidatePath(PATH);
  return { ok: true, notified: sent };
}
