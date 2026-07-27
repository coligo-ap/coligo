"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import {
  APP_THEMES,
  themeGradient,
  type AppThemeKey,
} from "@/lib/config/app-themes";
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
  marketplaceHero,
}: {
  current: AppThemeKey;
  marketplaceHero: boolean;
}) {
  const [selected, setSelected] = useState<AppThemeKey>(current);
  const [heroOn, setHeroOn] = useState(marketplaceHero);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useActionNote();

  const dirty = selected !== current || heroOn !== marketplaceHero;

  const save = () =>
    startTransition(async () => {
      const res = await setAppTheme(selected, heroOn);
      if (res.error) return setNote({ ok: false, text: res.error });
      setNote({ ok: true, text: "Thème appliqué partout." });
    });

  return (
    <div className="border-border bg-surface rounded-[16px] border p-4">
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
                "rounded-[12px] border p-1.5 text-start transition-colors",
                active
                  ? "border-primary-600 ring-primary-400 ring-1"
                  : "border-border hover:bg-surface-2"
              )}
              title={t.hint}
            >
              <span
                className="relative block h-12 overflow-hidden rounded-[8px]"
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

      {/* Accueil marketplace : bandeau thémé optionnel. */}
      <label className="border-border mt-3 flex cursor-pointer items-start gap-2.5 rounded-[12px] border p-3">
        <input
          type="checkbox"
          checked={heroOn}
          onChange={(e) => setHeroOn(e.target.checked)}
          disabled={pending}
          className="accent-primary-600 mt-0.5 size-4 shrink-0"
        />
        <span className="min-w-0 text-xs">
          <span className="text-foreground block font-medium">
            Afficher aussi le bandeau thémé sur l&apos;accueil marketplace
          </span>
          <span className="text-muted mt-0.5 block">
            Décoché = accueil simple actuel, sans bandeau.
          </span>
        </span>
      </label>

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
