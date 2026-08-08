"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, RefreshCw, Smartphone } from "lucide-react";
import { isNative } from "@/lib/native/context";
import { APP_CONFIG } from "@/lib/config/app-config";

/**
 * Bouton de téléchargement / mise à jour d'un APK Coligo.
 *
 * Trois états (résolus au runtime client) :
 *  - WEB (navigateur / PWA) → « Télécharger l'application » via la route
 *    MÊME-ORIGINE (`apkHref`, Content-Disposition attachment) : fiable partout.
 *  - APK installé À JOUR → message « déjà à jour » (rien à télécharger).
 *  - APK installé OBSOLÈTE → « Installer la nouvelle version » : on pointe sur
 *    l'URL Supabase CROSS-ORIGIN. Une WebView Capacitor ne sait pas télécharger
 *    un fichier servi par sa propre origine, MAIS ouvre les liens cross-origin
 *    dans le navigateur système, qui lui télécharge l'APK (seul moyen fiable).
 *
 * Le build installé est lu via `@capacitor/app` ; absent (vieux APK) →
 * considéré obsolète. Comparé à `app.latestBuild` (variable Vercel).
 */
type Mode = "web" | "native-current" | "native-update";

export function ApkDownloadButton({
  url,
  version,
  size,
  apkHref = "/telecharger/apk",
  fileName = "coligo-commercant.apk",
}: {
  url: string;
  version?: string;
  size?: string;
  apkHref?: string;
  fileName?: string;
}) {
  const [mode, setMode] = useState<Mode>("web");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isNative()) {
        if (!cancelled) setMode("web");
        return;
      }
      let installed = 0;
      try {
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        installed = parseInt(info.build, 10) || 0;
      } catch {
        installed = 0; // APK sans @capacitor/app → traité comme obsolète
      }
      if (cancelled) return;
      setMode(
        APP_CONFIG.app.latestBuild > installed
          ? "native-update"
          : "native-current"
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!url) {
    return (
      <div className="border-border bg-surface-2 text-muted rounded-card-lg flex items-center justify-center gap-2 border border-dashed px-5 py-4 text-sm font-medium">
        <Smartphone className="size-5 shrink-0" />
        Bientôt disponible — lien en cours de préparation.
      </div>
    );
  }

  if (mode === "native-current") {
    return (
      <div className="border-success-100 bg-success-50 text-success-700 rounded-card-lg flex items-center justify-center gap-2 border px-5 py-4 text-sm font-semibold">
        <CheckCircle2 className="size-5 shrink-0" />
        Vous utilisez déjà la dernière version 🎉
      </div>
    );
  }

  const isUpdate = mode === "native-update";
  // Native obsolète → lien Supabase cross-origin (ouvert dans le navigateur
  // système). Web → route même-origine. `?download=` force l'attachment.
  const href = isUpdate
    ? url + (url.includes("?") ? "&" : "?") + "download=" + fileName
    : apkHref;
  const Icon = isUpdate ? RefreshCw : Download;
  const label = isUpdate
    ? "Installer la nouvelle version"
    : "Télécharger l’application";

  return (
    <a
      href={href}
      download={fileName}
      className="cg-brand-gradient focus-visible:ring-primary-300 group rounded-card-lg flex w-full items-center justify-center gap-3 px-6 py-4 text-base font-semibold text-white transition-all focus:outline-none focus-visible:ring-2"
    >
      <Icon className="size-5 shrink-0 transition-transform group-hover:translate-y-0.5" />
      {label}
      {(version || size) && !isUpdate && (
        <span className="ms-1 text-sm font-medium text-white/80">
          ({[version && `v${version}`, size].filter(Boolean).join(" · ")})
        </span>
      )}
    </a>
  );
}
