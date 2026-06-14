"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpCircle, X } from "lucide-react";
import { isNative } from "@/lib/native/context";
import { APP_CONFIG } from "@/lib/config/app-config";

type Role = "commerce" | "driver" | "drive";

const DOWNLOAD_PAGE: Record<Role, string> = {
  commerce: "/telecharger",
  driver: "/driver/telecharger",
  drive: "/chauffeur/telecharger",
};

/**
 * Bandeau « Nouvelle version disponible » dans un APK dont le build est
 * inférieur à la dernière version publiée. Il NE télécharge pas directement
 * (une WebView ne gère pas bien les téléchargements) : il renvoie vers la page
 * de téléchargement du rôle, dont le bouton « Installer la nouvelle version »
 * ouvre l'APK dans le navigateur système.
 *
 * - Web / PWA : jamais affiché.
 * - APK à jour : jamais affiché.
 * - Masqué pour la session si fermé.
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
        installed = 0;
      }
      if (!cancelled && APP_CONFIG.app.latestBuild > installed) setShow(true);
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
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-[60] px-3 lg:bottom-4">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-[14px] bg-gradient-to-r from-[#5B2EFF] to-[#6C2BD9] p-3 text-white shadow-xl">
        <ArrowUpCircle className="size-6 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            Nouvelle version disponible
          </span>
          <span className="block text-xs text-white/80">
            Touchez pour installer la dernière mise à jour.
          </span>
        </span>
        <Link
          href={DOWNLOAD_PAGE[role]}
          onClick={() => setShow(false)}
          className="shrink-0 rounded-full bg-white px-3.5 py-2 text-sm font-semibold text-[#6C2BD9]"
        >
          Mettre à jour
        </Link>
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
