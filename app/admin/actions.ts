"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { FEATURE_KEYS } from "@/lib/data/feature-flags";
import { APP_THEMES, APP_THEME_MODELS } from "@/lib/config/app-themes";
import { getCatalogTemplate } from "@/lib/config/catalog-templates";
import {
  merchantRatesSchema,
  platformSettingsSchema,
  pctToRate,
} from "@/lib/validation/platform";

export type AdminFormState = { error?: string; ok?: boolean };

// SOURCE UNIQUE des clés (lib/data/feature-flags). L'ancienne liste locale
// figée à 6 clés refusait les flags ajoutés ensuite (barcode_*, IDV) avec
// « Fonctionnalité inconnue » au moment d'enregistrer.
const FEATURE_STATUSES = ["active", "hidden", "coming_soon", "maintenance"];

/**
 * Disponibilité d'une fonctionnalité (kill-switch super-admin, mig 0182).
 * États : active / hidden / coming_soon / maintenance + messages FR/AR.
 * L'API est bloquée côté DB (triggers) ; ici on persiste l'état + le message.
 */
export async function updateFeatureFlag(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };

  const key = String(formData.get("key") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!(FEATURE_KEYS as readonly string[]).includes(key))
    return { error: "Fonctionnalité inconnue." };
  if (!FEATURE_STATUSES.includes(status)) return { error: "État invalide." };

  const clean = (v: FormDataEntryValue | null): string | null => {
    const s = (v == null ? "" : String(v)).trim();
    return s.length ? s.slice(0, 400) : null;
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // `feature_flags` (mig 0182) pas encore dans database.types.ts → cast local.
  const from = supabase.from.bind(supabase) as unknown as (t: string) => {
    update: (v: Record<string, unknown>) => {
      eq: (
        c: string,
        val: string
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  const { error } = await from("feature_flags")
    .update({
      status,
      title_fr: clean(formData.get("title_fr")),
      title_ar: clean(formData.get("title_ar")),
      message_fr: clean(formData.get("message_fr")),
      message_ar: clean(formData.get("message_ar")),
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    })
    .eq("key", key);

  if (error) return { error: `Échec : ${error.message}` };
  revalidatePath("/admin/controle");
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Thème d'apparence « occasion » (mig 0415) : héros des portails d'auth +
 * bandeau optionnel de l'accueil marketplace. Appliqué immédiatement partout
 * (revalidateTag "app-theme" → le layout racine re-lit les variables CSS).
 */
export async function setAppTheme(
  theme: string,
  model: string,
  marketplaceHero: boolean
): Promise<AdminFormState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  if (!(theme in APP_THEMES)) return { error: "Thème inconnu." };
  if (!(model in APP_THEME_MODELS)) return { error: "Modèle inconnu." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Table verrouillée RLS en écriture → service_role, accès casté (hors types).
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    upsert: (
      v: Record<string, unknown>,
      o: { onConflict: string }
    ) => Promise<{ error: { message: string } | null }>;
  };
  const { error } = await from("app_theme").upsert(
    {
      id: true,
      theme,
      model,
      marketplace_hero: marketplaceHero,
      updated_at: new Date().toISOString(),
      updated_by: user?.email ?? null,
    },
    { onConflict: "id" }
  );
  if (error) return { error: error.message };

  // target_id est un uuid en base → la clé du thème va dans note.
  await supabase.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: "set_app_theme",
    target_kind: "app_theme",
    target_id: null,
    note: `theme=${theme} · model=${model} · marketplace_hero=${marketplaceHero}`,
  });

  revalidateTag("app-theme");
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Bascule TEST / LIVE de Chargily Pay (mig 0347). Les clés vivent dans
 * l'environnement — ici on ne change QUE le mode actif, et on refuse
 * d'activer un mode dont la clé n'est pas configurée (ou a un mauvais
 * préfixe) : le checkout ne doit jamais partir vers le mauvais environnement.
 */
export async function setChargilyLiveMode(
  live: boolean
): Promise<AdminFormState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };

  if (live) {
    const key = process.env.CHARGILY_LIVE_SECRET_KEY;
    if (!key) {
      return {
        error:
          "CHARGILY_LIVE_SECRET_KEY absente de l'environnement — ajoutez la clé (Vercel) puis redéployez avant d'activer le mode live.",
      };
    }
    if (!key.startsWith("live_")) {
      return {
        error:
          "La clé configurée en CHARGILY_LIVE_SECRET_KEY n'a pas le préfixe « live_ » — vérifiez la clé.",
      };
    }
  } else {
    const key =
      process.env.CHARGILY_TEST_SECRET_KEY ?? process.env.CHARGILY_SECRET_KEY;
    if (!key || !key.startsWith("test_")) {
      return {
        error:
          "Aucune clé TEST valide (CHARGILY_TEST_SECRET_KEY / CHARGILY_SECRET_KEY) dans l'environnement.",
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("platform_settings")
    .update({
      chargily_live_mode: live,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", true);
  if (error) return { error: error.message };

  revalidatePath("/admin/controle");
  return { ok: true };
}

/**
 * Bascule TEST / LIVE de Stripe (mig 0377) — même modèle que Chargily : les
 * clés vivent dans l'environnement, on ne change QUE le mode actif, et on
 * refuse d'activer un mode dont la clé n'est pas configurée (ou a un mauvais
 * préfixe). S'applique immédiatement aux paiements internationaux (€).
 */
export async function setStripeLiveMode(
  live: boolean
): Promise<AdminFormState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };

  if (live) {
    const key = process.env.STRIPE_LIVE_SECRET_KEY;
    if (!key) {
      return {
        error:
          "STRIPE_LIVE_SECRET_KEY absente de l'environnement — ajoutez la clé (Vercel) puis redéployez avant d'activer le live.",
      };
    }
    if (!key.startsWith("sk_live_")) {
      return {
        error:
          "La clé configurée en STRIPE_LIVE_SECRET_KEY n'a pas le préfixe « sk_live_ » — vérifiez la clé.",
      };
    }
  } else {
    const key = process.env.STRIPE_TEST_SECRET_KEY;
    if (!key || !key.startsWith("sk_test_")) {
      return {
        error:
          "Aucune clé TEST valide (STRIPE_TEST_SECRET_KEY) dans l'environnement.",
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("platform_settings")
    .update({
      stripe_live_mode: live,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", true);
  if (error) return { error: error.message };

  revalidatePath("/admin/controle");
  return { ok: true };
}

/**
 * Active / désactive le transfert P2P Coligo Pay (boutons Envoyer / Recevoir
 * côté client). Source unique = platform_settings.p2p_enabled, lue partout
 * (lib/customer/p2p.ts, wallet-actions, wallet-qr-view, /coligo-pay/envoyer).
 *
 * Désactivé (défaut) = TOUTES les surfaces P2P sont masquées côté client — exigé
 * par Google Play (une app à crédit fermé ne doit exposer aucun transfert
 * d'argent entre utilisateurs, sinon = fonctionnalité financière régulée
 * « Money transfer » → compte organisation obligatoire). N'activer qu'une fois
 * le cadre réglementaire / le type de compte réglés. La garde DURE reste côté
 * SQL (coligo_pay_transfer → p2p_disabled) : le flag ne fait que gérer l'UI.
 */
export async function setColigoPayP2p(
  enabled: boolean
): Promise<AdminFormState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("platform_settings")
    .update({
      p2p_enabled: enabled,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", true);
  if (error) return { error: error.message };

  revalidatePath("/admin/controle");
  // Le wallet client dépend du flag → rafraîchir toutes les vues.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Rayons de dispatch (A) — express + drive — sur platform_settings. */
export async function updateDispatchRadii(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };

  const express = Number(formData.get("express_dispatch_radius_km"));
  const drive = Number(formData.get("drive_dispatch_radius_km"));
  if (!Number.isFinite(express) || express <= 0 || express > 50) {
    return { error: "Rayon express invalide (0–50 km)." };
  }
  if (!Number.isFinite(drive) || drive <= 0 || drive > 60) {
    return { error: "Rayon drive invalide (0–60 km)." };
  }

  const supabase = await createClient();
  // Colonnes express/drive_dispatch_radius_km (mig 0182) pas encore typées.
  const from = supabase.from.bind(supabase) as unknown as (t: string) => {
    update: (v: Record<string, unknown>) => {
      eq: (
        c: string,
        val: boolean
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  const { error } = await from("platform_settings")
    .update({
      express_dispatch_radius_km: express,
      drive_dispatch_radius_km: drive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) return { error: `Échec : ${error.message}` };
  revalidatePath("/admin/controle");
  return { ok: true };
}

export async function updatePlatformSettings(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };

  const parsed = platformSettingsSchema.safeParse({
    commission_cash: formData.get("commission_cash"),
    commission_online: formData.get("commission_online"),
    cashback_online: formData.get("cashback_online"),
    cashback_cash: formData.get("cashback_cash"),
    chargily_fee: formData.get("chargily_fee"),
    max_debt_da: formData.get("max_debt_da"),
    delivery_base_da: formData.get("delivery_base_da"),
    delivery_per_km_da: formData.get("delivery_per_km_da"),
    delivery_free_km_threshold: formData.get("delivery_free_km_threshold"),
    delivery_min_da: formData.get("delivery_min_da"),
    delivery_max_da: formData.get("delivery_max_da"),
    delivery_max_radius_km: formData.get("delivery_max_radius_km"),
    tour_delivery_commission_rate: formData.get(
      "tour_delivery_commission_rate"
    ),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("platform_settings")
    .update({
      commission_cash: pctToRate(d.commission_cash),
      commission_online: pctToRate(d.commission_online),
      cashback_online: pctToRate(d.cashback_online),
      cashback_cash: pctToRate(d.cashback_cash),
      chargily_fee: pctToRate(d.chargily_fee),
      max_debt_da: d.max_debt_da,
      delivery_base_da: d.delivery_base_da,
      delivery_per_km_da: d.delivery_per_km_da,
      delivery_free_km_threshold: d.delivery_free_km_threshold,
      delivery_min_da: d.delivery_min_da,
      delivery_max_da: d.delivery_max_da,
      delivery_max_radius_km: d.delivery_max_radius_km,
      tour_delivery_commission_rate: pctToRate(d.tour_delivery_commission_rate),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) return { error: `Échec : ${error.message}` };

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function updateMerchantRates(
  merchantId: string,
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };

  const parsed = merchantRatesSchema.safeParse({
    commission_cash: formData.get("commission_cash"),
    commission_online: formData.get("commission_online"),
    cashback_online: formData.get("cashback_online"),
    cashback_cash: formData.get("cashback_cash"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const d = parsed.data;
  const toRate = (v: number | null) => (v == null ? null : pctToRate(v));

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchants")
    .update({
      commission_cash: toRate(d.commission_cash),
      commission_online: toRate(d.commission_online),
      cashback_online: toRate(d.cashback_online),
      cashback_cash: toRate(d.cashback_cash),
    })
    .eq("id", merchantId);

  if (error) return { error: `Échec : ${error.message}` };

  revalidatePath("/admin/merchants");
  return { ok: true };
}

export async function toggleMerchantFrozen(
  merchantId: string,
  frozen: boolean
): Promise<{ error?: string }> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchants")
    .update({ is_frozen: frozen })
    .eq("id", merchantId);

  if (error) return { error: error.message };

  // Audit
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: frozen ? "freeze_merchant" : "unfreeze_merchant",
    target_kind: "merchant",
    target_id: merchantId,
  });

  revalidatePath("/admin/merchants");
  return {};
}

/**
 * Validation d'une demande d'inscription commerçant (mig 0273).
 * Approuver ⇒ approval_status='approved' + is_active=true (la boutique devient
 * visible des clients et peut recevoir des commandes — l'enforcement réutilise
 * is_active, déjà filtré par merchants_public + RLS commande).
 * Refuser ⇒ approval_status='rejected' + is_active=false (+ motif affiché au
 * commerçant). Réversible : ré-approuver rebascule is_active=true.
 */
export async function decideMerchantApproval(
  merchantId: string,
  decision: "approve" | "reject",
  reason?: string
): Promise<{ error?: string }> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };

  const approve = decision === "approve";
  const supabase = await createClient();
  // approval_status/approved_at/rejected_reason hors types générés → cast.
  const update = supabase.from.bind(supabase) as unknown as (t: string) => {
    update: (v: Record<string, unknown>) => {
      eq: (
        c: string,
        v: string
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  const { error } = await update("merchants")
    .update({
      approval_status: approve ? "approved" : "rejected",
      is_active: approve,
      approved_at: approve ? new Date().toISOString() : null,
      rejected_reason: approve ? null : reason?.trim() || null,
    })
    .eq("id", merchantId);

  if (error) return { error: error.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: approve ? "approve_merchant" : "reject_merchant",
    target_kind: "merchant",
    target_id: merchantId,
    note: approve ? null : reason?.trim() || null,
  });

  revalidatePath("/admin/merchants");
  return {};
}

/**
 * Écarte un brouillon d'inscription commerçant non finalisée (mig 0414) de la
 * liste « à recontacter » — traité/injoignable/spam. La ligne reste en base
 * (status='dismissed') pour l'historique.
 */
export async function dismissSignupDraft(
  draftId: string
): Promise<{ error?: string }> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  if (!/^[0-9a-f-]{36}$/i.test(draftId))
    return { error: "Brouillon invalide." };

  // Table verrouillée RLS sans policy → service_role, accès casté.
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    update: (v: Record<string, unknown>) => {
      eq: (
        c: string,
        v: string
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  const { error } = await from("merchant_signup_drafts")
    .update({ status: "dismissed", updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) return { error: error.message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: "dismiss_signup_draft",
    target_kind: "merchant_signup_draft",
    target_id: draftId,
    note: null,
  });

  revalidatePath("/admin/merchants");
  return {};
}

/**
 * Gel d'un livreur (anti-fraude / sanction administrative).
 * Un livreur gelé reste connecté mais voit un écran "compte gelé" sur
 * `/driver` ; il ne peut plus rien faire jusqu'au dégel.
 */
export async function toggleDriverFrozen(
  driverId: string,
  frozen: boolean,
  note?: string
): Promise<{ error?: string }> {
  if (!(await adminCan("livraison"))) return { error: "Accès refusé." };

  // ⚠️ La table `drivers` n'a PAS de policy UPDATE super-admin (seulement
  // `drivers_update_self`). Un update via la session admin matchait 0 ligne →
  // le gel ne s'appliquait jamais. On passe par le service-role (bypass RLS).
  const admin = createAdminClient();
  const { error, count } = await admin
    .from("drivers")
    .update(
      {
        is_frozen: frozen,
        frozen_at: frozen ? new Date().toISOString() : null,
        freeze_reason: frozen ? (note ?? null) : null,
      },
      { count: "exact" }
    )
    .eq("id", driverId);
  if (error) return { error: error.message };
  if (!count) return { error: "Livreur introuvable." };

  // Gel → sortie IMMÉDIATE de toutes les files de réception (en plus du garde
  // `is_frozen` déjà vérifié dans pull_next_express*/set_driver_availability).
  if (frozen) {
    const { data: mds } = await admin
      .from("merchant_drivers")
      .select("id")
      .eq("driver_id", driverId);
    const ids = (mds ?? []).map((m) => m.id);
    if (ids.length) {
      await admin
        .from("driver_availability")
        .update({ status: "offline" })
        .in("merchant_driver_id", ids)
        .neq("status", "busy"); // on ne casse pas une course en cours
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await admin.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: frozen ? "freeze_driver" : "unfreeze_driver",
    target_kind: "driver",
    target_id: driverId,
    note: note ?? null,
  });

  revalidatePath("/admin/drivers");
  revalidatePath(`/admin/drivers/${driverId}`);
  return {};
}

/**
 * BLOCAGE d'un livreur (sanction DURE : dangereux / suspect / violation).
 * Différent du gel : un livreur bloqué n'a PLUS accès à ses pages (juste un
 * message « compte bloqué » + la nav). L'activité est suspendue aussi.
 */
export async function toggleDriverBlocked(
  driverId: string,
  blocked: boolean,
  note?: string
): Promise<{ error?: string }> {
  if (!(await adminCan("livraison"))) return { error: "Accès refusé." };

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("drivers")
    .update(
      {
        is_blocked: blocked,
        blocked_at: blocked ? new Date().toISOString() : null,
        block_reason: blocked ? (note ?? null) : null,
      },
      { count: "exact" }
    )
    .eq("id", driverId);
  if (error) return { error: error.message };
  if (!count) return { error: "Livreur introuvable." };

  // Blocage → sortie immédiate des files (en plus du garde is_blocked SQL).
  if (blocked) {
    const { data: mds } = await admin
      .from("merchant_drivers")
      .select("id")
      .eq("driver_id", driverId);
    const ids = (mds ?? []).map((m) => m.id);
    if (ids.length) {
      await admin
        .from("driver_availability")
        .update({ status: "offline" })
        .in("merchant_driver_id", ids)
        .neq("status", "busy");
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // KILL-SWITCH : au blocage, on coupe la session ACTIVE du livreur tout de
  // suite (révocation GoTrue). La RPC est gardée par is_super_admin() côté SQL
  // → on l'appelle avec la SESSION admin (pas le service-role, qui n'a pas de
  // JWT). Best-effort : ne jamais faire échouer le blocage si la révocation
  // rate (le layout `(driver)` bloque déjà l'accès au prochain rendu).
  if (blocked) {
    try {
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      await rpc("admin_force_driver_signout", { p_driver_id: driverId });
    } catch {
      /* noop : révocation best-effort */
    }
  }

  await admin.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: blocked ? "block_driver" : "unblock_driver",
    target_kind: "driver",
    target_id: driverId,
    note: note ?? null,
  });

  revalidatePath("/admin/drivers");
  revalidatePath(`/admin/drivers/${driverId}`);
  return {};
}

/**
 * Déconnexion FORCÉE d'un livreur (indépendante du blocage) : révoque ses
 * sessions GoTrue. Utile pour couper un accès suspect / un appareil perdu sans
 * geler ni bloquer le compte.
 */
export async function forceDriverSignout(
  driverId: string
): Promise<{ error?: string; killed?: number }> {
  if (!(await adminCan("livraison"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_force_driver_signout", {
    p_driver_id: driverId,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    sessions_killed?: number;
  };
  if (!res.ok) {
    return {
      error:
        res.reason === "no_user" ? "Ce livreur n'a pas de session." : "Échec.",
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await createAdminClient()
    .from("admin_audit_log")
    .insert({
      admin_email: user?.email ?? null,
      action: "force_signout_driver",
      target_kind: "driver",
      target_id: driverId,
      note: `${res.sessions_killed ?? 0} session(s)`,
    });
  return { killed: res.sessions_killed ?? 0 };
}

// =============================================================================
// Remplissage AUTOMATIQUE du catalogue d'un commerçant (super-admin).
// =============================================================================
// Le super-admin remplit le magasin d'un commerçant à partir d'un MODÈLE Coligo
// (catégories + produits courants, prix indicatifs) selon son type de commerce.
// Le commerçant ajuste ensuite prix / détails / photos (tout est éditable).
//
// - Données 100 % possédées (cf. lib/config/catalog-templates) — aucune copie
//   d'un catalogue tiers, aucune photo importée (le commerçant ajoute les siennes).
// - Service-role : l'admin agit sur le magasin d'un AUTRE commerçant (hors RLS).
// - IDEMPOTENT : on n'ajoute pas une catégorie / un produit déjà présents (par
//   titre / nom) → on peut relancer sans créer de doublons.
// =============================================================================
export type SeedCatalogResult =
  | { ok: true; categoriesAdded: number; productsAdded: number; label: string }
  | { ok: false; error: string };

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export async function seedMerchantCatalog(
  merchantId: string,
  templateType?: string
): Promise<SeedCatalogResult> {
  if (!(await adminCan("commercants")))
    return { ok: false, error: "Accès refusé." };
  if (!merchantId) return { ok: false, error: "Commerçant manquant." };

  const admin = createAdminClient();

  const { data: merchant, error: mErr } = await admin
    .from("merchants")
    .select("id, category")
    .eq("id", merchantId)
    .maybeSingle();
  if (mErr || !merchant) return { ok: false, error: "Commerçant introuvable." };

  const type = (templateType || merchant.category || "").trim();
  const tpl = getCatalogTemplate(type);
  if (!tpl) {
    return {
      ok: false,
      error: `Aucun modèle de catalogue pour le type « ${type || "?"} ».`,
    };
  }

  // État existant (idempotence par titre de catégorie / nom de produit).
  const { data: existCats } = await admin
    .from("categories")
    .select("id, title")
    .eq("merchant_id", merchantId);
  const catIdByTitle = new Map<string, string>();
  for (const c of existCats ?? []) catIdByTitle.set(norm(c.title), c.id);

  const { data: existProds } = await admin
    .from("products")
    .select("name_fr")
    .eq("merchant_id", merchantId);
  const prodNames = new Set<string>(
    (existProds ?? []).map((p) => norm(p.name_fr))
  );

  let categoriesAdded = 0;
  let productsAdded = 0;
  let position = existCats?.length ?? 0;

  for (const cat of tpl.categories) {
    let categoryId = catIdByTitle.get(norm(cat.title));
    if (!categoryId) {
      const { data: insCat, error: cErr } = await admin
        .from("categories")
        .insert({
          merchant_id: merchantId,
          title: cat.title,
          position: position++,
        })
        .select("id")
        .single();
      if (cErr || !insCat) continue;
      categoryId = insCat.id;
      catIdByTitle.set(norm(cat.title), categoryId);
      categoriesAdded++;
    }

    const rows = cat.products
      .filter((p) => !prodNames.has(norm(p.name_fr)))
      .map((p) => ({
        merchant_id: merchantId,
        name_fr: p.name_fr,
        name_ar: p.name_ar ?? null,
        price_da: p.price_da,
        unit: p.unit ?? "piece",
        category_id: categoryId ?? null,
        is_available: true,
      }));

    if (rows.length > 0) {
      const { error: pErr } = await admin.from("products").insert(rows);
      if (!pErr) {
        for (const r of rows) prodNames.add(norm(r.name_fr));
        productsAdded += rows.length;
      }
    }
  }

  // Audit : qui a rempli, quel magasin, combien.
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  await admin.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: "seed_catalog",
    target_kind: "merchant",
    target_id: merchantId,
    note: `${tpl.label} · +${categoriesAdded} cat. / +${productsAdded} produits`,
  });

  revalidatePath("/admin/merchants");
  return { ok: true, categoriesAdded, productsAdded, label: tpl.label };
}

// =============================================================================
// Modération des signalements de livraison (super-admin).
// =============================================================================
export async function resolveDeliveryReport(input: {
  reportId: string;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  note?: string | null;
}): Promise<AdminFormState> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_resolve_delivery_report", {
    p_report_id: input.reportId,
    p_status: input.status,
    p_note: input.note ?? null,
  });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; reason?: string | null }
    | undefined;
  if (!row?.ok) return { error: row?.reason ?? "Échec." };
  revalidatePath("/admin/reports");
  return { ok: true };
}

/**
 * Modération d'un signalement de COURSE (Drive, mig 0288). open / reviewed /
 * dismissed (+ décision libre optionnelle). Gardé is_super_admin (RPC + ici).
 */
export async function resolveRideReport(input: {
  reportId: string;
  status: "open" | "reviewed" | "dismissed";
  decision?: string | null;
}): Promise<AdminFormState> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "admin_resolve_ride_report" as never,
    {
      p_report_id: input.reportId,
      p_status: input.status,
      p_decision: input.decision ?? null,
    } as never
  );
  if (error) return { error: error.message };
  revalidatePath("/admin/reports");
  return { ok: true };
}

// =============================================================================
// Pouvoirs super-admin sur les commandes (mig 0097, module avancé 0337-0338).
// =============================================================================

/** IP client (même extraction que la télémétrie : x-forwarded-for en tête). */
async function clientIp(): Promise<string | null> {
  try {
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

async function logAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: string,
  orderId: string,
  note?: string | null,
  values?: {
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
  }
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Colonnes old_value/new_value/ip (mig 0337) hors types générés → cast.
    const from = supabase.from.bind(supabase) as unknown as (t: string) => {
      insert: (v: Record<string, unknown>) => Promise<{ error: unknown }>;
    };
    await from("admin_audit_log").insert({
      admin_email: user?.email ?? null,
      action,
      target_kind: "order",
      target_id: orderId,
      note: note ?? null,
      old_value: values?.oldValue ?? null,
      new_value: values?.newValue ?? null,
      ip: await clientIp(),
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action métier */
  }
}

/** Revalide la liste ET la fiche d'une commande. */
function refreshOrder(orderId: string) {
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
}

/** Super-admin valide une livraison (sans code, sans être le livreur). */
export async function adminValidateDelivery(
  orderId: string,
  note?: string
): Promise<AdminFormState> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_validate_delivery", {
    p_order_id: orderId,
    p_note: note ?? null,
  });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; reason?: string | null }
    | undefined;
  if (!row?.ok && row?.reason && row.reason !== "already_delivered") {
    return { error: row.reason };
  }
  await logAdmin(supabase, "validate_delivery", orderId, note, {
    newValue: { status: "completed" },
  });

  try {
    const { notifyCustomerStatusChange, notifyDriverCourseClosed } =
      await import("@/lib/fcm/triggers");
    await notifyCustomerStatusChange({ orderId, newStatus: "completed" });
    // Le livreur affecté est prévenu que sa course est CLÔTURÉE (sinon son
    // appareil reste bloqué sur la course — incident du 07/07). Le pop-up
    // temps réel (DriverCancelWatch) couvre l'app ouverte ; le push couvre
    // l'arrière-plan.
    await notifyDriverCourseClosed({ orderId });
  } catch {
    /* noop */
  }

  refreshOrder(orderId);
  return { ok: true };
}

/** Super-admin annule une commande à n'importe quelle étape (suivi conservé). */
export async function adminCancelOrder(
  orderId: string,
  reason: string
): Promise<AdminFormState> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_cancel_order", {
    p_order_id: orderId,
    p_reason: reason ?? null,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    from_status?: string;
    refunded_da?: number;
    merchant_id?: string;
    order_number?: string | null;
    customer_name?: string | null;
  };
  if (!res.ok) {
    return {
      error:
        res.reason === "already_terminal"
          ? "Commande déjà terminée ou annulée."
          : "Annulation impossible.",
    };
  }
  await logAdmin(supabase, "cancel_order", orderId, reason, {
    oldValue: res.from_status ? { status: res.from_status } : null,
    newValue: {
      status: "cancelled",
      ...(res.refunded_da ? { refunded_da: res.refunded_da } : {}),
    },
  });
  // Anti-fraude : trace de l'annulation admin (phase, position livreur)
  {
    const { fraudIngestCancel } = await import("@/lib/fraud/events");
    void fraudIngestCancel("order", orderId, "admin");
  }

  // Notifications best-effort (jamais bloquantes).
  try {
    const {
      notifyMerchantOrderCancelled,
      notifyCustomerStatusChange,
      notifyDriverOrderCancelled,
    } = await import("@/lib/fcm/triggers");
    if (res.merchant_id) {
      await notifyMerchantOrderCancelled({
        merchantId: res.merchant_id,
        orderId,
        orderRef: res.order_number ?? null,
        customerName: res.customer_name ?? null,
      });
    }
    await notifyCustomerStatusChange({ orderId, newStatus: "cancelled" });
    // Stoppe le livreur affecté (push + pop-up temps réel via DriverCancelWatch).
    await notifyDriverOrderCancelled({ orderId });
  } catch {
    /* noop */
  }

  refreshOrder(orderId);
  return { ok: true };
}

/**
 * Support/super-admin CONFIRME un no-show d'une commande PRÉPAYÉE EN LIGNE : le
 * commerçant/livreur a signalé un client injoignable malgré le paiement. On
 * traite la commande COMME LIVRÉE (statut No-Show) → livreur + commerçant payés
 * comme une livraison, cashback conservé au client (mig 0328). RPC réservée au
 * service_role → on l'appelle via le client admin après contrôle du domaine.
 */
export async function confirmOnlineNoShow(
  orderId: string,
  note?: string
): Promise<AdminFormState> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_confirm_online_noshow", {
    p_order_id: orderId,
    p_admin_email: user?.email ?? null,
    p_note: note?.trim() || null,
  });
  if (error) return { error: error.message };
  const res = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; reason?: string }
    | undefined;
  if (!res?.ok) {
    const M: Record<string, string> = {
      order_not_found: "Commande introuvable.",
      not_a_delivery: "Ce n'est pas une commande en livraison.",
      not_online_paid: "Réservé aux commandes payées en ligne.",
      already_completed: "Commande déjà livrée.",
      already_cancelled: "Commande déjà annulée.",
      no_driver: "Aucun livreur attribué à cette commande.",
    };
    return { error: M[res?.reason ?? ""] ?? "Confirmation impossible." };
  }

  try {
    const { notifyCustomerStatusChange, notifyDriverCourseClosed } =
      await import("@/lib/fcm/triggers");
    await notifyCustomerStatusChange({ orderId, newStatus: "completed" });
    // No-show confirmé = payé comme livré : le livreur qui attendait chez le
    // client est prévenu que sa course est clôturée et créditée.
    await notifyDriverCourseClosed({ orderId });
  } catch {
    /* noop */
  }

  refreshOrder(orderId);
  return { ok: true };
}

/** Super-admin crédite/rembourse le wallet d'un commerçant pour une commande. */
export async function adminRefundMerchant(
  orderId: string,
  amountDa: number,
  reason: string
): Promise<AdminFormState> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };
  const amt = Math.floor(Number(amountDa));
  if (!Number.isFinite(amt) || amt < 1) return { error: "Montant invalide." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_refund_merchant_wallet", {
    p_order_id: orderId,
    p_amount_da: amt,
    p_reason: reason ?? null,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!res.ok) {
    return {
      error:
        res.reason === "already_refunded"
          ? "Cette commande a déjà été remboursée au commerçant."
          : res.reason === "bad_amount"
            ? "Montant invalide."
            : "Remboursement impossible.",
    };
  }
  await logAdmin(supabase, "refund_merchant", orderId, reason, {
    newValue: { merchant_refund_da: amt },
  });
  refreshOrder(orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Réclamations d'avance no-show (mig 0160). Le livreur a avancé (P − commission)
// au commerçant au pickup d'une commande COD finie en no-show ; le support
// valide (et décide du sort de la marchandise) ou refuse. La RPC (service role
// uniquement) écrit le ledger + l'audit de façon atomique.
// ---------------------------------------------------------------------------
export async function resolveDriverRefundClaim(input: {
  claimId: string;
  approve: boolean;
  goodsDecision?: "return_to_merchant" | "driver_keeps" | "give_away";
  note?: string;
}): Promise<AdminFormState> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  if (input.approve && !input.goodsDecision) {
    return { error: "Choisis le sort de la marchandise avant de valider." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  // RPC pas (encore) dans database.types → cast as never, comme les autres RPC admin.
  const { data, error } = await admin.rpc(
    "admin_resolve_driver_refund_claim" as never,
    {
      p_claim_id: input.claimId,
      p_approve: input.approve,
      p_goods_decision: input.goodsDecision ?? null,
      p_note: input.note?.trim() || null,
      p_admin_email: user?.email ?? null,
    } as never
  );
  if (error) return { error: error.message };
  const row = (
    data as Array<{ ok: boolean; reason: string | null }> | null
  )?.[0];
  if (!row?.ok) {
    return {
      error:
        row?.reason === "already_resolved"
          ? "Réclamation déjà traitée."
          : row?.reason === "goods_decision_required"
            ? "Choisis le sort de la marchandise avant de valider."
            : "Traitement impossible.",
    };
  }
  revalidatePath("/admin/reports");
  return { ok: true };
}

// =============================================================================
// Gestion avancée des commandes (mig 0337-0338) — fiche /admin/orders/[id].
// =============================================================================

type AdminRpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

/**
 * Réattribution d'une commande depuis la FICHE COMMANDE : remise au réseau
 * (`pool`) ou attribution directe (`driver`). La RPC (0338) libère l'ancien
 * livreur, remet les horodatages de prise à zéro et trace `order_events`.
 * Notifs : ancien livreur (course retirée) + réseau OU nouveau livreur.
 */
export async function adminReassignOrderDriver(input: {
  orderId: string;
  mode: "pool" | "driver";
  targetDriverId?: string | null;
  reason?: string | null;
}): Promise<AdminFormState> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as AdminRpc;
  const { data, error } = await rpc("admin_reassign_delivery", {
    p_order_id: input.orderId,
    p_mode: input.mode,
    p_driver_id: input.targetDriverId ?? null,
  });
  if (error) return { error: error.message };

  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    old_driver_id?: string | null;
    new_driver_id?: string | null;
    order_number?: string | null;
  };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      order_not_found: "Commande introuvable.",
      not_delivery: "Ce n'est pas une commande de livraison.",
      already_terminal: "Commande déjà terminée ou annulée.",
      driver_required: "Choisis un livreur cible.",
      driver_unavailable: "Livreur cible introuvable, gelé ou bloqué.",
      bad_mode: "Mode invalide.",
    };
    return { error: map[res.reason ?? ""] ?? "Réattribution impossible." };
  }

  await logAdmin(
    supabase,
    input.mode === "pool" ? "reassign_order_pool" : "reassign_order_driver",
    input.orderId,
    input.reason ?? null,
    {
      oldValue: { driver_id: res.old_driver_id ?? null },
      newValue: { driver_id: res.new_driver_id ?? null },
    }
  );

  // Notifications best-effort (jamais bloquantes).
  try {
    const {
      notifyDriverOrderWithdrawn,
      notifyDriverOrderAssigned,
      notifyDriversNewExpress,
    } = await import("@/lib/fcm/triggers");
    if (res.old_driver_id) {
      await notifyDriverOrderWithdrawn({
        driverId: res.old_driver_id,
        orderId: input.orderId,
        orderRef: res.order_number ?? null,
      });
    }
    if (input.mode === "driver" && res.new_driver_id) {
      await notifyDriverOrderAssigned({
        driverId: res.new_driver_id,
        orderId: input.orderId,
        orderRef: res.order_number ?? null,
      });
    } else {
      // Remise au réseau : re-broadcast comme une nouvelle course express.
      await notifyDriversNewExpress({ orderId: input.orderId });
    }
  } catch {
    /* noop */
  }

  refreshOrder(input.orderId);
  revalidatePath("/admin/drivers");
  return { ok: true };
}

/**
 * Remise au CANAL DE PROPOSITION d'une livraison ANNULÉE (façon Uber) : la
 * commande repasse 'ready', l'attribution et les refus sont purgés (fresh
 * start) et le réseau est re-notifié comme pour une nouvelle course express.
 * La RPC (0358) refuse si livrée ou déjà remboursée (aucun risque financier).
 */
export async function adminRequeueCancelledDelivery(input: {
  orderId: string;
  reason?: string | null;
}): Promise<AdminFormState> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as AdminRpc;
  const { data, error } = await rpc("admin_requeue_cancelled_delivery", {
    p_order_id: input.orderId,
    p_reason: input.reason ?? null,
  });
  if (error) return { error: error.message };

  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      order_not_found: "Commande introuvable.",
      not_delivery: "Ce n'est pas une commande de livraison.",
      not_cancelled: "La commande n'est pas annulée.",
      already_delivered: "Commande déjà livrée : rien à re-proposer.",
      already_refunded:
        "Un remboursement a déjà été émis : remise au canal impossible.",
    };
    return { error: map[res.reason ?? ""] ?? "Remise au canal impossible." };
  }

  await logAdmin(
    supabase,
    "requeue_cancelled_order",
    input.orderId,
    input.reason ?? null,
    {
      oldValue: { status: "cancelled" },
      newValue: { status: "ready" },
    }
  );

  // Re-broadcast au réseau comme une NOUVELLE course express (best-effort).
  try {
    const { notifyDriversNewExpress } = await import("@/lib/fcm/triggers");
    await notifyDriversNewExpress({ orderId: input.orderId });
  } catch {
    /* noop */
  }

  refreshOrder(input.orderId);
  return { ok: true };
}

/**
 * Indemnise un livreur sur une commande (montant personnalisable + motif
 * OBLIGATOIRE). UNE indemnité max par commande (garde structurelle en base).
 * L'écriture arrive « à recevoir » sur le prochain relevé du livreur.
 */
export async function adminCompensateDriver(input: {
  orderId: string;
  driverId: string;
  amountDa: number;
  reason: string;
}): Promise<AdminFormState> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };
  const amt = Math.floor(Number(input.amountDa));
  if (!Number.isFinite(amt) || amt < 1 || amt > 20000) {
    return { error: "Montant invalide (1 à 20 000 DA)." };
  }
  const reason = input.reason?.trim();
  if (!reason) return { error: "Le motif est obligatoire." };

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as AdminRpc;
  const { data, error } = await rpc("admin_compensate_driver", {
    p_order_id: input.orderId,
    p_driver_id: input.driverId,
    p_amount_da: amt,
    p_note: reason,
  });
  if (error) return { error: error.message };

  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    order_number?: string | null;
  };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      bad_amount: "Montant invalide (1 à 20 000 DA).",
      note_required: "Le motif est obligatoire.",
      order_not_found: "Commande introuvable.",
      driver_not_found: "Livreur introuvable.",
      already_compensated:
        "Ce livreur a déjà été indemnisé sur cette commande.",
    };
    return { error: map[res.reason ?? ""] ?? "Indemnisation impossible." };
  }

  await logAdmin(supabase, "compensate_driver", input.orderId, reason, {
    newValue: { driver_id: input.driverId, compensation_da: amt },
  });

  try {
    const { notifyDriverCompensation } = await import("@/lib/fcm/triggers");
    await notifyDriverCompensation({
      driverId: input.driverId,
      amountDa: amt,
      orderRef: res.order_number ?? null,
    });
  } catch {
    /* noop */
  }

  refreshOrder(input.orderId);
  return { ok: true };
}

/**
 * Décision explicite de NE PAS indemniser un livreur (motif obligatoire).
 * Aucune écriture financière — uniquement l'audit : la décision est tracée
 * et visible dans l'historique de la fiche.
 */
export async function adminDecideNoCompensation(input: {
  orderId: string;
  driverId: string | null;
  reason: string;
}): Promise<AdminFormState> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };
  const reason = input.reason?.trim();
  if (!reason) return { error: "Le motif est obligatoire." };

  const supabase = await createClient();
  await logAdmin(supabase, "no_compensation", input.orderId, reason, {
    newValue: { driver_id: input.driverId, compensation_da: 0 },
  });
  refreshOrder(input.orderId);
  return { ok: true };
}

/**
 * Remboursement MANUEL du client (partiel ou total) → crédit Coligo Pay.
 * Réservé aux commandes TERMINÉES (une commande en cours s'annule : le circuit
 * d'annulation rembourse déjà tout). Plafonné à ce que le client a réellement
 * payé, anti-double via cumul `orders.admin_refunded_da` (FOR UPDATE en base).
 */
export async function adminRefundCustomer(input: {
  orderId: string;
  amountDa: number;
  reason: string;
}): Promise<AdminFormState & { remainingDa?: number }> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };
  const amt = Math.floor(Number(input.amountDa));
  if (!Number.isFinite(amt) || amt < 1) return { error: "Montant invalide." };
  const reason = input.reason?.trim();
  if (!reason) return { error: "Le motif est obligatoire." };

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as AdminRpc;
  const { data, error } = await rpc("admin_refund_customer", {
    p_order_id: input.orderId,
    p_amount_da: amt,
    p_note: reason,
  });
  if (error) return { error: error.message };

  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    remaining_da?: number;
    total_refunded_da?: number;
    payment_status?: string;
  };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      bad_amount: "Montant invalide.",
      note_required: "Le motif est obligatoire.",
      order_not_found: "Commande introuvable.",
      no_customer:
        "Commande sans compte client (pas de portefeuille à créditer).",
      cancelled_already_refunded:
        "Commande annulée : le remboursement a déjà été effectué automatiquement.",
      not_completed_use_cancel:
        "Commande non terminée : utilise l'annulation (elle rembourse tout automatiquement).",
      nothing_refundable: "Plus rien à rembourser sur cette commande.",
      exceeds_refundable: `Montant supérieur au remboursable restant (${res.remaining_da ?? 0} DA).`,
    };
    return {
      error: map[res.reason ?? ""] ?? "Remboursement impossible.",
      remainingDa: res.remaining_da,
    };
  }

  await logAdmin(supabase, "refund_customer", input.orderId, reason, {
    newValue: {
      refund_da: amt,
      total_refunded_da: res.total_refunded_da ?? amt,
      payment_status: res.payment_status ?? null,
    },
  });

  try {
    const { notifyCustomerRefund } = await import("@/lib/fcm/triggers");
    await notifyCustomerRefund({ orderId: input.orderId, amountDa: amt });
  } catch {
    /* noop */
  }

  refreshOrder(input.orderId);
  return { ok: true };
}

/**
 * Marque une livraison en ÉCHEC : pose delivery_failed_at + motif puis annule
 * via le circuit standard (remboursements + libération livreur + notifs).
 */
export async function adminMarkDeliveryFailed(
  orderId: string,
  reason: string
): Promise<AdminFormState> {
  if (!(await adminCan("pilotage"))) return { error: "Accès refusé." };
  const clean = reason?.trim();
  if (!clean) return { error: "Le motif est obligatoire." };

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as AdminRpc;
  const { data, error } = await rpc("admin_mark_delivery_failed", {
    p_order_id: orderId,
    p_reason: clean,
  });
  if (error) return { error: error.message };

  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    from_status?: string;
    merchant_id?: string;
    order_number?: string | null;
    customer_name?: string | null;
  };
  if (!res.ok) {
    const map: Record<string, string> = {
      forbidden: "Accès refusé.",
      order_not_found: "Commande introuvable.",
      not_delivery: "Ce n'est pas une commande de livraison.",
      already_terminal: "Commande déjà terminée ou annulée.",
    };
    return {
      error: map[res.reason ?? ""] ?? "Échec impossible à enregistrer.",
    };
  }

  await logAdmin(supabase, "mark_delivery_failed", orderId, clean, {
    oldValue: res.from_status ? { status: res.from_status } : null,
    newValue: { status: "cancelled", delivery_failed: true },
  });

  try {
    const {
      notifyMerchantOrderCancelled,
      notifyCustomerStatusChange,
      notifyDriverOrderCancelled,
    } = await import("@/lib/fcm/triggers");
    if (res.merchant_id) {
      await notifyMerchantOrderCancelled({
        merchantId: res.merchant_id,
        orderId,
        orderRef: res.order_number ?? null,
        customerName: res.customer_name ?? null,
      });
    }
    await notifyCustomerStatusChange({ orderId, newStatus: "cancelled" });
    await notifyDriverOrderCancelled({ orderId });
  } catch {
    /* noop */
  }

  refreshOrder(orderId);
  return { ok: true };
}
