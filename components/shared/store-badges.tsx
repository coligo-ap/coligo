"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import {
  APP_STORE_URL,
  PLAY_URL,
  detectPlatformClient,
  type DevicePlatform,
} from "@/lib/config/app-stores";
import { cn } from "@/lib/utils";

// =============================================================================
// Badges officiels App Store / Google Play.
//
// Les images sont celles fournies par Apple et Google, servies depuis NOTRE
// domaine (`/store/…`) : aucune requête vers un CDN externe — la politique de
// sécurité du site les bloquerait, et un badge qui ne charge pas donne un
// « trou » à la place du bouton d'installation.
//
// Rendu : au premier affichage on montre LES DEUX (aucune supposition avant de
// connaître l'appareil, donc aucun clignotement de mauvais badge), puis on met
// en avant celui de l'appareil détecté. Sur ordinateur les deux restent.
// =============================================================================

export function StoreBadges({
  /** `compact` : une seule rangée serrée (pied de page). */
  size = "md",
  /**
   * `detected` : UN SEUL badge, celui de l'appareil — c'est ce que font les
   * grandes applications sur mobile (un iPhone n'a rien à faire d'un bouton
   * Google Play). Sur ordinateur, où aucune boutique n'est « la bonne », les
   * deux restent affichés.
   */
  only = "both",
  className,
}: {
  size?: "sm" | "md";
  only?: "both" | "detected";
  className?: string;
}) {
  const locale = useLocale();
  const [platform, setPlatform] = useState<DevicePlatform | null>(null);
  useEffect(() => setPlatform(detectPlatformClient()), []);

  // Badges localisés quand la boutique en fournit (l'App Store n'a pas de
  // badge arabe : l'anglais est la version officielle de repli).
  const appStoreSrc =
    locale === "fr" ? "/store/app-store-fr.svg" : "/store/app-store-en.svg";
  const playSrc =
    locale === "fr"
      ? "/store/google-play-fr.png"
      : locale === "ar"
        ? "/store/google-play-ar.png"
        : "/store/google-play-en.png";

  const h = size === "sm" ? 38 : 46;
  // Mode « both » : un badge non pertinent n'est jamais RETIRÉ (le lien reste
  // utile — on peut vouloir envoyer la fiche à quelqu'un d'autre), il est
  // seulement atténué. Mode « detected » : il disparaît.
  const dim = (p: DevicePlatform) =>
    only === "both" && platform && platform !== "desktop" && platform !== p
      ? "opacity-45 hover:opacity-80"
      : "";
  // Tant que l'appareil n'est pas connu (premier rendu), on montre les deux :
  // afficher puis remplacer un badge serait un clignotement.
  const show = (p: DevicePlatform) =>
    only === "both" || !platform || platform === "desktop" || platform === p;

  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
      {show("ios") && (
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="App Store"
          className={cn("transition active:scale-[0.98]", dim("ios"))}
        >
          <Image
            src={appStoreSrc}
            alt="App Store"
            width={Math.round(h * 3.01)}
            height={h}
            style={{ height: h, width: "auto" }}
            unoptimized
          />
        </a>
      )}
      {show("android") && (
        <a
          href={PLAY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Google Play"
          className={cn("transition active:scale-[0.98]", dim("android"))}
        >
          <Image
            src={playSrc}
            alt="Google Play"
            width={Math.round(h * 3.36)}
            height={h}
            style={{ height: h, width: "auto" }}
            unoptimized
          />
        </a>
      )}
    </div>
  );
}
