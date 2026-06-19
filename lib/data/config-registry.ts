import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Data layer de l'éditeur de config générique (/admin/config).
// Les métadonnées viennent de platform_config_registry ; la VALEUR de chaque clé
// vit dans la colonne homonyme de platform_settings ; l'historique de
// platform_settings_history (archivé automatiquement par le trigger 0012).
// =============================================================================

export type ConfigValueType = "rate" | "number" | "da" | "json" | "bool";

export type ConfigJsonField = {
  name: string;
  type: "da" | "number" | "rate";
  label_fr: string;
  label_ar: string;
};
export type ConfigJsonShape = {
  item_label_fr?: string;
  fields: ConfigJsonField[];
};

export type ConfigItem = {
  key: string;
  valueType: ConfigValueType;
  group: string;
  labelFr: string;
  labelAr: string;
  helpFr: string | null;
  helpAr: string | null;
  minNum: number | null;
  maxNum: number | null;
  stepNum: number | null;
  jsonShape: ConfigJsonShape | null;
  value: unknown;
};

export type ConfigHistoryEntry = {
  at: string;
  byEmail: string | null;
  before: unknown;
  after: unknown;
};

/** Registre actif + valeur courante de chaque clé, trié par groupe puis ordre. */
export async function getConfigRegistry(): Promise<ConfigItem[]> {
  const supabase = await createClient();
  const [{ data: reg }, { data: settings }] = await Promise.all([
    supabase
      .from("platform_config_registry")
      .select(
        "key, value_type, group_key, label_fr, label_ar, help_fr, help_ar, sort_order, min_num, max_num, step_num, json_shape"
      )
      .eq("is_active", true)
      .order("group_key", { ascending: true })
      .order("sort_order", { ascending: true }),
    supabase.from("platform_settings").select("*").eq("id", true).maybeSingle(),
  ]);

  const row = (settings ?? {}) as Record<string, unknown>;
  return (reg ?? []).map((r) => ({
    key: r.key as string,
    valueType: r.value_type as ConfigValueType,
    group: r.group_key as string,
    labelFr: r.label_fr as string,
    labelAr: r.label_ar as string,
    helpFr: (r.help_fr as string | null) ?? null,
    helpAr: (r.help_ar as string | null) ?? null,
    minNum: r.min_num as number | null,
    maxNum: r.max_num as number | null,
    stepNum: r.step_num as number | null,
    jsonShape: (r.json_shape as ConfigJsonShape | null) ?? null,
    value: row[r.key as string],
  }));
}

/** Historique des changements d'UNE clé (diff before→after, plus récents d'abord). */
export async function getConfigKeyHistory(
  key: string,
  limit = 20
): Promise<ConfigHistoryEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings_history")
    .select("changed_at, changed_by_email, before_data, after_data")
    .order("changed_at", { ascending: false })
    .limit(200);

  const out: ConfigHistoryEntry[] = [];
  for (const h of data ?? []) {
    const before = (h.before_data as Record<string, unknown> | null)?.[key];
    const after = (h.after_data as Record<string, unknown> | null)?.[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue; // cette clé n'a pas bougé
    out.push({
      at: h.changed_at as string,
      byEmail: (h.changed_by_email as string | null) ?? null,
      before,
      after,
    });
    if (out.length >= limit) break;
  }
  return out;
}
