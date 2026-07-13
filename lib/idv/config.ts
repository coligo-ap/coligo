import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getFeatureFlag, isUsable, isVisible } from "@/lib/data/feature-flags";
import type {
  IdvDocumentType,
  IdvGate,
  IdvModePublic,
  IdvProfile,
  IdvProfileRule,
} from "./types";

// =============================================================================
// IDV — chargement de la CONFIGURATION côté serveur (session utilisateur,
// RLS lecture seule). Mémoïsé par requête (React cache) comme feature-flags.
//
// Fail-safe : toute erreur de lecture ⇒ IDV DÉSACTIVÉ (on ne bloque jamais
// une inscription sur une panne de config — l'inverse des feature-flags qui
// retombent sur « actif »).
//
// Les SEUILS et la policy des modes ne passent PAS par ici : colonnes non
// accordées à `authenticated` (anti-gaming) — le pipeline les lira en
// service_role (étapes suivantes).
// =============================================================================

// Tables idv_* (mig 0367) pas encore dans database.types.ts généré (Docker
// requis) → même cast local du `from` que lib/data/feature-flags.ts.
type UntypedFrom = (t: string) => {
  select: (cols: string) => {
    order: (
      col: string,
      opts: { ascending: boolean }
    ) => Promise<{ data: Record<string, unknown>[] | null }>;
  };
};

async function untypedFrom(): Promise<UntypedFrom> {
  const supabase = await createClient();
  return supabase.from.bind(supabase) as unknown as UntypedFrom;
}

/** Colonnes de idv_modes accordées à `authenticated` (mig 0367) — un `*`
 *  échouerait sur les colonnes de seuils, volontairement non accordées. */
const MODE_PUBLIC_COLS =
  "key, label_fr, label_ar, description_fr, description_ar, position, enabled, max_attempts";

/** Modes de vérification ACTIFS, dans l'ordre d'affichage. */
export const getIdvModes = cache(async (): Promise<IdvModePublic[]> => {
  try {
    const from = await untypedFrom();
    const { data } = await from("idv_modes")
      .select(MODE_PUBLIC_COLS)
      .order("position", { ascending: true });
    return ((data ?? []) as IdvModePublic[]).filter((m) => m.enabled);
  } catch {
    return [];
  }
});

/** Types de documents ACTIFS, dans l'ordre d'affichage. */
export const getIdvDocumentTypes = cache(
  async (): Promise<IdvDocumentType[]> => {
    try {
      const from = await untypedFrom();
      const { data } = await from("idv_document_types")
        .select(
          "key, country, label_fr, label_ar, sides, mrz_format, enabled, position, expected_fields"
        )
        .order("position", { ascending: true });
      return ((data ?? []) as IdvDocumentType[]).filter((d) => d.enabled);
    } catch {
      return [];
    }
  }
);

/** Règles par profil, indexées par clé de profil. */
export const getIdvProfileRules = cache(
  async (): Promise<Record<string, IdvProfileRule>> => {
    try {
      const from = await untypedFrom();
      const { data } = await from("idv_profile_rules")
        .select(
          "profile, requirement, allowed_modes, default_mode, user_can_choose_mode"
        )
        .order("profile", { ascending: true });
      return Object.fromEntries(
        ((data ?? []) as IdvProfileRule[]).map((r) => [r.profile, r])
      );
    } catch {
      return {};
    }
  }
);

const GATE_DISABLED: IdvGate = {
  enabled: false,
  requirement: "disabled",
  allowedModes: [],
  defaultMode: "standard",
  userCanChooseMode: false,
};

/**
 * Porte d'entrée du parcours : combine le kill-switch global
 * (feature_flags 'identity_verification') et la règle du profil.
 * `enabled=false` ⇒ la fonctionnalité n'existe pas pour cet utilisateur
 * (ni écran, ni exigence) — c'est le levier « publier / retirer » du
 * super-admin, sans toucher au code.
 */
export const getIdvGate = cache(
  async (profile: IdvProfile): Promise<IdvGate> => {
    try {
      const [flag, rules] = await Promise.all([
        getFeatureFlag("identity_verification"),
        getIdvProfileRules(),
      ]);
      const rule = rules[profile];
      if (!rule || rule.requirement === "disabled") return GATE_DISABLED;
      // 'hidden' = retiré ; 'coming_soon'/'maintenance' = visible mais bloqué
      // → dans les deux cas le parcours ne doit pas s'engager.
      if (!isVisible(flag) || !isUsable(flag)) return GATE_DISABLED;
      return {
        enabled: true,
        requirement: rule.requirement,
        allowedModes: rule.allowed_modes,
        defaultMode: rule.default_mode,
        userCanChooseMode: rule.user_can_choose_mode,
      };
    } catch {
      return GATE_DISABLED;
    }
  }
);
