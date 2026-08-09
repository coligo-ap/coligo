import { Flag, Moon, Percent, Snowflake, Sparkles, Sun } from "lucide-react";
import {
  APP_THEMES,
  DEFAULT_APP_THEME,
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
 * Bande « occasion » de l'accueil marketplace (mig 0415/0416, activée par le
 * super-admin — désactivée = accueil simple, rien n'est rendu).
 *
 * REFONTE (allègement de la home) : c'était un héro en dégradé de ~170px qui,
 * cumulé au header peint et à la pilule de recherche flottante, occupait ~30%
 * du premier écran — le premier commerce n'était plus visible sans défiler.
 * C'est désormais **une seule ligne** prolongeant le header (même aplat `g1`,
 * aucune couture, aucune marge négative) : l'occasion reste annoncée, le
 * contenu revient au premier plan.
 *
 * Elle ne s'affiche PAS pour un client connecté sur le thème par défaut
 * (« Bienvenue sur Coligo » = décor pour quelqu'un qui est déjà entré) ; une
 * vraie occasion (Ramadan, Aïd, soldes…) reste annoncée à tout le monde.
 * Décision prise ici, pas dans la page : une seule règle à lire.
 */
export function shouldShowThemeStrip({
  theme,
  isAuth,
}: {
  theme: AppThemeKey;
  isAuth: boolean;
}): boolean {
  return !(isAuth && theme === DEFAULT_APP_THEME);
}

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
    <div style={{ backgroundColor: t.g1 }}>
      <div className="text-on-brand mx-auto flex max-w-[1400px] items-center gap-2 px-4 pb-2 lg:px-6">
        <Icon className="size-3.5 shrink-0 opacity-90" aria-hidden />
        {/* Une seule information, une seule ligne : le sous-titre marketing
            (« Courses, repas et commerces près de chez toi ») disait ce que
            la grille montre juste en dessous. */}
        <p className="text-caption-lg truncate font-semibold">{t.home[lang]}</p>
      </div>
    </div>
  );
}
