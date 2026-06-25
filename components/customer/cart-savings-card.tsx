"use client";

import { useLocale, useTranslations } from "next-intl";
import { BadgePercent, Check, Gift, PartyPopper, Ticket } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import type { CartPromoSummary } from "@/lib/promotions/cart-summary";
import type { PublicPromotion } from "@/lib/data/customer-catalog";

// =============================================================================
// CartSavingsCard — bloc « Vos avantages » premium (style Uber Eats / Coligo).
// =============================================================================
// Affiché AU-DESSUS du récapitulatif dès qu'au moins une promo s'applique. Met
// en avant, en moins d'une seconde : combien de promos sont actives, le détail
// de chacune avec son gain, l'économie totale, et le prix initial barré → final.
// Les codes promo (appliqués à l'étape paiement) sont présentés en « teaser ».
// =============================================================================

type Props = {
  summary: CartPromoSummary;
  /** Codes promo dispo (non encore appliqués — saisis au paiement). */
  codePromos: PublicPromotion[];
  /** Total au prix catalogue (avant toute promo). */
  normalTotalDa: number;
  /** Sous-total après réductions produit / offres (prix panier). */
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

  const { applied, count, totalSavingsDa } = summary;
  const hasSavings = count > 0 && totalSavingsDa > 0;

  // Rien à valoriser : pas de promo appliquée ET pas de code dispo → on n'affiche
  // pas le bloc (il ne doit jamais apparaître « vide »).
  if (!hasSavings && codePromos.length === 0) return null;

  const promoTitle = (p: { titleFr: string; titleAr: string | null }) =>
    (isAr && p.titleAr) || p.titleFr;

  return (
    <section className="cg-promo-rise border-primary-100 from-primary-50 dark:border-primary-500/20 dark:from-primary-950/30 dark:to-surface relative mt-3 overflow-hidden rounded-[20px] border bg-gradient-to-b to-white shadow-[0_1px_2px_rgba(20,20,50,0.04),0_10px_30px_-14px_rgba(108,43,217,0.30)]">
      {/* Halo décoratif discret. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -end-8 -top-10 size-32 rounded-full bg-[radial-gradient(circle,rgba(108,43,217,0.10),transparent_70%)]"
      />

      {hasSavings && (
        <>
          {/* En-tête : nombre de promos + économie totale (pastille rose). */}
          <header className="relative flex items-center gap-3 px-4 pt-4 pb-3">
            <span className="from-primary-500 to-primary-700 grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-gradient-to-br text-white shadow-[0_6px_14px_-4px_rgba(108,43,217,0.55)]">
              <PartyPopper className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-primary-900 dark:text-primary-100 text-[15px] leading-tight font-black">
                {t("promosApplied", { count })}
              </p>
              <p className="text-primary-700/80 dark:text-primary-300/80 text-[11.5px] font-semibold">
                {t("promosAppliedSub")}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-rose-600 px-2.5 py-1 text-[12.5px] font-black text-white tabular-nums shadow-[0_4px_12px_-3px_rgba(225,29,72,0.55)]">
              −{formatDA(totalSavingsDa)}
            </span>
          </header>

          {/* Résumé des avantages : une ligne ✅ par promo. */}
          <ul className="relative space-y-1.5 px-4 pb-1">
            {applied.map((p) => (
              <li
                key={p.id}
                className="bg-surface/70 dark:bg-surface flex items-center gap-2.5 rounded-[12px] px-3 py-2 shadow-[0_1px_2px_rgba(20,20,50,0.04)]"
              >
                <span className="bg-success-100 text-success-700 dark:bg-success-500/20 grid size-[26px] shrink-0 place-items-center rounded-full">
                  <Check className="size-[15px]" strokeWidth={3} />
                </span>
                <span className="text-foreground min-w-0 flex-1">
                  <span className="line-clamp-1 text-[13px] font-bold">
                    {promoTitle(p)}
                  </span>
                  <span className="text-muted flex items-center gap-1 text-[11px] font-semibold">
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
                <span className="text-success-700 dark:text-success-400 shrink-0 text-[13px] font-black tabular-nums">
                  −{formatDA(p.savingsDa)}
                </span>
              </li>
            ))}
          </ul>

          {/* Prix initial barré → économies → sous-total final (élément héros). */}
          <div className="dark:bg-surface-2/60 relative mx-4 mt-2.5 mb-3 rounded-[14px] bg-white/80 px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(108,43,217,0.08)]">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-muted font-semibold">
                {t("initialPrice")}
              </span>
              <span className="text-subtle font-semibold tabular-nums line-through">
                {formatDA(normalTotalDa)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[12.5px]">
              <span className="font-bold text-rose-600 dark:text-rose-300">
                {t("totalSavings")}
              </span>
              <span className="font-extrabold text-rose-600 tabular-nums dark:text-rose-300">
                −{formatDA(totalSavingsDa)}
              </span>
            </div>
            <div className="border-primary-100 dark:border-primary-500/20 mt-2 flex items-end justify-between border-t pt-2">
              <span className="text-foreground text-[13px] font-extrabold">
                {t("cartTotalLabel")}
              </span>
              <span className="text-primary-700 dark:text-primary-200 text-[22px] leading-none font-black tracking-[-0.6px] tabular-nums">
                {formatDA(subtotalDa)}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Teaser codes promo : non appliqués ici, valables à l'étape paiement. */}
      {codePromos.length > 0 && (
        <div
          className={cn(
            "relative flex flex-wrap items-center gap-1.5 px-4 pb-4",
            hasSavings
              ? "border-primary-100 dark:border-primary-500/20 border-t pt-3"
              : "pt-4"
          )}
        >
          <span className="text-primary-700 dark:text-primary-300 flex w-full items-center gap-1.5 text-[11.5px] font-bold">
            <Ticket className="size-4 text-rose-500" />
            {t("promoCodeHint")}
          </span>
          {codePromos.map((p) => {
            const val =
              p.discount_kind === "percent"
                ? `−${p.discount_value} %`
                : `−${formatDA(p.discount_value ?? 0)}`;
            return (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300"
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
      )}
    </section>
  );
}
