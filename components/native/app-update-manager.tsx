"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import {
  completeFlexibleUpdate,
  runAppUpdateFlow,
  type AppUpdatePhase,
} from "@/lib/native/app-update";

/**
 * Orchestration Google Play In-App Updates — monté UNE FOIS dans la coque
 * client (CustomerChrome). No-op hors APK Android installé depuis Play.
 *
 * L'update FLEXIBLE se télécharge en arrière-plan (feuille de consentement
 * Play) ; quand elle est prête on affiche la bannière « Redémarrer » — même
 * design que la bannière push (PushRegistrar). L'update IMMEDIATE (forcée
 * par le serveur) est plein écran Play : rien à rendre ici.
 */
export function AppUpdateManager() {
  const t = useTranslations("appUpdate");
  const [phase, setPhase] = useState<AppUpdatePhase | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    void runAppUpdateFlow((p) => setPhase(p)).then((c) => {
      if (cancelled) c();
      else cleanup = c;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  if (phase !== "ready") return null;

  return (
    <div className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md">
      <div className="border-border flex items-start gap-3 rounded-[14px] border bg-white p-4 shadow-lg">
        <span className="bg-primary-50 text-primary-600 flex size-9 shrink-0 items-center justify-center rounded-full">
          <RefreshCw className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("readyTitle")}</p>
          <p className="text-muted mt-0.5 text-xs">{t("readyBody")}</p>
          <button
            type="button"
            onClick={() => {
              setRestarting(true);
              void completeFlexibleUpdate();
            }}
            disabled={restarting}
            className="bg-primary-600 hover:bg-primary-700 mt-2.5 inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-60"
          >
            <RefreshCw className="size-3.5" />
            {restarting ? "…" : t("restartCta")}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setPhase(null)}
          aria-label={t("dismiss")}
          className="text-muted hover:text-foreground -m-1 shrink-0 p-1 text-xs transition-colors"
        >
          {t("dismiss")}
        </button>
      </div>
    </div>
  );
}
