import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  APP_THEMES,
  APP_THEME_MODELS,
  DEFAULT_APP_MODEL,
  DEFAULT_APP_THEME,
  type AppThemeKey,
  type AppThemeModel,
} from "@/lib/config/app-themes";

// =============================================================================
// Lecture du thème d'apparence (table app_theme, mig 0415), MISE EN CACHE
// serveur (unstable_cache, tag "app-theme") : lue par le layout RACINE à
// chaque requête → le cache évite un aller-retour DB par page. L'action admin
// setAppTheme fait revalidateTag("app-theme") → application immédiate.
// Client admin (env pur, pas de cookies) : unstable_cache interdit tout accès
// au contexte de requête ; la table est de toute façon en lecture publique.
// =============================================================================

export type AppThemeState = {
  theme: AppThemeKey;
  /** Modèle de design des héros (mig 0416) : blobs/vagues/halo/motifs. */
  model: AppThemeModel;
  /** Bandeau thémé sur l'accueil marketplace (false = accueil simple). */
  marketplaceHero: boolean;
  /** Catégories commerçants incluses DANS le design du héro (mig 0417). */
  heroCategories: boolean;
};

export const getAppTheme = unstable_cache(
  async (): Promise<AppThemeState> => {
    try {
      const admin = createAdminClient();
      const from = admin.from.bind(admin) as unknown as (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: boolean
          ) => {
            maybeSingle: () => Promise<{
              data: {
                theme: string;
                model: string | null;
                marketplace_hero: boolean;
                hero_categories: boolean | null;
              } | null;
            }>;
          };
        };
      };
      const { data } = await from("app_theme")
        .select("theme, model, marketplace_hero, hero_categories")
        .eq("id", true)
        .maybeSingle();
      const theme =
        data?.theme && data.theme in APP_THEMES
          ? (data.theme as AppThemeKey)
          : DEFAULT_APP_THEME;
      const model =
        data?.model && data.model in APP_THEME_MODELS
          ? (data.model as AppThemeModel)
          : DEFAULT_APP_MODEL;
      return {
        theme,
        model,
        marketplaceHero: data?.marketplace_hero === true,
        heroCategories: data?.hero_categories === true,
      };
    } catch {
      // Jamais bloquant : repli marque.
      return {
        theme: DEFAULT_APP_THEME,
        model: DEFAULT_APP_MODEL,
        marketplaceHero: false,
        heroCategories: false,
      };
    }
  },
  ["app-theme"],
  { revalidate: 300, tags: ["app-theme"] }
);

/**
 * Variables CSS posées sur <html> par le layout racine — consommées par les
 * héros d'auth (AuthCard/AuthScreen) avec repli violet marque si absentes.
 */
export function appThemeCssVars(theme: AppThemeKey): Record<string, string> {
  const t = APP_THEMES[theme];
  return {
    "--auth-g1": t.g1,
    "--auth-g2": t.g2,
    "--auth-g3": t.g3,
    "--auth-blob-a": t.blobA,
    "--auth-blob-b": t.blobB,
  };
}
