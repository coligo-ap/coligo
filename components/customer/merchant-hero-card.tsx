"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  Phone,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ImageWithOverlay } from "@/components/ui/image-with-overlay";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { DAY_KEYS, DAY_LABELS, type OpeningHours } from "@/lib/types";
import { cn, formatDA } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";

/**
 * Carte de présentation COMPACTE du commerçant, sur la fiche /m/[slug].
 * - Logo overlap la cover (par-dessus)
 * - Toutes les infos (adresse, téléphone, minimum) DANS la carte
 * - Horaires en accordéon FERMÉ par défaut (ne pousse pas le catalogue)
 * - Description tronquée à 2 lignes, "Voir plus" si plus longue
 *
 * Objectif : libérer l'écran pour voir le catalogue le plus vite possible.
 */
export function MerchantHeroCard({
  name,
  category,
  description_fr,
  description_ar,
  cover_url,
  logo_url,
  address,
  commune,
  wilaya_name,
  phone_public,
  min_order_da,
  prep_time_min,
  opening_hours,
}: {
  name: string;
  category: string | null;
  description_fr: string | null;
  description_ar: string | null;
  cover_url: string | null;
  logo_url: string | null;
  address: string | null;
  commune: string | null;
  wilaya_name: string | null;
  phone_public: string | null;
  min_order_da: number;
  prep_time_min: number;
  opening_hours: OpeningHours;
}) {
  const [showHours, setShowHours] = useState(false);
  const [expandDesc, setExpandDesc] = useState(false);

  const addressLine =
    [address, commune, wilaya_name].filter(Boolean).join(" · ") || null;
  const hasDescription = Boolean(description_fr || description_ar);
  const heroSrc = cover_url ?? categoryImageFor(category) ?? null;
  const logoOptimized = cldUrl(logo_url, {
    width: 192,
    height: 192,
    crop: "fill",
    gravity: "auto",
  });

  return (
    <div>
      {/* Cover hero — overlay dégradé sombre en bas pour lisibilité du nom. */}
      <ImageWithOverlay
        src={heroSrc}
        alt={`Photo du commerce ${name}`}
        variant="hero"
        aspectClassName="aspect-[3/1]"
        priority
        className="rounded-[20px]"
        placeholder={
          <span className="text-primary-700/60 text-5xl font-bold">
            {name.charAt(0)}
          </span>
        }
      >
        <h1 className="text-2xl leading-tight font-bold drop-shadow-sm lg:text-3xl">
          {name}
        </h1>
        {category && <p className="mt-0.5 text-sm text-white/85">{category}</p>}
      </ImageWithOverlay>

      {/* Carte info */}
      <div className="bg-surface border-border relative mx-3 -mt-10 rounded-[20px] border p-4 shadow-sm lg:mx-10 lg:p-5">
        <div className="flex flex-wrap items-start gap-4">
          {logoOptimized ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoOptimized}
              alt=""
              loading="eager"
              decoding="async"
              className="-mt-16 size-20 shrink-0 rounded-full border-4 border-white bg-white object-cover shadow-md lg:-mt-20 lg:size-24"
            />
          ) : (
            <div className="bg-primary-100 text-primary-700 -mt-16 flex size-20 shrink-0 items-center justify-center rounded-full border-4 border-white text-2xl font-bold shadow-md lg:-mt-20 lg:size-24">
              {name.charAt(0)}
            </div>
          )}

          <div className="min-w-0 flex-1 pt-2">
            {/* Le nom + la catégorie sont déjà sur l'overlay du hero — on
                évite la duplication, on ne remet ici que le badge ouvert/fermé. */}
            <OpenStatusBadge hours={opening_hours} />
          </div>
        </div>

        {hasDescription && (
          <div className="mt-3">
            {description_fr && (
              <p
                className={cn(
                  "text-foreground text-sm",
                  !expandDesc && "line-clamp-2"
                )}
              >
                {description_fr}
              </p>
            )}
            {expandDesc && description_ar && (
              <p className="text-foreground mt-1 text-sm" dir="rtl">
                {description_ar}
              </p>
            )}
            {(description_fr && description_fr.length > 120) ||
            description_ar ? (
              <button
                type="button"
                onClick={() => setExpandDesc((v) => !v)}
                className="text-primary-700 mt-1 text-xs font-medium hover:underline"
              >
                {expandDesc ? "Voir moins" : "Voir plus"}
              </button>
            ) : null}
          </div>
        )}

        {/* Ligne d'infos rapide : adresse · tél · min · prep */}
        <ul className="text-muted mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {addressLine && (
            <li className="inline-flex items-center gap-1">
              <MapPin className="text-primary-600 size-3.5" />
              <span className="text-foreground">{addressLine}</span>
            </li>
          )}
          {phone_public && (
            <li className="inline-flex items-center gap-1">
              <Phone className="text-primary-600 size-3.5" />
              <a
                href={`tel:${phone_public}`}
                className="text-primary-700 hover:underline"
              >
                {phone_public}
              </a>
            </li>
          )}
          {min_order_da > 0 ? (
            <li className="inline-flex items-center gap-1">
              <Wallet className="text-primary-600 size-3.5" />
              <span className="text-foreground">
                Min <strong>{formatDA(min_order_da)}</strong>
              </span>
            </li>
          ) : (
            <li className="inline-flex items-center gap-1">
              <Wallet className="text-primary-600 size-3.5" />
              <Badge tone="success">Sans minimum</Badge>
            </li>
          )}
          {prep_time_min > 0 && (
            <li className="inline-flex items-center gap-1">
              <ShoppingBag className="text-primary-600 size-3.5" />
              <span className="text-foreground">~ {prep_time_min} min</span>
            </li>
          )}
        </ul>

        {/* Accordéon HORAIRES — fermé par défaut */}
        <div className="border-border mt-3 border-t pt-3">
          <button
            type="button"
            onClick={() => setShowHours((v) => !v)}
            aria-expanded={showHours}
            className="text-foreground hover:bg-surface-2 -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-sm font-medium transition-colors"
          >
            <Clock className="text-primary-600 size-4" />
            <span className="flex-1">Voir les horaires d&apos;ouverture</span>
            {showHours ? (
              <ChevronUp className="text-muted size-4" />
            ) : (
              <ChevronDown className="text-muted size-4" />
            )}
          </button>
          {showHours && (
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {DAY_KEYS.map((d) => {
                const slots = opening_hours[d] ?? [];
                return (
                  <li
                    key={d}
                    className="text-foreground flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-medium">{DAY_LABELS[d].long}</span>
                    <span className="text-muted tabular-nums">
                      {slots.length === 0
                        ? "Fermé"
                        : slots.map((s) => `${s.open}–${s.close}`).join(" · ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
