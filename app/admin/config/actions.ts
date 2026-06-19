"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/admin";
import {
  getConfigKeyHistory,
  type ConfigHistoryEntry,
} from "@/lib/data/config-registry";

export type ConfigActionState = { ok?: boolean; error?: string };

// =============================================================================
// Écriture d'UNE clé de config via le registre (bypass-proof : on ne peut écrire
// que des clés inscrites au registre, validées par type + bornes). La valeur est
// reçue en FORME DE STOCKAGE (rate 0–1, da/number entier, bool booléen, json
// tableau). L'historique est archivé automatiquement (trigger platform_settings).
// =============================================================================
export async function updateConfigValue(
  key: string,
  value: unknown
): Promise<ConfigActionState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };

  const supabase = await createClient();
  const { data: reg } = await supabase
    .from("platform_config_registry")
    .select("value_type, min_num, max_num, json_shape, is_active")
    .eq("key", key)
    .maybeSingle();

  if (!reg || !reg.is_active) {
    return { error: "Clé inconnue ou désactivée." };
  }

  const t = reg.value_type as string;
  let coerced: unknown;

  if (t === "bool") {
    if (typeof value !== "boolean")
      return { error: "Valeur booléenne attendue." };
    coerced = value;
  } else if (t === "json") {
    if (!Array.isArray(value)) return { error: "Liste de paliers attendue." };
    const fields =
      (reg.json_shape as { fields?: { name: string; type: string }[] } | null)
        ?.fields ?? [];
    coerced = (value as Record<string, unknown>[]).map((item) => {
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        const raw = item[f.name];
        if (raw === null || raw === "" || raw === undefined) {
          out[f.name] = null; // « au-delà » (up_to vide) toléré
        } else {
          const n = Number(raw);
          if (!Number.isFinite(n)) return { __err: true };
          out[f.name] = f.type === "rate" ? n : Math.round(n);
        }
      }
      return out;
    });
    if ((coerced as { __err?: boolean }[]).some((x) => x.__err)) {
      return { error: "Paliers invalides (valeurs numériques attendues)." };
    }
  } else {
    // rate | number | da → numérique
    const n = Number(value);
    if (!Number.isFinite(n)) return { error: "Valeur numérique attendue." };
    const min = reg.min_num as number | null;
    const max = reg.max_num as number | null;
    if (min !== null && n < min) return { error: `Minimum : ${min}.` };
    if (max !== null && n > max) return { error: `Maximum : ${max}.` };
    coerced = t === "rate" ? n : Math.round(n);
  }

  const { error } = await supabase
    .from("platform_settings")
    .update({ [key]: coerced, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) return { error: `Échec : ${error.message}` };
  revalidatePath("/admin/config");
  return { ok: true };
}

/** Historique d'une clé (chargé à la demande quand on déplie le panneau). */
export async function fetchKeyHistory(
  key: string
): Promise<ConfigHistoryEntry[]> {
  if (!(await isSuperAdmin())) return [];
  return getConfigKeyHistory(key);
}
