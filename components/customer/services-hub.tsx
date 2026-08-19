"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Bike,
  Car,
  ChevronRight,
  CircleUserRound,
  Gift,
  HelpCircle,
  ShoppingBasket,
  Store,
  UtensilsCrossed,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import {
  canOpenAppSettings,
  openAppSettings,
  openLocationSettings,
} from "@/lib/native";
import { LocationBanner } from "@/components/customer/location-banner";
import { cn } from "@/lib/utils";

// =============================================================================
// HUB DE DÉMARRAGE (style Uber / Yassir) — la première page de l'app :
// grandes cartes de services (Trajets, Supérette, Fast-food, Fidélité,
// Compte), espaces PARTENAIRES, et le processus LOCALISATION complet
// (LocationBanner réutilisé : demande au tap, réglages exacts iOS/Android
// quand c'est bloqué, resync au retour au premier plan) + feuille d'aide
// pas-à-pas par marque de téléphone.
//
// Règles de gestion :
//  - page PUBLIQUE (le marketplace est public, l'auth n'arrive qu'au
//    checkout — modèle Uber/Yassir) ; la carte « Mon compte » s'adapte à la
//    session (connecté → /compte ; sinon → connexion avec retour ici) ;
//  - les cartes Trajets et Fidélité n'apparaissent que si leur feature flag
//    est visible (drive / loyalty) ;
//  - navigation 100 % <Link> prefetch (transitions instantanées).
// =============================================================================

type Props = {
  isAuth: boolean;
  firstName: string | null;
  driveVisible: boolean;
  loyaltyVisible: boolean;
};

function ServiceCard({
  href,
  title,
  desc,
  icon,
  tone,
  wide = false,
}: {
  href: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  tone: "primary" | "accent";
  wide?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "border-border group relative overflow-hidden rounded-lg border bg-white p-4 transition active:scale-[.99]",
        wide && "col-span-2 flex items-center gap-4"
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md",
          wide ? "size-14" : "mb-3 size-11",
          tone === "primary"
            ? "bg-primary-50 text-primary-600"
            : "bg-accent-50 text-accent-600"
        )}
      >
        {icon}
      </span>
      <span className="block min-w-0">
        <span className="text-foreground flex items-center gap-1 text-base leading-tight font-extrabold">
          {title}
          <ChevronRight className="text-subtle size-4 shrink-0 transition group-active:translate-x-0.5 rtl:-scale-x-100" />
        </span>
        <span className="text-muted mt-1 block text-xs leading-snug font-medium">
          {desc}
        </span>
      </span>
    </Link>
  );
}

export function ServicesHub({
  isAuth,
  firstName,
  driveVisible,
  loyaltyVisible,
}: Props) {
  const t = useTranslations("hub");
  const [helpOpen, setHelpOpen] = useState(false);
  const nativeSettings = canOpenAppSettings();

  return (
    <div className="mx-auto max-w-xl px-4 pb-6">
      {/* HÉRO violet de marque : salutation + promesse — le geste Uber. */}
      <section
        className="rounded-panel-lg -mx-1 mt-3 overflow-hidden px-5 py-6 text-white"
        style={{
          backgroundImage:
            "linear-gradient(135deg, var(--color-primary-800), var(--color-primary-600) 62%, var(--color-accent-500) 130%)",
        }}
      >
        <p className="text-sm font-bold opacity-90">
          {isAuth && firstName
            ? t("greeting", { name: firstName })
            : t("greetingGuest")}
        </p>
        <h1 className="mt-1 text-2xl leading-tight font-black tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1.5 text-sm font-medium opacity-85">{t("subtitle")}</p>
      </section>

      {/* LOCALISATION — même processus que la home : demande native au tap,
          « Ouvrir les réglages » exact (fiche app / écran Position) si refusé
          ou service éteint, resync au retour au premier plan. */}
      <div className="mt-4">
        <LocationBanner />
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="text-muted hover:text-foreground mt-2 flex items-center gap-1.5 text-xs font-semibold"
        >
          <HelpCircle className="size-3.5" />
          {t("locHelpLink")}
        </button>
      </div>

      {/* SERVICES — grandes cartes plates, navigation instantanée. */}
      <section className="mt-5 grid grid-cols-2 gap-3">
        {driveVisible && (
          <ServiceCard
            wide
            href="/drive"
            title={t("cardRides")}
            desc={t("cardRidesDesc")}
            tone="primary"
            icon={<Car className="size-7" />}
          />
        )}
        <ServiceCard
          href="/?category=superette"
          title={t("cardSuperette")}
          desc={t("cardSuperetteDesc")}
          tone="primary"
          icon={<ShoppingBasket className="size-6" />}
        />
        <ServiceCard
          href="/?category=fast_food"
          title={t("cardFood")}
          desc={t("cardFoodDesc")}
          tone="accent"
          icon={<UtensilsCrossed className="size-6" />}
        />
        {loyaltyVisible && (
          <ServiceCard
            href="/cashback?tab=fidelite"
            title={t("cardLoyalty")}
            desc={t("cardLoyaltyDesc")}
            tone="accent"
            icon={<Gift className="size-6" />}
          />
        )}
        <ServiceCard
          href={isAuth ? "/compte" : "/se-connecter?next=/services"}
          title={isAuth ? t("cardAccount") : t("cardLogin")}
          desc={isAuth ? t("cardAccountDesc") : t("cardLoginDesc")}
          tone="primary"
          icon={<CircleUserRound className="size-6" />}
        />
      </section>

      {/* PARTENAIRES — accès aux espaces pro + recrutement. */}
      <section className="mt-6">
        <h2 className="text-foreground text-heading-sm font-black tracking-tight">
          {t("partnersTitle")}
        </h2>
        <p className="text-muted mt-0.5 text-xs font-medium">
          {t("partnersSub")}
        </p>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {(
            [
              [
                "/chauffeur",
                t("partnerDriver"),
                <Car key="d" className="size-5" />,
              ],
              [
                "/dashboard",
                t("partnerMerchant"),
                <Store key="m" className="size-5" />,
              ],
              [
                "/driver",
                t("partnerCourier"),
                <Bike key="c" className="size-5" />,
              ],
            ] as const
          ).map(([href, label, icon]) => (
            <Link
              key={href}
              href={href}
              prefetch={false}
              className="border-border text-foreground hover:bg-surface-2 flex flex-col items-center gap-1.5 rounded-md border bg-white p-3 text-center text-xs font-bold transition active:scale-[.98]"
            >
              <span className="bg-surface-2 text-primary-600 flex size-9 items-center justify-center rounded-md">
                {icon}
              </span>
              {label}
            </Link>
          ))}
        </div>
        <Link
          href="/recrute"
          className="text-primary-600 mt-2.5 inline-flex items-center gap-1 text-sm font-bold"
        >
          {t("becomePartner")}
          <ArrowRight className="size-4 rtl:-scale-x-100" />
        </Link>
      </section>

      {/* AIDE LOCALISATION — pas-à-pas par système et par marque Android. */}
      <Sheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={t("helpTitle")}
      >
        <div className="space-y-3">
          <p className="text-muted text-sm leading-relaxed">{t("helpIntro")}</p>
          <ul className="space-y-2">
            {(
              [
                t("helpIphone"),
                t("helpAndroid"),
                t("helpSamsung"),
                t("helpXiaomi"),
                t("helpOppo"),
                t("helpHuawei"),
              ] as string[]
            ).map((line) => (
              <li
                key={line.slice(0, 16)}
                className="bg-surface-2 text-foreground rounded-md p-2.5 text-xs leading-relaxed font-medium"
              >
                {line}
              </li>
            ))}
          </ul>
          <p className="border-primary-200 bg-primary-50 text-primary-800 rounded-md border p-2.5 text-xs leading-relaxed font-medium">
            {t("helpAlways")}
          </p>
          {nativeSettings ? (
            <div className="grid grid-cols-1 gap-2 pt-1">
              <button
                type="button"
                onClick={() => void openAppSettings()}
                className="bg-primary-600 hover:bg-primary-700 h-11 rounded-md text-sm font-extrabold text-white transition"
              >
                {t("helpOpenApp")}
              </button>
              <button
                type="button"
                onClick={() => void openLocationSettings()}
                className="border-border text-foreground hover:bg-surface-2 h-11 rounded-md border text-sm font-bold transition"
              >
                {t("helpOpenLocation")}
              </button>
            </div>
          ) : (
            <p className="text-subtle text-xs">{t("helpWeb")}</p>
          )}
        </div>
      </Sheet>
    </div>
  );
}
