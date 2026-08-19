"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Bike,
  Car,
  CircleUserRound,
  Gift,
  Heart,
  HelpCircle,
  Map as MapIcon,
  ReceiptText,
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
import { useCustomerLocation } from "@/lib/customer/location-store";
import { LocationBanner } from "@/components/customer/location-banner";
import { cn } from "@/lib/utils";

// =============================================================================
// HUB DE DÉMARRAGE — réplique du modèle Uber fourni par le propriétaire
// (« capture acceuil multi.jpg ») :
//   1. barre « Où va-t-on ? » en tête (ligne « De : zone » au-dessus, lien
//      Carte à droite) → le module Trajets ;
//   2. GRILLE de tuiles carrées grises : titre gras en haut à gauche,
//      sous-titre court, ILLUSTRATION en bas à droite — avec une tuile NOIRE
//      à flèche (ici : les espaces Partenaires, en feuille) ;
//   3. cartes PHOTOS horizontales « Autour de toi » (commerces réels).
//
// Règles de gestion : page PUBLIQUE ; la tuile compte s'adapte à la session ;
// Trajets/Fidélité gérées par feature flags ; localisation = LocationBanner
// réutilisé (demande native au tap, réglages EXACTS iOS/Android si bloqué,
// resync au premier plan) + feuille d'aide pas-à-pas par marque.
// =============================================================================

export type NearbyMerchant = {
  slug: string;
  name: string;
  cover_url: string | null;
  city: string | null;
};

type Props = {
  isAuth: boolean;
  driveVisible: boolean;
  loyaltyVisible: boolean;
  nearby: NearbyMerchant[];
};

/** Tuile de la grille (modèle Uber) : gris doux, titre gras, illustration en
 *  bas à droite. `dark` = la tuile noire à flèche du modèle. */
function Tile({
  href,
  onClick,
  title,
  sub,
  icon,
  span2 = false,
  dark = false,
}: {
  href?: string;
  onClick?: () => void;
  title: string;
  sub?: string;
  icon: React.ReactNode;
  span2?: boolean;
  dark?: boolean;
}) {
  const inner = (
    <>
      <span className="block pt-0.5">
        <span
          className={cn(
            "block text-sm leading-tight font-bold",
            dark ? "text-background" : "text-foreground"
          )}
        >
          {title}
        </span>
        {sub && (
          <span
            className={cn(
              "text-caption mt-0.5 block leading-tight",
              dark ? "text-background/70" : "text-muted"
            )}
          >
            {sub}
          </span>
        )}
      </span>
      <span
        className={cn(
          "mt-auto self-end",
          dark ? "text-background" : "text-primary-600"
        )}
      >
        {icon}
      </span>
    </>
  );
  const cls = cn(
    "flex aspect-square flex-col rounded-lg p-3 transition active:scale-[.98]",
    span2 && "col-span-2 aspect-auto",
    dark ? "bg-foreground" : "bg-surface-2"
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cn(cls, "text-start")}>
      {inner}
    </button>
  );
}

export function ServicesHub({
  isAuth,
  driveVisible,
  loyaltyVisible,
  nearby,
}: Props) {
  const t = useTranslations("hub");
  const loc = useCustomerLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const [partnersOpen, setPartnersOpen] = useState(false);
  const nativeSettings = canOpenAppSettings();

  const zone =
    loc?.address?.trim() ||
    [loc?.commune, loc?.wilaya_code ? `W${loc.wilaya_code}` : null]
      .filter(Boolean)
      .join(", ") ||
    null;

  return (
    <div className="mx-auto max-w-xl px-4 pb-6">
      {/* 1. Barre « Où va-t-on ? » (modèle Uber) → Trajets. */}
      {driveVisible && (
        <div className="bg-surface-2 mt-3 flex items-stretch rounded-lg">
          <Link
            href="/drive"
            className="flex min-w-0 flex-1 items-center gap-3 p-3"
          >
            <span className="bg-on-brand text-primary-600 flex size-10 shrink-0 items-center justify-center rounded-full">
              <Car className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="text-muted block truncate text-xs font-medium">
                {zone ? t("fromZone", { zone }) : t("fromUnset")}
              </span>
              <span className="text-foreground block text-lg leading-tight font-black tracking-tight">
                {t("whereTo")}
              </span>
            </span>
          </Link>
          <Link
            href="/drive"
            className="border-border text-foreground flex items-center gap-1.5 border-s px-4 text-sm font-bold"
          >
            <MapIcon className="size-4" />
            {t("mapLink")}
          </Link>
        </div>
      )}

      {/* Localisation : demande au tap, réglages exacts si bloqué (réutilisé). */}
      <div className="mt-3">
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

      {/* 2. GRILLE de tuiles (modèle Uber). */}
      <section className="mt-4 grid grid-cols-3 gap-2">
        {driveVisible && (
          <Tile
            href="/drive"
            title={t("cardRides")}
            sub={t("ridesSub")}
            icon={<Car className="size-9" />}
          />
        )}
        <Tile
          href="/?category=superette"
          title={t("cardSuperette")}
          sub={t("superetteSub")}
          icon={<ShoppingBasket className="size-9" />}
        />
        <Tile
          href="/?category=fast_food"
          title={t("cardFood")}
          sub={t("foodSub")}
          icon={<UtensilsCrossed className="size-9" />}
        />
        {loyaltyVisible && (
          <Tile
            span2
            href="/cashback?tab=fidelite"
            title={t("cardLoyalty")}
            sub={t("loyaltySub")}
            icon={<Gift className="size-10" />}
          />
        )}
        {/* Tuile NOIRE à flèche (modèle) → espaces partenaires. */}
        <Tile
          dark
          onClick={() => setPartnersOpen(true)}
          title={t("partnersTile")}
          sub={t("partnersTileSub")}
          icon={<ArrowRight className="size-8 rtl:-scale-x-100" />}
        />
        <Tile
          href={isAuth ? "/compte" : "/se-connecter?next=/services"}
          title={isAuth ? t("cardAccount") : t("cardLogin")}
          sub={isAuth ? t("accountSub") : t("loginSub")}
          icon={<CircleUserRound className="size-9" />}
        />
        <Tile
          href="/commandes"
          title={t("ordersTile")}
          sub={t("ordersSub")}
          icon={<ReceiptText className="size-9" />}
        />
        <Tile
          href="/favoris"
          title={t("favsTile")}
          sub={t("favsSub")}
          icon={<Heart className="size-9" />}
        />
      </section>

      {/* 3. Cartes PHOTOS « Autour de toi » (modèle Uber : image + voile). */}
      {nearby.length > 0 && (
        <section className="mt-6">
          <h2 className="text-foreground text-heading-sm font-black tracking-tight">
            {t("nearbyTitle")}
          </h2>
          <div className="-mx-4 mt-2.5 flex scrollbar-none gap-3 overflow-x-auto px-4 pb-1">
            {nearby.map((m) => (
              <Link
                key={m.slug}
                href={`/m/${m.slug}`}
                className="relative h-52 w-40 shrink-0 overflow-hidden rounded-lg transition active:scale-[.98]"
              >
                {m.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.cover_url}
                    alt={m.name}
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  <span className="bg-surface-3 absolute inset-0" />
                )}
                <span
                  className="absolute inset-0 opacity-70"
                  style={{
                    backgroundImage:
                      "linear-gradient(to top, var(--color-plain-black), transparent 55%)",
                  }}
                />
                <span className="text-on-brand absolute inset-x-0 bottom-0 p-3">
                  <span className="block text-sm leading-tight font-extrabold">
                    {m.name}
                  </span>
                  {m.city && (
                    <span className="mt-0.5 block text-xs font-medium opacity-80">
                      {m.city}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Feuille PARTENAIRES (depuis la tuile noire). */}
      <Sheet
        open={partnersOpen}
        onClose={() => setPartnersOpen(false)}
        title={t("partnersTitle")}
      >
        <p className="text-muted text-sm">{t("partnersSub")}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
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
              className="border-border text-foreground hover:bg-surface-2 flex flex-col items-center gap-1.5 rounded-md border p-3 text-center text-xs font-bold transition active:scale-[.98]"
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
          className="text-primary-600 mt-3 inline-flex items-center gap-1 text-sm font-bold"
        >
          {t("becomePartner")}
          <ArrowRight className="size-4 rtl:-scale-x-100" />
        </Link>
      </Sheet>

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
                className="bg-primary-600 hover:bg-primary-700 text-on-brand h-11 rounded-md text-sm font-extrabold transition"
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
