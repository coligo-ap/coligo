"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, Smartphone } from "lucide-react";
import { isNative } from "@/lib/native/context";

/**
 * Bouton de téléchargement de l'APK « Coligo Commerçant ».
 *
 * Trois états :
 *  - on tourne DÉJÀ dans l'APK (WebView Capacitor) → message « déjà installée »
 *    (inutile de re-télécharger, et l'impression Sunmi marche déjà) ;
 *  - URL absente (variable d'env non renseignée) → « bientôt disponible » ;
 *  - sinon → gros bouton de téléchargement direct du .apk.
 *
 * `isNative()` n'est fiable qu'au runtime client → composant client + état
 * monté pour éviter tout mismatch d'hydratation (cf. mémoire React #418).
 */
export function ApkDownloadButton({
  url,
  version,
  size,
}: {
  url: string;
  version?: string;
  size?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    setMounted(true);
    setNative(isNative());
  }, []);

  // Avant montage : on rend le bouton (ou l'état indisponible) côté serveur de
  // façon stable, puis on l'ajuste si on détecte l'APK.
  if (mounted && native) {
    return (
      <div className="border-success-100 bg-success-50 text-success-700 flex items-center justify-center gap-2 rounded-[14px] border px-5 py-4 text-sm font-semibold">
        <CheckCircle2 className="size-5 shrink-0" />
        Vous utilisez déjà l’application installée 🎉
      </div>
    );
  }

  if (!url) {
    return (
      <div className="border-border bg-surface-2 text-muted flex items-center justify-center gap-2 rounded-[14px] border border-dashed px-5 py-4 text-sm font-medium">
        <Smartphone className="size-5 shrink-0" />
        Bientôt disponible — lien en cours de préparation.
      </div>
    );
  }

  // On télécharge via une route MÊME-ORIGINE (`/telecharger/apk`) qui relaie
  // le fichier Supabase en `Content-Disposition: attachment`. Un lien direct
  // vers Supabase (cross-origin) voyait son attribut `download` ignoré et
  // certains navigateurs/WebView bloquaient le téléchargement → page qui
  // tournait. Même-origine + attachment = téléchargement fiable partout.
  return (
    <a
      href="/telecharger/apk"
      download="coligo-commercant.apk"
      className="focus-visible:ring-primary-300 group flex w-full items-center justify-center gap-3 rounded-[14px] bg-gradient-to-r from-[#5B2EFF] to-[#6C2BD9] px-6 py-4 text-base font-semibold text-white shadow-lg shadow-[#6C2BD9]/25 transition-all hover:to-[#5B23C4] hover:shadow-xl focus:outline-none focus-visible:ring-2"
    >
      <Download className="size-5 shrink-0 transition-transform group-hover:translate-y-0.5" />
      Télécharger l’application
      {(version || size) && (
        <span className="ms-1 text-sm font-medium text-white/80">
          ({[version && `v${version}`, size].filter(Boolean).join(" · ")})
        </span>
      )}
    </a>
  );
}
