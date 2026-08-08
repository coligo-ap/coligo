import { Flag, Moon, Percent, Snowflake, Sparkles, Sun } from "lucide-react";
import {
  APP_THEMES,
  themeGradientVertical,
  type AppThemeKey,
  type AppThemeModel,
} from "@/lib/config/app-themes";
import { ThemeDecor } from "@/components/shared/theme-decor";

const ICONS = {
  sparkles: Sparkles,
  moon: Moon,
  sun: Sun,
  snowflake: Snowflake,
  percent: Percent,
  flag: Flag,
} as const;

/**
 * Héro « occasion » INTÉGRÉ de l'accueil marketplace (mig 0415/0416, activé
 * par le super-admin — désactivé = accueil simple, rien n'est rendu).
 *
 * Il forme UN SEUL bloc coloré avec le header (peint en `g1` uni par
 * CustomerHeader sur la route « / ») : ici le dégradé VERTICAL part de g1 →
 * aucune couture. La barre de recherche de la page vient FLOTTER dessus
 * (marge négative) : le bloc réserve l'espace en bas (pb) et arrondit ses
 * angles sous elle. Décor selon le MODÈLE choisi (blobs/vagues/halo/motifs).
 */
export function HomeThemeHero({
  theme,
  model,
  locale,
  extended = false,
}: {
  theme: AppThemeKey;
  model: AppThemeModel;
  locale: string;
  /** mig 0417 : le dégradé englobe AUSSI la bande de catégories. */
  extended?: boolean;
}) {
  const t = APP_THEMES[theme];
  const lang = locale === "ar" ? "ar" : locale === "en" ? "en" : "fr";
  const Icon = ICONS[t.homeIcon];
  return (
    <div
      className={
        extended
          ? "relative -mb-[168px] overflow-hidden rounded-b-2xl pb-[180px] text-white"
          : "relative -mb-[72px] overflow-hidden rounded-b-2xl pb-[84px] text-white"
      }
      style={{ backgroundImage: themeGradientVertical(t) }}
    >
      <ThemeDecor model={model} a={t.blobA} b={t.blobB} />
      <div className="relative z-10 mx-auto flex max-w-[1400px] items-center gap-3 px-4 pt-1 lg:px-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15 shadow-inner shadow-white/10">
          <Icon className="size-5 drop-shadow-sm" />
        </div>
        <div className="min-w-0">
          <p className="text-title-lg leading-tight font-bold drop-shadow-sm">
            {t.home[lang]}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-white/85">
            {t.homeSub[lang]}
          </p>
        </div>
      </div>
    </div>
  );
}
