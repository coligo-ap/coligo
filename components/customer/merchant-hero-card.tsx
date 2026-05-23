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
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { DAY_KEYS, DAY_LABELS, type OpeningHours } from "@/lib/types";
import { cn, formatDA } from "@/lib/utils";

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

  return (
    <div>
      {/* Cover */}
      <div className="bg-surface-2 relative aspect-[3/1] w-full overflow-hidden rounded-[20px]">
        {cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="from-primary-500/15 to-surface-2 absolute inset-0 bg-gradient-to-br" />
        )}
      </div>

      {/* Carte info */}
      <div className="bg-surface border-border relative mx-3 -mt-10 rounded-[20px] border p-4 shadow-sm lg:mx-10 lg:p-5">
        <div className="flex flex-wrap items-start gap-4">
          {logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo_url}
              alt=""
              className="-mt-16 size-20 shrink-0 rounded-full border-4 border-white bg-white object-cover shadow-md lg:-mt-20 lg:size-24"
            />
          ) : (
            <div className="bg-primary-100 text-primary-700 -mt-16 flex size-20 shrink-0 items-center justify-center rounded-full border-4 border-white text-2xl font-bold shadow-md lg:-mt-20 lg:size-24">
              {name.charAt(0)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-foreground text-xl leading-tight font-bold lg:text-2xl">
              {name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {category && (
                <span className="text-muted text-sm">{category}</span>
              )}
              <OpenStatusBadge hours={opening_hours} />
            </div>
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
