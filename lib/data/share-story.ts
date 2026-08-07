import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Réglages du PARTAGE STORY post-commande (mig 0440) — pilotés depuis
 * Marketing > Story : activation + design de la story générée. Lecture
 * service_role (table sans policy) ; config NON sensible consommée par la
 * page commande (serveur) et l'admin.
 */
export type StoryDesign =
  | "violet"
  | "rose"
  | "nuit"
  | "ambre"
  | "emeraude"
  | "ocean"
  | "corail"
  | "or";

export type ShareStorySettings = {
  enabled: boolean;
  design: StoryDesign;
  /** Photo optionnelle (mig 0441) dessinée en fond de story sous le dégradé. */
  image_url: string | null;
};

const DEFAULTS: ShareStorySettings = {
  enabled: true,
  design: "violet",
  image_url: null,
};

export async function getShareStorySettings(): Promise<ShareStorySettings> {
  try {
    const admin = createAdminClient();
    const { data } = await (
      admin.from as unknown as (t: string) => {
        select: (c: string) => {
          maybeSingle: () => Promise<{
            data: {
              enabled: boolean;
              design: StoryDesign;
              image_url: string | null;
            } | null;
          }>;
        };
      }
    )("share_story_settings")
      .select("enabled, design, image_url")
      .maybeSingle();
    if (!data) return DEFAULTS;
    return {
      enabled: !!data.enabled,
      design: data.design ?? "violet",
      image_url: data.image_url ?? null,
    };
  } catch {
    // Indisponible → comportement historique (activé, design violet).
    return DEFAULTS;
  }
}
