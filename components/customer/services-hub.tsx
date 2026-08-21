"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Bike,
  Car,
  HelpCircle,
  Map as MapIcon,
  Store,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import {
  canOpenAppSettings,
  openAppSettings,
  openLocationSettings,
} from "@/lib/native";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { fetchMerchantsForZone } from "@/app/(customer)/actions";
import { LocationBanner } from "@/components/customer/location-banner";
import { cn } from "@/lib/utils";

// =============================================================================
// HUB DE DÉMARRAGE — réplique de la maquette « Photo v2 accueil » fournie par
// le propriétaire (août 2026, v2 illustrée) :
//   1. barre « Où va-t-on ? » (vignette voiture BLANCHE carrée, ligne
//      « De : zone » au-dessus, lien Carte séparé à droite) → module Trajets ;
//   2. GRILLE de tuiles PASTEL, chacune avec son ILLUSTRATION détourée en bas
//      à droite (plus d'icône lucide) : Trajets / Supérette / Fast-food, puis
//      Fidélité (large) + Partenaires (photo marine), puis Compte / Commandes /
//      Favoris ;
//   3. cartes PHOTOS horizontales « Autour de toi » — commerces RÉELLEMENT
//      PROCHES de la position exacte du client (jamais tout l'annuaire).
//
// Les socles pastel sont des tokens FIGÉS (--color-hub-*) : ce sont des
// surfaces-photo, elles ne basculent pas en sombre (sinon les illustrations
// claires disparaissent) — cf. reference_image_dark_light_stage.
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

/** Tuile de la grille : socle pastel + titre/sous-titre en haut à gauche +
 *  illustration détourée posée dessus. `dark` = la tuile marine Partenaires. */
function Tile({
  href,
  onClick,
  title,
  sub,
  tone,
  ratio,
  span2 = false,
  dark = false,
  img,
  imgClassName,
  children,
}: {
  href?: string;
  onClick?: () => void;
  title: string;
  sub: string;
  /** Classe du socle pastel figé (bg-hub-…). */
  tone: string;
  /** Rapport largeur/hauteur relevé sur la maquette. */
  ratio: string;
  span2?: boolean;
  dark?: boolean;
  img: string;
  /** Placement de l'illustration dans la tuile (mesuré sur la maquette). */
  imgClassName: string;
  children?: React.ReactNode;
}) {
  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className={cn("pointer-events-none absolute", imgClassName)}
      />
      <span className="relative block">
        <span
          className={cn(
            "text-caption min-[360px]:text-label sm:text-body-lg block leading-tight font-extrabold tracking-tight break-words",
            dark ? "text-on-brand" : "text-hub-ink"
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            "text-micro min-[360px]:text-caption mt-0.5 block leading-tight font-medium",
            dark ? "text-on-brand/75" : "text-hub-ink-soft"
          )}
        >
          {sub}
        </span>
      </span>
      {children}
    </>
  );
  const cls = cn(
    "relative block overflow-hidden rounded-lg p-2 transition min-[360px]:p-2.5 active:scale-[.98]",
    // Une tuile LARGE n'impose pas sa hauteur : elle s'étire sur celle de la
    // rangée, fixée par la tuile simple d'à côté (sinon le rapport s'applique
    // à deux colonnes et la tuile devient un pavé).
    span2 ? "col-span-2" : ratio,
    tone
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

  // « Autour de toi » = commerces PROCHES, jamais l'annuaire entier. Le SSR
  // part du cookie de position ; dès que le navigateur a la position EXACTE
  // (GPS ou repère posé sur la carte), on rejoue la requête de proximité avec
  // elle — même mécanique que la grille de l'accueil. Sans aucune position ni
  // zone connue, la section n'existe pas (on ne montre pas « tous les
  // commerçants d'Algérie » par défaut).
  const hasCoords = loc?.latitude != null && loc?.longitude != null;
  const hasZone = hasCoords || !!loc?.wilaya_code || !!loc?.commune;
  const liveNearby = useQuery({
    queryKey: [
      "hub-nearby",
      loc?.latitude ?? null,
      loc?.longitude ?? null,
      loc?.wilaya_code ?? null,
      loc?.commune ?? null,
    ],
    enabled: hasZone,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetchMerchantsForZone({
        // Position exacte prioritaire → filtre par RAYON réel côté serveur
        // (RPC merchants_nearby) et classement du plus proche au plus loin.
        latitude: loc?.latitude ?? null,
        longitude: loc?.longitude ?? null,
        wilaya_code: hasCoords ? null : (loc?.wilaya_code ?? null),
        commune: hasCoords ? null : (loc?.commune ?? null),
      });
      return res.map((m) => ({
        slug: m.slug,
        name: m.name,
        cover_url: m.cover_url,
        city: m.city,
      })) as NearbyMerchant[];
    },
  });

  const nearbyList = (liveNearby.data ?? nearby)
    .filter((m) => m.cover_url)
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-xl px-4 pb-6">
      {/* 1. Barre « Où va-t-on ? » → Trajets. */}
      {driveVisible && (
        <div className="bg-surface-2 mt-3 flex items-stretch rounded-lg">
          <Link
            href="/drive"
            className="flex min-w-0 flex-1 items-center gap-3 p-3"
          >
            <span className="bg-on-brand text-primary-600 rounded-card flex size-10 shrink-0 items-center justify-center">
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

      {/* 2. GRILLE de tuiles illustrées (maquette v2). */}
      <section className="mt-4 grid grid-cols-3 gap-2">
        {driveVisible && (
          <Tile
            href="/drive"
            title={t("cardRides")}
            sub={t("ridesSub")}
            tone="bg-hub-rides"
            ratio="aspect-[6/7]"
            img="/hub/trajets.webp"
            imgClassName="inset-x-0 bottom-[16%] h-[40%] object-contain"
          />
        )}
        <Tile
          href="/?category=fam_alimentation"
          title={t("cardSuperette")}
          sub={t("superetteSub")}
          tone="bg-hub-grocery"
          ratio="aspect-[6/7]"
          img="/hub/superette.webp"
          imgClassName="inset-x-0 bottom-[2%] h-[55%] object-contain"
        />
        <Tile
          href="/?category=fam_restauration"
          title={t("cardFood")}
          sub={t("foodSub")}
          tone="bg-hub-food"
          ratio="aspect-[6/7]"
          img="/hub/fastfood.webp"
          imgClassName="inset-x-0 bottom-[2%] h-[55%] object-contain"
        />
        {loyaltyVisible && (
          <Tile
            span2
            href="/cashback?tab=fidelite"
            title={t("cardLoyalty")}
            sub={t("loyaltySub")}
            tone="bg-hub-loyalty"
            ratio="aspect-[9/7]"
            img="/hub/fidelite.webp"
            imgClassName="inset-y-[2%] end-0 w-[64%] object-contain"
          />
        )}
        {/* Tuile MARINE à flèche (maquette) → feuille des espaces partenaires. */}
        <Tile
          dark
          onClick={() => setPartnersOpen(true)}
          title={t("partnersTile")}
          sub={t("partnersTileSub")}
          tone="bg-hub-partners"
          ratio="aspect-[9/7]"
          img="/hub/partenaires.webp"
          // Bande photo posée en bas, fondue dans le marine par un masque :
          // le fond de la photo n'est pas uni, un raccord net se verrait.
          imgClassName="bottom-0 start-0 w-[62%] [mask-image:linear-gradient(to_bottom,transparent,black_45%)]"
        >
          <span className="text-on-brand border-on-brand/85 absolute end-[4%] bottom-[10%] grid aspect-square w-[18%] place-items-center rounded-full border">
            <ArrowRight className="size-[45%] rtl:-scale-x-100" />
          </span>
        </Tile>
        <Tile
          href={isAuth ? "/compte" : "/se-connecter?next=/services"}
          title={isAuth ? t("cardAccount") : t("cardLogin")}
          sub={isAuth ? t("accountSub") : t("loginSub")}
          tone="bg-hub-login"
          ratio="aspect-[16/11]"
          img="/hub/connexion.webp"
          imgClassName="bottom-0 end-0 h-[56%] object-contain object-bottom min-[360px]:h-[68%]"
        />
        <Tile
          href="/commandes"
          title={t("ordersTile")}
          sub={t("ordersSub")}
          tone="bg-hub-orders"
          ratio="aspect-[16/11]"
          img="/hub/commandes.webp"
          imgClassName="bottom-[5%] end-[3%] h-[46%] object-contain"
        />
        <Tile
          href="/favoris"
          title={t("favsTile")}
          sub={t("favsSub")}
          tone="bg-hub-favs"
          ratio="aspect-[16/11]"
          img="/hub/favoris.webp"
          imgClassName="bottom-[5%] end-[3%] h-[52%] object-contain"
        />
      </section>

      {/* 3. Cartes PHOTOS « Autour de toi » — uniquement les commerces proches. */}
      {nearbyList.length > 0 && (
        <section className="mt-6">
          <h2 className="text-foreground text-heading-sm font-black tracking-tight">
            {t("nearbyTitle")}
          </h2>
          <div className="-mx-4 mt-2.5 flex scrollbar-none gap-3 overflow-x-auto px-4 pb-1">
            {nearbyList.map((m) => (
              <Link
                key={m.slug}
                href={`/m/${m.slug}`}
                className="relative aspect-[3/4] w-[26%] shrink-0 overflow-hidden rounded-lg transition active:scale-[.98]"
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
                <span className="text-on-brand absolute inset-x-0 bottom-0 p-2">
                  <span className="text-caption block leading-tight font-extrabold">
                    {m.name}
                  </span>
                  {m.city && (
                    <span className="text-micro mt-0.5 block font-medium opacity-80">
                      {m.city}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Feuille PARTENAIRES (depuis la tuile marine). */}
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
