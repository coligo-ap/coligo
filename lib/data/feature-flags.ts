import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { withTimeoutOrNull } from "@/lib/async/with-timeout";

// =============================================================================
// Feature flags — disponibilité des fonctionnalités pilotée par le super-admin
// (table feature_flags, mig 0182). 4 états :
//   active       → normal
//   hidden       → retiré du front + API bloquée (trigger DB)
//   coming_soon  → affiché grisé « bientôt disponible » + API bloquée
//   maintenance  → affiché + message perso (FR/AR) + API bloquée
// L'enforcement API est garanti côté DB (triggers) ; ces helpers servent le
// FRONT (masquer / griser / message) et les gardes server-action (UX propre).
// =============================================================================

export type FeatureKey =
  | "drive"
  | "online_payment"
  | "coligo_pay"
  | "cashback"
  | "express"
  | "tour"
  | "barcode_marketplace"
  | "barcode_merchant"
  | "identity_verification";
export type FeatureStatus = "active" | "hidden" | "coming_soon" | "maintenance";

export type FeatureFlag = {
  key: FeatureKey;
  status: FeatureStatus;
  title_fr: string | null;
  title_ar: string | null;
  message_fr: string | null;
  message_ar: string | null;
  /**
   * Coupure PERSONNELLE (mig 0397) : la fonctionnalité tourne normalement pour
   * les autres clients, elle est désactivée sur CE compte. On le dit
   * explicitement au client plutôt que de laisser croire à une panne.
   */
  personal?: boolean;
};

export const FEATURE_KEYS: FeatureKey[] = [
  "drive",
  "online_payment",
  "coligo_pay",
  "cashback",
  "express",
  "tour",
  "barcode_marketplace",
  "barcode_merchant",
  "identity_verification",
];

function defaultFlag(key: FeatureKey): FeatureFlag {
  return {
    key,
    status: "active",
    title_fr: null,
    title_ar: null,
    message_fr: null,
    message_ar: null,
  };
}

export type FeatureFlags = Record<FeatureKey, FeatureFlag>;

/**
 * Charge les 4 drapeaux (défaut 'active' si la ligne manque). Mémoïsé par requête
 * (React cache) → un seul SELECT même si plusieurs composants l'utilisent.
 */
export const getFeatureFlags = cache(async (): Promise<FeatureFlags> => {
  const out = Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, defaultFlag(k)])
  ) as FeatureFlags;
  try {
    const supabase = await createClient();
    // `feature_flags` (mig 0182) pas encore dans database.types.ts généré
    // (Docker requis) → cast local du `from`.
    const from = supabase.from.bind(supabase) as unknown as (t: string) => {
      select: (
        cols: string
      ) => Promise<{ data: Record<string, unknown>[] | null }>;
    };
    // BORNE OBLIGATOIRE : `getFeatureFlags` gate quasi CHAQUE page de chaque
    // espace (drive, coligo_pay, cashback, express, tour, IDV…) — un socket à
    // moitié mort au réveil d'arrière-plan ne doit JAMAIS laisser cet `await`
    // pendre, sinon c'est potentiellement toute page de tout domaine qui se
    // fige (« la page n'avance plus »). Timeout → défaut (tout actif), comme
    // les autres échecs déjà gérés ici.
    const result = await withTimeoutOrNull(
      from("feature_flags").select(
        "key, status, title_fr, title_ar, message_fr, message_ar"
      ),
      4000
    );
    for (const row of result?.data ?? []) {
      const key = row.key as FeatureKey;
      if (key in out) {
        out[key] = {
          key,
          status: (row.status as FeatureStatus) ?? "active",
          title_fr: (row.title_fr as string | null) ?? null,
          title_ar: (row.title_ar as string | null) ?? null,
          message_fr: (row.message_fr as string | null) ?? null,
          message_ar: (row.message_ar as string | null) ?? null,
        };
      }
    }
  } catch {
    /* défaut = tout actif (jamais bloquer le front sur une erreur de lecture) */
  }
  return out;
});

/**
 * Fonctionnalités coupées POUR LE COMPTE CONNECTÉ (mig 0397).
 *
 * RPC `my_blocked_features()` : elle ne renvoie QUE les coupures du client
 * courant (`auth.uid()`), donc rien à filtrer côté app. Mémoïsé par requête, et
 * borné comme la lecture des drapeaux globaux — cette fonction est appelée sur
 * quasi chaque écran client, elle ne doit jamais faire pendre un rendu.
 * Échec / non-connecté ⇒ aucune coupure (on ne bloque pas sur une lecture).
 */
export const getMyFeatureBlocks = cache(
  async (): Promise<Map<FeatureKey, string | null>> => {
    const out = new Map<FeatureKey, string | null>();
    try {
      const supabase = await createClient();
      // RPC hors types générés → bind OBLIGATOIRE (cf. reference_supabase_rpc_bind).
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string
      ) => Promise<{
        data: { feature: string; reason: string | null }[] | null;
      }>;
      const result = await withTimeoutOrNull(rpc("my_blocked_features"), 4000);
      for (const row of result?.data ?? []) {
        const key = row.feature as FeatureKey;
        if (FEATURE_KEYS.includes(key)) out.set(key, row.reason ?? null);
      }
    } catch {
      /* pas de coupure connue → comportement normal */
    }
    return out;
  }
);

/**
 * Drapeau EFFECTIF pour le client courant : le kill-switch global d'abord
 * (il concerne tout le monde), puis la coupure personnelle. Toutes les gardes
 * existantes (`status !== "active"`) couvrent donc aussi ce cas, sans qu'aucun
 * écran n'ait à connaître la notion de coupure par compte.
 */
export async function getFeatureFlag(key: FeatureKey): Promise<FeatureFlag> {
  const flag = (await getFeatureFlags())[key];
  if (flag.status !== "active") return flag;

  const blocks = await getMyFeatureBlocks();
  if (!blocks.has(key)) return flag;

  const reason = blocks.get(key) ?? null;
  return {
    ...flag,
    // `maintenance` = « visible mais inutilisable » : les gardes en place
    // s'appliquent telles quelles ; le libellé, lui, dit la vérité.
    status: "maintenance",
    personal: true,
    title_fr: "Désactivé sur votre compte",
    title_ar: "معطّل على حسابك",
    message_fr: reason
      ? `${reason} — contactez le support si vous pensez qu'il s'agit d'une erreur.`
      : "Cette fonctionnalité a été désactivée sur votre compte. Contactez le support pour en savoir plus.",
    message_ar: reason
      ? `${reason} — تواصل مع الدعم إن كنت تعتقد أن هناك خطأ.`
      : "تم تعطيل هذه الخدمة على حسابك. تواصل مع الدعم لمعرفة المزيد.",
  };
}

/** Visible dans le front ? (tout sauf 'hidden'). */
export function isVisible(f: FeatureFlag): boolean {
  return f.status !== "hidden";
}
/** Utilisable ? (uniquement 'active'). */
export function isUsable(f: FeatureFlag): boolean {
  return f.status === "active";
}
/** Affiché mais inutilisable (grisé/maintenance) ? */
export function isShownDisabled(f: FeatureFlag): boolean {
  return f.status === "coming_soon" || f.status === "maintenance";
}

/** Message à afficher selon la locale (repli FR puis null). */
export function featureMessage(f: FeatureFlag, locale: string): string | null {
  if (locale === "ar") return f.message_ar || f.message_fr || null;
  return f.message_fr || f.message_ar || null;
}
export function featureTitle(f: FeatureFlag, locale: string): string | null {
  if (locale === "ar") return f.title_ar || f.title_fr || null;
  return f.title_fr || f.title_ar || null;
}
