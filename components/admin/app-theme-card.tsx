"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import {
  APP_THEMES,
  APP_THEME_MODELS,
  themeGradient,
  type AppThemeKey,
  type AppThemeModel,
} from "@/lib/config/app-themes";
import { ThemeDecor } from "@/components/shared/theme-decor";
import { setAppTheme } from "@/app/admin/actions";
import { cn } from "@/lib/utils";

/**
 * Carte /admin/controle : choix du THÈME « occasion » (mig 0415) — héros des
 * portails d'auth + bandeau optionnel de l'accueil marketplace. Aperçu mini
 * (dégradé + blobs) pour chaque preset ; application immédiate partout après
 * enregistrement.
 */
export function AppThemeCard({
  current,
  currentModel,
  marketplaceHero,
  heroCategories,
}: {
  current: AppThemeKey;
  currentModel: AppThemeModel;
  marketplaceHero: boolean;
  heroCategories: boolean;
}) {
  const [selected, setSelected] = useState<AppThemeKey>(current);
  const [model, setModel] = useState<AppThemeModel>(currentModel);
  const [heroOn, setHeroOn] = useState(marketplaceHero);
  const [catsIn, setCatsIn] = useState(heroCategories);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useActionNote();

  const dirty =
    selected !== current ||
    model !== currentModel ||
    heroOn !== marketplaceHero ||
    catsIn !== heroCategories;

  const save = () =>
    startTransition(async () => {
      const res = await setAppTheme(selected, model, heroOn, catsIn);
      if (res.error) return setNote({ ok: false, text: res.error });
      setNote({ ok: true, text: "Thème appliqué partout." });
    });

  return (
    <div className="border-border bg-surface rounded-lg border p-4">
      <div className="mb-1 flex items-center gap-2">
        <Palette className="text-primary-600 size-4" />
        <h3 className="text-sm font-semibold">Thème des portails & accueil</h3>
      </div>
      <p className="text-muted mb-3 text-xs">
        Change les couleurs des écrans de connexion/inscription (tous les
        espaces) selon l&apos;occasion — Ramadan, Aïd, promos… Application
        immédiate, réversible à tout moment.
      </p>

      {/* Presets — aperçu mini : dégradé + blobs du thème. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(Object.keys(APP_THEMES) as AppThemeKey[]).map((key) => {
          const t = APP_THEMES[key];
          const active = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              disabled={pending}
              className={cn(
                "rounded-md border p-1.5 text-start transition-colors",
                active
                  ? "border-primary-600 ring-primary-400 ring-1"
                  : "border-border hover:bg-surface-2"
              )}
              title={t.hint}
            >
              <span
                className="relative block h-12 overflow-hidden rounded-sm"
                style={{ backgroundImage: themeGradient(t) }}
              >
                <span
                  className="absolute -top-3 -left-2 size-8 rounded-full opacity-70"
                  style={{ background: t.blobA }}
                />
                <span
                  className="absolute -right-2 -bottom-3 size-9 rounded-full opacity-60"
                  style={{ background: t.blobB }}
                />
                {active && (
                  <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-white/90">
                    <Check className="text-primary-700 size-3" />
                  </span>
                )}
              </span>
              <span className="mt-1 block truncate text-xs font-medium">
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* MODÈLE de design (mig 0416) — aperçus réels du décor, aux couleurs
          du thème sélectionné. */}
      <p className="text-foreground mt-4 mb-2 text-xs font-semibold">
        Modèle de design
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(APP_THEME_MODELS) as AppThemeModel[]).map((key) => {
          const m = APP_THEME_MODELS[key];
          const t = APP_THEMES[selected];
          const active = model === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setModel(key)}
              disabled={pending}
              className={cn(
                "rounded-md border p-1.5 text-start transition-colors",
                active
                  ? "border-primary-600 ring-primary-400 ring-1"
                  : "border-border hover:bg-surface-2"
              )}
              title={m.hint}
            >
              <span
                className="relative block h-12 overflow-hidden rounded-sm"
                style={{ backgroundImage: themeGradient(t) }}
              >
                <ThemeDecor model={key} a={t.blobA} b={t.blobB} grain={false} />
                {active && (
                  <span className="absolute top-1 right-1 z-10 flex size-4 items-center justify-center rounded-full bg-white/90">
                    <Check className="text-primary-700 size-3" />
                  </span>
                )}
              </span>
              <span className="mt-1 block truncate text-xs font-medium">
                {m.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Accueil marketplace : bandeau thémé optionnel. */}
      <label className="border-border mt-3 flex cursor-pointer items-start gap-2.5 rounded-md border p-3">
        <input
          type="checkbox"
          checked={heroOn}
          onChange={(e) => setHeroOn(e.target.checked)}
          disabled={pending}
          className="accent-primary-600 mt-0.5 size-4 shrink-0"
        />
        <span className="min-w-0 text-xs">
          <span className="text-foreground block font-medium">
            Habiller aussi l&apos;accueil marketplace (header + recherche)
          </span>
          <span className="text-muted mt-0.5 block">
            Le haut de l&apos;accueil (header, message d&apos;occasion, barre de
            recherche flottante) prend le thème. Décoché = accueil simple
            actuel.
          </span>
        </span>
      </label>

      {/* Étendre le design aux catégories (mig 0417) — pertinent seulement
          quand l'accueil est habillé. */}
      {heroOn && (
        <label className="border-border ms-6 mt-2 flex cursor-pointer items-start gap-2.5 rounded-md border p-3">
          <input
            type="checkbox"
            checked={catsIn}
            onChange={(e) => setCatsIn(e.target.checked)}
            disabled={pending}
            className="accent-primary-600 mt-0.5 size-4 shrink-0"
          />
          <span className="min-w-0 text-xs">
            <span className="text-foreground block font-medium">
              Inclure aussi les catégories de commerçants dans le design
            </span>
            <span className="text-muted mt-0.5 block">
              Coché = la bande de catégories rondes est DANS le dégradé
              (libellés blancs). Décoché = elle reste sous le design, avec un
              petit espace.
            </span>
          </span>
        </label>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={pending || !dirty}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Appliquer le thème
        </Button>
        <ActionNote note={note} />
      </div>
    </div>
  );
}
