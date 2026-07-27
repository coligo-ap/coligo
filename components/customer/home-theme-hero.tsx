import { Flag, Moon, Percent, Snowflake, Sparkles, Sun } from "lucide-react";
import {
  APP_THEMES,
  THEME_GRAIN,
  themeGradient,
  type AppThemeKey,
} from "@/lib/config/app-themes";

const ICONS = {
  sparkles: Sparkles,
  moon: Moon,
  sun: Sun,
  snowflake: Snowflake,
  percent: Percent,
  flag: Flag,
} as const;

/**
 * Bandeau « occasion » OPTIONNEL de l'accueil marketplace (mig 0415, activé
 * par le super-admin dans /admin/controle — désactivé = accueil simple
 * actuel, ce composant n'est pas rendu du tout). Même langage visuel que les
 * héros d'auth : dégradé du thème + blobs organiques + grain, animations
 * douces coupées par prefers-reduced-motion. Purement décoratif + tagline
 * localisée : aucune info d'un autre bloc n'est dupliquée.
 */
export function HomeThemeHero({
  theme,
  locale,
}: {
  theme: AppThemeKey;
  locale: string;
}) {
  const t = APP_THEMES[theme];
  const lang = locale === "ar" ? "ar" : locale === "en" ? "en" : "fr";
  const Icon = ICONS[t.homeIcon];
  return (
    <div
      className="relative overflow-hidden rounded-b-[28px] px-5 pt-4 pb-6 text-white lg:mx-6 lg:mt-3 lg:rounded-[24px]"
      style={{ backgroundImage: themeGradient(t) }}
    >
      <style>{`@keyframes hthFloat{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(10px,10px,0) scale(1.07)}}.hth-blob{animation:hthFloat 12s ease-in-out infinite alternate}.hth-blob-b{animation:hthFloat 9s ease-in-out infinite alternate-reverse}@media (prefers-reduced-motion:reduce){.hth-blob,.hth-blob-b{animation:none}}`}</style>
      <div
        aria-hidden
        className="hth-blob absolute -top-10 -right-8 size-32 rounded-full opacity-60"
        style={{ background: t.blobA }}
      />
      <div
        aria-hidden
        className="hth-blob-b absolute -bottom-12 left-1/4 size-28 rounded-full opacity-50"
        style={{ background: t.blobB }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.16] mix-blend-overlay"
        style={{ backgroundImage: `url("${THEME_GRAIN}")` }}
      />
      <div className="relative z-10 mx-auto flex max-w-[1400px] items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-base leading-tight font-bold">{t.home[lang]}</p>
          <p className="mt-0.5 text-xs text-white/85">{t.homeSub[lang]}</p>
        </div>
      </div>
    </div>
  );
}
