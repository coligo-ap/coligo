"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, Ticket, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import type { PublicPromotion } from "@/lib/data/customer-catalog";

// =============================================================================
// MerchantPromoCodes — codes promo de la boutique, mis en avant (carte rouge
// type ticket). Le client touche le code pour le copier ; les conditions sont
// résumées, avec un lien « Voir les conditions » ouvrant une fenêtre détaillée.
// =============================================================================

export function MerchantPromoCodes({
  promotions,
}: {
  promotions: PublicPromotion[];
}) {
  const valid = promotions.filter((p) => p.type === "promo_code" && p.code);
  if (valid.length === 0) return null;
  return (
    <div className="space-y-2">
      {valid.map((p) => (
        <PromoCodeCard key={p.id} promotion={p} />
      ))}
    </div>
  );
}

/** Libellé court de la réduction : « -20 % » ou « -200 DA ». */
function discountLabel(
  p: PublicPromotion,
  t: ReturnType<typeof useTranslations>
): string {
  if (p.discount_kind === "percent" && p.discount_value != null) {
    return t("promoDiscountPercent", { value: p.discount_value });
  }
  if (p.discount_kind === "amount" && p.discount_value != null) {
    return t("promoDiscountAmount", { amount: formatDA(p.discount_value) });
  }
  return "";
}

function PromoCodeCard({ promotion }: { promotion: PublicPromotion }) {
  const t = useTranslations("merchant");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const code = (promotion.code ?? "").toUpperCase();
  const discount = discountLabel(promotion, t);

  // Conditions structurées (pour le résumé + la fenêtre détaillée).
  const conditions = useMemo(() => {
    const list: string[] = [];
    if (promotion.min_subtotal_da != null) {
      list.push(
        t("promoMinBasket", { amount: formatDA(promotion.min_subtotal_da) })
      );
    } else {
      list.push(t("promoNoCondition"));
    }
    if (promotion.ends_at) {
      const d = new Date(promotion.ends_at).toLocaleDateString(
        locale === "ar" ? "ar-DZ" : "fr-DZ",
        { day: "numeric", month: "long", year: "numeric" }
      );
      list.push(t("promoExpiresOn", { date: d }));
    }
    return list;
  }, [promotion, t, locale]);

  // Résumé compact = 1re condition (montant min). Le reste passe en « Voir … ».
  const summary = conditions[0];
  const hasMore = conditions.length > 1;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Repli : sélection impossible → on signale quand même la copie.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className={cn(
          // Fond = bg-accent-50 SOLIDE (et non un dégradé from-accent-50) : seul
          // .bg-accent-50 est remappé par le thème sombre de l'app (globals.css).
          // Un dégradé `from-accent-*` + variant `dark:` (basé système, pas sur
          // .theme-dark) laissait la carte rose pâle CLAIRE sur fond sombre.
          "group border-accent-300 bg-accent-50 relative flex w-full items-center gap-3 overflow-hidden rounded-[16px] border border-dashed px-3.5 py-3 text-start transition-transform active:scale-[0.99]"
        )}
      >
        {/* Pastille réduction */}
        <span className="bg-accent-600 grid size-11 shrink-0 place-items-center rounded-[12px] text-white shadow-sm">
          <Ticket className="size-5" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            {/* Titre + réduction en ROSE FONCÉ (accent-700). PAS de variant
                `dark:` ici : il suit le thème SYSTÈME (pas .theme-dark de
                l'app) → rose pâle à tort sur téléphone sombre + app claire.
                Le sombre de l'app est déjà géré par le remap .theme-dark
                de globals.css (text-accent-600/700 → rose lisible). */}
            <span className="text-accent-700 truncate text-sm font-extrabold">
              {promotion.title_fr || t("promoCodeTitle")}
            </span>
            {discount && (
              <span className="text-accent-700 shrink-0 text-xs font-black">
                {discount}
              </span>
            )}
          </span>
          {/* Code en rouge + résumé des conditions */}
          <span className="mt-0.5 flex items-center gap-2">
            {/* Plaque du code : TOUJOURS blanche (bg-[#fff] non remappé par le
                thème sombre) pour un rendu « ticket » et une lisibilité maximale. */}
            <span className="border-accent-300 rounded-md border bg-[#fff] px-2 py-0.5 font-mono text-sm font-black tracking-wider text-[#e6007a]">
              {code}
            </span>
            <span className="text-accent-500/90 text-[11px] font-medium">
              {copied ? t("promoCodeCopied") : t("promoCodeTap")}
            </span>
          </span>
          <span className="text-muted mt-1 block truncate text-[11px]">
            {summary}
            {hasMore && (
              <>
                {" · "}
                <span
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      setOpen(true);
                    }
                  }}
                  className="font-semibold text-[#2563eb] underline"
                >
                  {t("promoSeeConditions")}
                </span>
              </>
            )}
          </span>
        </span>

        {/* Icône copier */}
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full shadow-sm transition-colors",
            // Bouton copier : plaque blanche forcée (comme le code), sauf état
            // « copié » qui passe au vert de confirmation.
            copied ? "bg-success-600 text-white" : "bg-[#fff] text-[#e6007a]"
          )}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </span>
      </button>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="bg-surface flex w-full max-w-md flex-col rounded-t-[20px] shadow-xl sm:rounded-[20px]">
              <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
                <h2 className="font-display text-foreground text-lg font-bold">
                  {t("promoConditionsTitle")}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-muted hover:bg-surface-2 rounded-full p-1.5"
                  aria-label={t("promoClose")}
                >
                  <X className="size-5" />
                </button>
              </header>
              <div className="space-y-3 px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="border-accent-300 bg-accent-50 text-accent-600 rounded-md border px-2.5 py-1 font-mono text-base font-black tracking-wider">
                    {code}
                  </span>
                  {discount && (
                    <span className="text-accent-600 text-sm font-black">
                      {discount}
                    </span>
                  )}
                </div>
                {promotion.title_fr && (
                  <p className="text-foreground text-sm font-semibold">
                    {promotion.title_fr}
                  </p>
                )}
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
          </div>
        </Portal>
      )}
    </>
  );
}
