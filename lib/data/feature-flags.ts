import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

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
  | "barcode_merchant";
export type FeatureStatus = "active" | "hidden" | "coming_soon" | "maintenance";

export type FeatureFlag = {
  key: FeatureKey;
  status: FeatureStatus;
  title_fr: string | null;
  title_ar: string | null;
  message_fr: string | null;
  message_ar: string | null;
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
    const { data } = await from("feature_flags").select(
      "key, status, title_fr, title_ar, message_fr, message_ar"
    );
    for (const row of data ?? []) {
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

export async function getFeatureFlag(key: FeatureKey): Promise<FeatureFlag> {
  return (await getFeatureFlags())[key];
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
