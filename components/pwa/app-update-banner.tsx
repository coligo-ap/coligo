"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, X } from "lucide-react";
import { isNative } from "@/lib/native/context";
import { APP_CONFIG } from "@/lib/config/app-config";

type Role = "commerce" | "driver" | "drive";

/**
 * Bandeau « Nouvelle version disponible » pour les APK installés hors store.
 *
 * Android interdit l'installation silencieuse d'un APK sideloadé → on ne peut
 * pas mettre à jour « en douce ». À la place : l'app lit son propre numéro de
 * build (via @capacitor/app), le compare à `app.latestBuild` (variable Vercel),
 * et si une version plus récente existe, propose de la télécharger.
 *
 * - Web / PWA : jamais affiché (pas un APK).
 * - APK sans @capacitor/app (anciennes versions) : getInfo échoue → build 0 →
 *   considéré obsolète → bandeau affiché (migre l'utilisateur vers la nouvelle).
 * - Masqué pour la session si l'utilisateur ferme (sessionStorage).
 */
export function AppUpdateBanner() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isNative()) return;
    if (sessionStorage.getItem("coligo_update_dismissed") === "1") return;
    let cancelled = false;
    (async () => {
      let installed = 0;
      try {
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        installed = parseInt(info.build, 10) || 0;
      } catch {
        installed = 0; // APK sans le plugin → traité comme obsolète
      }
      if (!cancelled && APP_CONFIG.app.latestBuild > installed) {
        setShow(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  const role: Role = pathname.startsWith("/driver")
    ? "driver"
    : pathname.startsWith("/chauffeur")
      ? "drive"
      : "commerce";

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-[14px] bg-gradient-to-r from-[#5B2EFF] to-[#6C2BD9] p-3 text-white shadow-xl">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            Nouvelle version disponible
          </span>
          <span className="block text-xs text-white/80">
            Mettez à jour pour les dernières améliorations.
          </span>
        </span>
        <a
          href={`/api/app-download/${role}`}
          download
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-sm font-semibold text-[#6C2BD9]"
        >
          <Download className="size-4" />
          Mettre à jour
        </a>
        <button
          type="button"
          aria-label="Plus tard"
          onClick={() => {
            sessionStorage.setItem("coligo_update_dismissed", "1");
            setShow(false);
          }}
          className="shrink-0 rounded-full p-1 text-white/80 hover:text-white"
        >
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}
