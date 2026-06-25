"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BadgePercent, ChevronDown, Gift, Ticket } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import type { CartPromoSummary } from "@/lib/promotions/cart-summary";
import type { PublicPromotion } from "@/lib/data/customer-catalog";

// =============================================================================
// CartSavingsCard — récapitulatif premium du panier (style Uber Eats / Coligo).
// =============================================================================
// Élément CENTRAL de la page panier. Les chiffres essentiels restent visibles
// en permanence (sous-total, économies, total à payer). Le détail des promos
// appliquées et les codes promo dispo sont relégués dans une section repliable,
// FERMÉE par défaut, compacte et non intrusive — seuls les clients curieux
// l'ouvrent. Les promos elles-mêmes sont déjà mises en avant sur chaque produit
// (prix barré + nouveau prix + badge offert) directement dans la liste.
// =============================================================================

type Props = {
  summary: CartPromoSummary;
  /** Codes promo dispo (non encore appliqués — saisis au paiement). */
  codePromos: PublicPromotion[];
  /** Total au prix catalogue (avant toute promo) = sous-total affiché. */
  normalTotalDa: number;
  /** Total après réductions produit / offres = total à payer. */
  subtotalDa: number;
};

export function CartSavingsCard({
  summary,
  codePromos,
  normalTotalDa,
  subtotalDa,
}: Props) {
  const t = useTranslations("cart");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [open, setOpen] = useState(false);

  const { applied, totalSavingsDa } = summary;
  const hasSavings = totalSavingsDa > 0;
  const hasDetail = applied.length > 0 || codePromos.length > 0;

  const promoTitle = (p: { titleFr: string; titleAr: string | null }) =>
    (isAr && p.titleAr) || p.titleFr;

  return (
    <section className="border-border bg-surface mt-4 overflow-hidden rounded-[18px] border shadow-sm">
      {/* Récapitulatif — toujours visible, hiérarchie claire. */}
      <div className="px-4 pt-3.5 pb-3.5">
        <div className="flex items-center justify-between text-[13.5px]">
          <span className="text-muted font-semibold">{t("subtotalLabel")}</span>
          <span className="text-foreground font-bold tabular-nums">
            {formatDA(normalTotalDa)}
          </span>
        </div>

        {hasSavings && (
          <div className="mt-1.5 flex items-center justify-between text-[13.5px]">
            <span className="font-bold text-rose-600 dark:text-rose-300">
              {t("savingsLabel")}
            </span>
            <span className="font-extrabold text-rose-600 tabular-nums dark:text-rose-300">
              −{formatDA(totalSavingsDa)}
            </span>
          </div>
        )}

        <div className="border-border mt-3 flex items-end justify-between border-t pt-3">
          <span className="text-foreground text-[15px] font-extrabold">
            {t("toPayLabel")}
          </span>
          <span className="text-primary-700 dark:text-primary-200 text-[24px] leading-none font-black tracking-[-0.6px] tabular-nums">
            {formatDA(subtotalDa)}
          </span>
        </div>
      </div>

      {/* Détail des avantages — replié par défaut, non intrusif. */}
      {hasDetail && (
        <div className="border-border border-t">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-primary-700 dark:text-primary-300 flex w-full items-center justify-between gap-2 px-4 py-3 text-[12.5px] font-bold"
          >
            <span className="inline-flex items-center gap-1.5">
              <BadgePercent className="size-4 text-rose-500" />
              {t("promoDetailsToggle")}
            </span>
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                open && "rotate-180"
              )}
            />
          </button>

          {open && (
            <div className="space-y-1.5 px-4 pb-3.5">
              {applied.map((p) => (
                <div
                  key={p.id}
                  className="bg-surface-2 flex items-center gap-2.5 rounded-[10px] px-3 py-2"
                >
                  <span className="text-foreground min-w-0 flex-1">
                    <span className="line-clamp-1 text-[12.5px] font-bold">
                      {promoTitle(p)}
                    </span>
                    <span className="text-muted flex items-center gap-1 text-[10.5px] font-semibold">
                      {p.type === "quantity_offer" ? (
                        <>
                          <Gift className="size-3 text-rose-500" />
                          {t("freeApplied", { count: p.freeUnits })}
                        </>
                      ) : (
                        <>
                          <BadgePercent className="size-3 text-rose-500" />
                          {t("productPromoLabel")}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="text-success-700 dark:text-success-400 shrink-0 text-[12.5px] font-black tabular-nums">
                    −{formatDA(p.savingsDa)}
                  </span>
                </div>
              ))}

              {/* Codes promo dispo — appliqués à l'étape paiement. */}
              {codePromos.length > 0 && (
                <div className="pt-1">
                  <span className="text-primary-700 dark:text-primary-300 flex items-center gap-1.5 text-[11px] font-bold">
                    <Ticket className="size-3.5 text-rose-500" />
                    {t("promoCodeHint")}
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {codePromos.map((p) => {
                      const val =
                        p.discount_kind === "percent"
                          ? `−${p.discount_value} %`
                          : `−${formatDA(p.discount_value ?? 0)}`;
                      return (
                        <span
                          key={p.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10.5px] font-bold text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300"
                        >
                          <span className="font-mono font-black tracking-wider">
                            {p.code}
                          </span>
                          <span className="font-black">{val}</span>
                          {p.min_subtotal_da != null && (
                            <span className="text-rose-500/80">
                              ·{" "}
                              {t("promoCodeFrom", {
                                amount: formatDA(p.min_subtotal_da),
                              })}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
