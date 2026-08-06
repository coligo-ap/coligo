import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Réglages du PARTAGE STORY post-commande (mig 0440) — pilotés depuis
 * Marketing > Story : activation + design de la story générée. Lecture
 * service_role (table sans policy) ; config NON sensible consommée par la
 * page commande (serveur) et l'admin.
 */
export type StoryDesign = "violet" | "rose" | "nuit" | "ambre";

export type ShareStorySettings = {
  enabled: boolean;
  design: StoryDesign;
};

const DEFAULTS: ShareStorySettings = { enabled: true, design: "violet" };

export async function getShareStorySettings(): Promise<ShareStorySettings> {
  try {
    const admin = createAdminClient();
    const { data } = await (
      admin.from as unknown as (t: string) => {
        select: (c: string) => {
          maybeSingle: () => Promise<{
            data: { enabled: boolean; design: StoryDesign } | null;
          }>;
        };
      }
    )("share_story_settings")
      .select("enabled, design")
      .maybeSingle();
    if (!data) return DEFAULTS;
    return { enabled: !!data.enabled, design: data.design ?? "violet" };
  } catch {
    // Indisponible → comportement historique (activé, design violet).
    return DEFAULTS;
  }
}
