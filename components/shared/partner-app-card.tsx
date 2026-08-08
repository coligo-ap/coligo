"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, Smartphone, ArrowRight } from "lucide-react";
import { useLocale } from "next-intl";
import { isNative } from "@/lib/native/context";
import {
  detectPlatformClient,
  type DevicePlatform,
} from "@/lib/config/app-stores";
import type { AuthVariant } from "@/components/shared/auth-nav";

// =============================================================================
// « L'application de votre espace » — portails PARTENAIRES.
//
// Différence ESSENTIELLE avec le client : les applications partenaires ne sont
// PAS sur les boutiques. Elles s'installent en Android par fichier .apk, et il
// n'en existe aucune version iPhone. On ne peut donc pas copier les badges
// App Store / Google Play du client — ce serait envoyer un commerçant
// installer l'application des CLIENTS.
//
// Ce que voit chacun, selon son appareil :
//   - Android  → bouton direct vers l'application de SON métier ;
//   - iPhone   → dit honnêtement qu'il n'y a pas d'app iOS, et renvoie vers
//                « Ajouter à l'écran d'accueil » (le site s'installe alors
//                comme une application) ;
//   - Ordinateur → invite à ouvrir la page depuis le téléphone.
//
// Rien n'est affiché DANS l'application native : on ne propose pas d'installer
// ce qui tourne déjà.
// =============================================================================

type Role = Exclude<AuthVariant, "customer">;

const APPS: Record<Role, { href: string; fr: string; ar: string }> = {
  merchant: {
    href: "/telecharger",
    fr: "Coligo COMMERCE",
    ar: "كوليغو للتجار",
  },
  driver: {
    href: "/driver/telecharger",
    fr: "Coligo Livreur",
    ar: "كوليغو للموصّل",
  },
  chauffeur: {
    href: "/chauffeur/telecharger",
    fr: "Coligo Drive",
    ar: "كوليغو درايف",
  },
  // Le portail « partenaire » regroupe les métiers : on renvoie au commerçant,
  // porte d'entrée la plus fréquente.
  partner: { href: "/telecharger", fr: "Coligo COMMERCE", ar: "كوليغو للتجار" },
};

export function PartnerAppCard({ variant }: { variant: AuthVariant }) {
  const isAr = useLocale() === "ar";
  const [platform, setPlatform] = useState<DevicePlatform | null>(null);
  const [hide, setHide] = useState(false);

  useEffect(() => {
    if (isNative()) {
      setHide(true);
      return;
    }
    setPlatform(detectPlatformClient());
  }, []);

  if (variant === "customer" || hide) return null;
  const app = APPS[variant as Role];
  const name = isAr ? app.ar : app.fr;
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  // Avant de connaître l'appareil : rien. Une carte qui change de discours
  // sous les yeux du visiteur inspire moins confiance qu'une carte qui arrive
  // déjà juste.
  if (!platform) return null;

  return (
    <section className="mx-auto mt-6 w-full max-w-[420px] px-4">
      <div className="border-border bg-surface rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <span className="bg-primary-50 text-primary-700 grid size-10 shrink-0 place-items-center rounded-md">
            {platform === "android" ? (
              <Download className="size-5" />
            ) : (
              <Smartphone className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <b className="text-foreground text-body block truncate font-extrabold">
              {name}
            </b>
            <small className="text-muted text-caption-lg block font-semibold">
              {platform === "android"
                ? tr(
                    "Application Android — installation directe",
                    "تطبيق أندرويد — تثبيت مباشر"
                  )
                : platform === "ios"
                  ? tr(
                      "Pas encore sur l'App Store — ajoutez le site à votre écran d'accueil",
                      "غير متوفر بعد على App Store — أضف الموقع إلى الشاشة الرئيسية"
                    )
                  : tr(
                      "Disponible sur Android — ouvrez cette page depuis votre téléphone",
                      "متوفر على أندرويد — افتح هذه الصفحة من هاتفك"
                    )}
            </small>
          </div>
        </div>

        {platform !== "ios" && (
          <Link
            href={app.href}
            className="bg-primary-600 hover:bg-primary-700 text-body-sm mt-3 flex items-center justify-center gap-1.5 rounded-md px-4 py-2.5 font-extrabold text-white transition-colors"
          >
            {tr("Installer l'application", "تثبيت التطبيق")}
            <ArrowRight className="size-4 rtl:-scale-x-100" />
          </Link>
        )}
      </div>
    </section>
  );
}
