"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { isNative } from "@/lib/native/context";
import {
  detectPlatformClient,
  type DevicePlatform,
} from "@/lib/config/app-stores";
import { StoreBadges } from "@/components/shared/store-badges";

// =============================================================================
// « Ouvrir l'application, ou l'installer » — portails de connexion.
//
// Deux comportements, dans cet ordre :
//
//  1. L'APPLICATION EST DÉJÀ LÀ → on l'ouvre, sans rien demander. Sur Android
//     comme sur iOS, un lien vers notre propre domaine est capté par le système
//     (App Links / Universal Links) et bascule directement dans l'app. On tente
//     donc l'ouverture, une seule fois.
//
//  2. ELLE N'EST PAS INSTALLÉE → rien ne s'est passé, la page est toujours là
//     au bout d'un instant. On affiche alors le BADGE OFFICIEL de la boutique
//     de l'appareil (App Store sur iPhone, Google Play sur Android), comme le
//     font les grandes applications.
//
// Pourquoi un délai plutôt qu'une détection franche : aucun navigateur ne dit
// si une application est installée — c'est volontaire, ce serait un traceur.
// Le seul signal honnête est « la page est-elle encore visible ? ».
//
// Rien n'est affiché DANS l'app native : on n'ouvre pas ce qui tourne déjà.
// =============================================================================

export function AppOpenOrInstall({
  /** Lien qui bascule dans l'app si elle est installée (App Link du domaine). */
  deepLink = "/",
  className,
}: {
  deepLink?: string;
  className?: string;
}) {
  const isAr = useLocale() === "ar";
  const [platform, setPlatform] = useState<DevicePlatform | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isNative()) return; // déjà dans l'app
    const p = detectPlatformClient();
    setPlatform(p);
    if (p === "desktop") {
      setShow(true); // pas d'app à ouvrir : on montre les deux boutiques
      return;
    }

    // Tentative d'ouverture silencieuse. Si l'app existe, le système prend la
    // main et la page passe en arrière-plan — on ne montrera jamais le bloc.
    let cancelled = false;
    const onHide = () => {
      cancelled = true; // l'app s'est ouverte
    };
    document.addEventListener("visibilitychange", onHide, { once: true });

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = new URL(deepLink, window.location.origin).href;
    document.body.appendChild(iframe);

    const t = window.setTimeout(() => {
      iframe.remove();
      document.removeEventListener("visibilitychange", onHide);
      if (!cancelled && document.visibilityState === "visible") setShow(true);
    }, 1200);

    return () => {
      window.clearTimeout(t);
      iframe.remove();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [deepLink]);

  if (!show || !platform) return null;
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  return (
    <section className={className ?? "mx-auto mt-6 w-full max-w-[420px] px-4"}>
      <div className="border-border bg-surface rounded-[16px] border p-4 text-center">
        <p className="text-foreground text-[13.5px] font-extrabold">
          {tr("L'application Coligo", "تطبيق كوليغو")}
        </p>
        <p className="text-muted mt-1 text-[11.5px] font-semibold">
          {platform === "desktop"
            ? tr(
                "Disponible sur l'App Store et Google Play.",
                "متوفر على App Store و Google Play."
              )
            : platform === "ios"
              ? tr("Disponible sur l'App Store.", "متوفر على App Store.")
              : tr("Disponible sur Google Play.", "متوفر على Google Play.")}
        </p>
        <StoreBadges only="detected" className="mt-3 justify-center" />
      </div>
    </section>
  );
}
