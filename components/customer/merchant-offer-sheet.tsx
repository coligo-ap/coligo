"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check, Copy, Store, Ticket, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import type { BannerOffer } from "@/lib/data/promo-banners";

// =============================================================================
// MerchantOfferSheet — pop-up « Récupérer mon offre / mon code ».
// =============================================================================
// Ouverte au clic sur une bannière « offre commerçant » (mig 0330). Affiche les
// détails LIVE de la promotion (déjà renvoyés par la RPC quand la bannière est
// visible → aucune requête ici, aucune donnée hors zone). Le client peut copier
// le code s'il y en a un, lit les conditions, puis file sur la boutique pour en
// profiter. Coligo NE modifie PAS l'offre : elle relaie ce que le commerçant a
// publié.
// =============================================================================

/** Valeur mise en avant de l'offre (« −20 % », « 2 achetés = 1 offert », …). */
function offerValueText(
  o: BannerOffer,
  t: ReturnType<typeof useTranslations>
): string {
  const val =
    o.discount_value != null ? Math.round(Number(o.discount_value)) : 0;
  if (o.type === "free_delivery") return t("offerFreeDelivery");
  if (o.type === "free_gift") return o.gift_label || t("offerGift");
  if (o.type === "quantity_offer" && o.buy_qty && o.get_qty) {
    return t("offerValueQty", { buy: o.buy_qty, get: o.get_qty });
  }
  if (o.type === "flash_sale" && val) {
    return o.discount_kind === "percent"
      ? t("offerValuePercent", { value: val })
      : t("offerValueAmount", { amount: formatDA(val) });
  }
  if (o.type === "anti_gaspillage" && val) {
    return o.discount_kind === "percent"
      ? t("offerValuePercent", { value: val })
      : t("offerValueAmount", { amount: formatDA(val) });
  }
  if (val && o.discount_kind === "percent") {
    return t("offerValuePercent", { value: val });
  }
  if (val && o.discount_kind === "amount") {
    return t("offerValueAmount", { amount: formatDA(val) });
  }
  if (o.type === "promo_code") return t("offerValueCode");
  return t("offerValueGeneric");
}

export function MerchantOfferSheet({
  offer,
  headline,
  open,
  onClose,
}: {
  offer: BannerOffer;
  headline: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("browse");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const code = (offer.code ?? "").toUpperCase();
  const value = offerValueText(offer, t);
  const title =
    locale === "ar" && offer.title_ar ? offer.title_ar : offer.title_fr;

  const conditions: string[] = [];
  if (offer.min_subtotal_da != null) {
    conditions.push(
      t("offerMinBasket", { amount: formatDA(offer.min_subtotal_da) })
    );
  }
  if (offer.ends_at) {
    const d = new Date(offer.ends_at).toLocaleDateString(
      locale === "ar" ? "ar-DZ" : "fr-DZ",
      {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Algiers",
      }
    );
    conditions.push(t("offerExpiresOn", { date: d }));
  }
  if (conditions.length === 0) conditions.push(t("offerNoCondition"));

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* copie best-effort */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="bg-surface flex w-full max-w-md flex-col rounded-t-xl pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-xl"
          role="dialog"
          aria-modal="true"
        >
          <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
            <h2 className="font-display text-foreground text-lg font-bold">
              {t("offerSheetTitle")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:bg-surface-2 rounded-full p-1.5"
              aria-label={t("offerClose")}
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="space-y-4 px-5 py-4">
            {/* Valeur + intitulé + commerçant */}
            <div className="flex items-start gap-3">
              <span className="bg-accent-600 rounded-card-lg grid size-12 shrink-0 place-items-center text-white shadow-sm">
                <Ticket className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="text-accent-700 text-lg leading-tight font-black">
                  {value}
                  {offer.type === "free_delivery" && (
                    <span className="text-muted text-label ml-1.5 font-semibold">
                      · {t("offerTourOnly")}
                    </span>
                  )}
                </p>
                <p className="text-foreground text-sm font-semibold">
                  {headline || title}
                </p>
                <p className="text-muted text-label mt-0.5 flex items-center gap-1">
                  <Store className="size-3.5 shrink-0" /> {offer.merchant_name}
                </p>
              </div>
            </div>

            {/* Code copiable (si l'offre en a un) */}
            {code && (
              <button
                type="button"
                onClick={copy}
                className="border-accent-300 bg-accent-50 rounded-card-lg flex w-full items-center gap-3 border border-dashed px-3.5 py-3"
              >
                <span className="border-accent-300 rounded-md border bg-[#fff] px-2.5 py-1 font-mono text-base font-black tracking-wider text-[var(--color-accent-600)]">
                  {code}
                </span>
                <span className="text-accent-600 text-label flex-1 text-start font-medium">
                  {copied ? t("offerCodeCopied") : t("offerTapCode")}
                </span>
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full shadow-sm transition-colors",
                    copied
                      ? "bg-success-600 text-white"
                      : "bg-[#fff] text-[var(--color-accent-600)]"
                  )}
                >
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </span>
              </button>
            )}

            {/* Conditions */}
            <div>
              <p className="text-foreground text-label mb-1.5 font-bold">
                {t("offerConditions")}
              </p>
              <ul className="space-y-1.5">
                {conditions.map((c, i) => (
                  <li
                    key={i}
                    className="text-muted flex items-start gap-2 text-sm"
                  >
                    <Check className="text-accent-500 mt-0.5 size-4 shrink-0" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* CTA → boutique du commerçant (là où l'offre est utilisable). */}
          <div className="border-border border-t px-5 py-4">
            <Link
              href={`/m/${offer.merchant_slug}`}
              onClick={onClose}
              className="bg-primary-600 hover:bg-primary-700 rounded-card-lg flex h-12 w-full items-center justify-center gap-1.5 text-sm font-bold text-white"
            >
              {t("offerGoToMerchant", { merchant: offer.merchant_name })}
              <ArrowRight className="size-4 rtl:-scale-x-100" />
            </Link>
          </div>
        </div>
      </div>
    </Portal>
  );
}
