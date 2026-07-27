"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgePercent,
  Check,
  ChevronUp,
  Copy,
  Gift,
  Loader2,
  Minus,
  Plus,
  ShoppingCart,
  Ticket,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn, formatDA } from "@/lib/utils";
import { clearCart, setItemQuantity, useCart } from "@/lib/customer/cart-store";
import {
  formatQty,
  isFractionalUnit,
  maxQtyFor,
  minQtyFor,
  qtyStep,
  roundQty,
} from "@/lib/units";
import { computeCart, isPromotionActive } from "@/lib/promotions/engine";
import { toEnginePromotions } from "@/lib/promotions/cart-summary";
import { APP_CONFIG } from "@/lib/config/app-config";
import { useConfirm } from "@/components/ui/confirm";
import { getCartPromotions } from "@/app/(customer)/cart/actions";
import {
  createSharedCartFromLocal,
  getOpenSharedCart,
} from "@/app/(customer)/panier-partage/actions";
import type { PublicPromotion } from "@/lib/data/customer-catalog";

export function CartView({
  sharedCartEnabled = false,
}: {
  /** Panier partagé actif (kill-switch super-admin, mig 0405). */
  sharedCartEnabled?: boolean;
}) {
  const t = useTranslations("cart");
  const tsc = useTranslations("sharedCart");
  const router = useRouter();
  const locale = useLocale();
  const isAr = locale === "ar";
  const confirm = useConfirm();
  const [detailOpen, setDetailOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const cart = useCart();
  const empty = cart.items.length === 0;

  // « Inviter la famille » : reprend un panier partagé encore OUVERT chez ce
  // commerçant, sinon en crée un à partir du panier local, puis ouvre la room.
  const inviteFamily = async () => {
    if (!cart.merchant_id || inviteBusy) return;
    setInviteError(null);
    setInviteBusy(true);
    try {
      const existing = await getOpenSharedCart(cart.merchant_id);
      if (existing) {
        router.push(`/p/${existing.token}`);
        return;
      }
      const res = await createSharedCartFromLocal({
        merchant_id: cart.merchant_id,
        items: cart.items.map((i) => ({
          product_id: i.product_id,
          option_ids: (i.options ?? []).map((o) => o.option_id),
          quantity: i.quantity,
        })),
      });
      if (res.ok) {
        router.push(`/p/${res.token}`);
        return;
      }
      if (res.reason === "not_a_customer") {
        // Non connecté → authentification PUIS reprise AUTOMATIQUE de
        // l'invitation (`?invite=1` relance inviteFamily au retour : le
        // client atterrit directement dans la room du panier partagé).
        router.push(
          `/se-connecter?next=${encodeURIComponent("/cart?invite=1")}`
        );
        return;
      }
      setInviteError(res.error);
    } finally {
      setInviteBusy(false);
    }
  };

  // Retour de connexion avec `?invite=1` : on relance l'action demandée —
  // une seule fois — après avoir nettoyé l'URL (replaceState, zéro round-trip).
  const sp = useSearchParams();
  const inviteResumed = useRef(false);
  useEffect(() => {
    if (inviteResumed.current || sp.get("invite") !== "1") return;
    if (!cart.merchant_id) return;
    inviteResumed.current = true;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("invite");
      window.history.replaceState(null, "", u);
    } catch {
      /* URL API indispo — sans gravité */
    }
    void inviteFamily();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, cart.merchant_id]);

  // Promotions actives du commerçant du panier (réduction / offre quantité /
  // code). On applique LE MÊME moteur que le checkout → mêmes prix partout.
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);
  const merchantId = cart.merchant_id;
  useEffect(() => {
    let alive = true;
    if (!merchantId) {
      setPromotions([]);
      return;
    }
    void getCartPromotions(merchantId).then((p) => {
      if (alive) setPromotions(p);
    });
    return () => {
      alive = false;
    };
  }, [merchantId]);

  const enginePromos = useMemo(
    () => toEnginePromotions(promotions),
    [promotions]
  );

  const settled = useMemo(
    () =>
      computeCart(
        cart.items.map((i) => ({
          productId: i.product_id,
          quantity: i.quantity,
          unitPriceDa: i.unit_price_da,
        })),
        enginePromos,
        {
          minPriceDa: APP_CONFIG.promotions.minPriceDa,
          commissionRate: APP_CONFIG.commission.rate,
        }
      ),
    [cart.items, enginePromos]
  );

  // Offre quantité par produit (la plus généreuse) — pour le libellé/indice.
  const offerByProduct = useMemo(() => {
    const map: Record<string, { buy: number; get: number }> = {};
    for (const p of promotions) {
      if (p.type !== "quantity_offer" || !p.buy_qty || !p.get_qty) continue;
      if (
        !isPromotionActive({
          status: p.status,
          startsAt: p.starts_at,
          endsAt: p.ends_at,
        })
      )
        continue;
      for (const pid of p.product_ids) {
        const prev = map[pid];
        const ratio = p.get_qty / (p.buy_qty + p.get_qty);
        const prevRatio = prev ? prev.get / (prev.buy + prev.get) : -1;
        if (ratio > prevRatio) map[pid] = { buy: p.buy_qty, get: p.get_qty };
      }
    }
    return map;
  }, [promotions]);

  // Codes promo actifs (teaser — appliqués au checkout).
  const codePromos = useMemo(
    () =>
      promotions.filter(
        (p) =>
          p.type === "promo_code" &&
          p.code &&
          isPromotionActive({
            status: p.status,
            startsAt: p.starts_at,
            endsAt: p.ends_at,
          })
      ),
    [promotions]
  );

  // Nom de chaque promotion (localisé) pour l'attribuer au produit concerné.
  const promoNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of promotions) m.set(p.id, (isAr && p.title_ar) || p.title_fr);
    return m;
  }, [promotions, isAr]);

  // Détail des avantages PAR PRODUIT : pour chaque ligne en promo, ce que le
  // client gagne selon le type (réduction % avec prix barré, ou unités offertes)
  // + le montant économisé sur ce produit + la/les promo(s) qui s'y appliquent.
  const productBenefits = useMemo(() => {
    return cart.items
      .map((item, index) => {
        // Aligné par INDEX : settled.lines suit l'ordre de cart.items → correct
        // même pour 2 variantes du même produit (même product_id, options ≠).
        const cl = settled.lines[index];
        const appliedUnit = cl?.appliedUnitPriceDa ?? item.unit_price_da;
        const freeUnits = cl?.freeUnits ?? 0;
        const hasDiscount = appliedUnit < item.unit_price_da;
        const discountPct = hasDiscount
          ? Math.round(
              ((item.unit_price_da - appliedUnit) / item.unit_price_da) * 100
            )
          : 0;
        const discountSavings = hasDiscount
          ? (item.unit_price_da - appliedUnit) * item.quantity
          : 0;
        const freeSavings = freeUnits > 0 ? appliedUnit * freeUnits : 0;
        const totalSaved = Math.round(discountSavings + freeSavings);
        const names: string[] = [];
        if (hasDiscount && cl?.productPromotionId) {
          const n = promoNameById.get(cl.productPromotionId);
          if (n) names.push(n);
        }
        if (freeUnits > 0 && cl?.quantityPromotionId) {
          const n = promoNameById.get(cl.quantityPromotionId);
          if (n && !names.includes(n)) names.push(n);
        }
        return {
          item,
          appliedUnit,
          freeUnits,
          hasDiscount,
          discountPct,
          totalSaved,
          names,
        };
      })
      .filter((b) => b.totalSaved > 0 || b.freeUnits > 0);
  }, [cart.items, settled, promoNameById]);

  // Compteur « articles » : une ligne au poids/volume compte pour 1 article
  // (afficher « 2,75 articles » n'aurait pas de sens).
  const units = cart.items.reduce(
    (s, i) => s + (isFractionalUnit(i.unit) ? 1 : i.quantity),
    0
  );
  const subtotal = settled.subtotalDa;
  const savings = Math.max(0, settled.normalTotalDa - settled.subtotalDa);
  const cashbackGain = Math.round(subtotal * 0.03);
  const hasDetail = productBenefits.length > 0 || codePromos.length > 0;

  if (empty) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <ShoppingCart className="text-primary-500 mx-auto size-12" />
        <h1 className="text-foreground mt-4 text-2xl font-bold">
          {t("emptyTitle")}
        </h1>
        <p className="text-muted mt-2 text-sm">{t("emptySubtitle")}</p>
        <Link
          href="/"
          className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex items-center justify-center rounded-[10px] px-4 py-2 text-sm font-medium text-white"
        >
          {t("seeMerchants")}
        </Link>
      </div>
    );
  }

  // Déclencheur du détail des avantages : en BAS de la carte quand fermé,
  // migré EN TÊTE du panneau quand ouvert (même bouton, même chevron).
  const detailToggle = (
    <button
      type="button"
      onClick={() => setDetailOpen((v) => !v)}
      aria-expanded={detailOpen}
      className="text-primary-700 flex w-full items-center justify-between gap-2 text-[12.5px] font-bold"
    >
      <span className="inline-flex items-center gap-1.5">
        <BadgePercent className="text-accent-600 size-4" />
        {t("promoDetailsToggle")}
      </span>
      <ChevronUp
        className={cn(
          "size-4 transition-transform",
          detailOpen && "rotate-180"
        )}
      />
    </button>
  );

  return (
    <div className="mx-auto max-w-[560px] px-4 pt-3 pb-56">
      {cart.merchant_slug && (
        <Link
          href={`/m/${cart.merchant_slug}`}
          className="bg-surface-2 text-foreground mb-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("backTo")}{" "}
          <span className="text-primary-700">
            {cart.merchant_name ?? t("theShop")}
          </span>
        </Link>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-foreground text-[26px] font-black tracking-[-0.8px]">
          {t("title")}
        </h1>
        <button
          type="button"
          onClick={async () => {
            const ok = await confirm({
              title: t("clearTitle"),
              message: t("clearConfirm"),
              confirmLabel: t("clear"),
              cancelLabel: t("cancel"),
              danger: true,
            });
            if (ok) clearCart();
          }}
          className="text-danger-600 inline-flex items-center gap-1 text-[13px] font-bold"
        >
          <Trash2 className="size-4" />
          {t("clear")}
        </button>
      </div>
      {/* Pas de « chez {commerçant} » sous le titre : le nom est DÉJÀ dans le
          bouton « Retour à … » juste au-dessus (règle : jamais la même info
          deux fois sur un écran). */}

      {/* Lignes produit — promos appliquées (prix barré, offert, badges). */}
      <div className="mt-3 space-y-2.5">
        {cart.items.map((item, index) => {
          const cl = settled.lines[index];
          const rawLineTotal = Math.round(item.unit_price_da * item.quantity);
          const lineTotal = cl?.lineTotalDa ?? rawLineTotal;
          const appliedUnit = cl?.appliedUnitPriceDa ?? item.unit_price_da;
          const hasDiscount = appliedUnit < item.unit_price_da;
          const freeUnits = cl?.freeUnits ?? 0;
          const offer = offerByProduct[item.product_id];
          const discountPct = hasDiscount
            ? Math.round(
                ((item.unit_price_da - appliedUnit) / item.unit_price_da) * 100
              )
            : 0;
          // Indice « ajoutez-en N » si une offre existe mais pas encore atteinte.
          const groupSize = offer ? offer.buy + offer.get : 0;
          const needForOffer =
            offer && freeUnits === 0 && item.quantity < groupSize
              ? groupSize - item.quantity
              : 0;

          return (
            <div
              key={item.line_key}
              className="border-border bg-surface flex items-center gap-3 rounded-[16px] border p-3 shadow-sm"
            >
              <div className="bg-surface-2 relative size-[58px] shrink-0 overflow-hidden rounded-[8px]">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
                {hasDiscount && discountPct > 0 && (
                  <span className="bg-accent-600 absolute start-1 top-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold text-white shadow-sm">
                    −{discountPct}%
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-foreground line-clamp-1 text-sm font-bold">
                    {item.name}
                  </p>
                  <div className="shrink-0 text-right">
                    <p
                      className={cn(
                        "text-[15px] font-extrabold tabular-nums",
                        lineTotal < rawLineTotal
                          ? "text-accent-600"
                          : "text-foreground"
                      )}
                    >
                      {formatDA(lineTotal)}
                    </p>
                    {lineTotal < rawLineTotal && (
                      <p className="text-subtle text-[11px] tabular-nums line-through">
                        {formatDA(rawLineTotal)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Options/variantes choisies. */}
                {item.options && item.options.length > 0 && (
                  <p className="text-muted mt-0.5 line-clamp-2 text-[11px] font-medium">
                    {item.options.map((o) => o.option_name_fr).join(" · ")}
                  </p>
                )}

                {/* Prix unitaire (barré si réduction). */}
                <p className="text-muted mt-0.5 text-xs font-semibold">
                  {hasDiscount ? (
                    <>
                      <span className="text-accent-600 font-bold">
                        {formatDA(appliedUnit)}
                      </span>{" "}
                      <span className="text-subtle line-through">
                        {formatDA(item.unit_price_da)}
                      </span>
                    </>
                  ) : (
                    t("perUnit", { price: formatDA(item.unit_price_da) })
                  )}
                </p>

                {/* Badges promo (offre quantité). */}
                {(freeUnits > 0 || offer) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {freeUnits > 0 ? (
                      <span className="bg-accent-600 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                        <Gift className="size-3" />
                        {t("freeApplied", { count: freeUnits })}
                      </span>
                    ) : (
                      offer && (
                        // Étiquette IDENTIQUE à « Offert » : fond rose foncé
                        // + texte blanc (jamais de rose sur fond rose).
                        <span className="bg-accent-600 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                          <Gift className="size-3" />
                          {t("buyGetLabel", { buy: offer.buy, get: offer.get })}
                        </span>
                      )
                    )}
                    {needForOffer > 0 && (
                      <span className="text-muted text-[10.5px] font-semibold">
                        {t("addForOffer", { count: needForOffer })}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-surface-2 inline-flex shrink-0 items-center rounded-full">
                {(() => {
                  // Pas par unité de la ligne + bornes commerçant (snapshots).
                  const step = qtyStep(item.unit);
                  const minQ = minQtyFor(item.unit, item.min_qty);
                  const maxQ = maxQtyFor(item.unit, item.max_qty);
                  const atMin = item.quantity <= minQ;
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const next = roundQty(item.quantity - step);
                          setItemQuantity(
                            item.line_key,
                            next < minQ ? 0 : next
                          );
                        }}
                        aria-label={atMin ? t("remove") : t("removeOne")}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-full",
                          atMin ? "text-danger-600" : "text-primary-700"
                        )}
                      >
                        {atMin ? (
                          <Trash2 className="size-4" />
                        ) : (
                          <Minus className="size-4" />
                        )}
                      </button>
                      <span className="text-foreground min-w-[1.5ch] text-center text-sm font-extrabold whitespace-nowrap tabular-nums">
                        {isFractionalUnit(item.unit)
                          ? formatQty(item.quantity, item.unit, locale)
                          : item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setItemQuantity(
                            item.line_key,
                            Math.min(maxQ, roundQty(item.quantity + step))
                          )
                        }
                        aria-label={t("addOne")}
                        className="text-primary-700 flex size-9 items-center justify-center rounded-full"
                      >
                        <Plus className="size-4" />
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Voile FLOU sur la page quand le détail des avantages est ouvert —
          focalise l'attention sur le panneau ; un tap dessus le referme. */}
      {hasDetail && detailOpen && (
        <button
          type="button"
          aria-label={t("close")}
          onClick={() => setDetailOpen(false)}
          className="partner-overlay-in fixed inset-0 z-[39] cursor-default bg-black/25 backdrop-blur-[3px]"
        />
      )}

      {/* Barre fixe en bas : un seul card = détail repliable (ouverture vers le
          haut) + cashback + récap sous-total/économies/total + bouton.
          Fond GRIS (token surface-3 → s'adapte seul au mode sombre) pour
          se différencier nettement du blanc de la page. */}
      <div className="border-border bg-surface-3 fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-40 border-t px-4 pt-3 pb-3 shadow-[0_-6px_24px_rgba(40,35,90,0.09)] lg:bottom-0">
        <div className="mx-auto max-w-[560px] space-y-2.5">
          {/* Détail des promotions & économies — contenu INTÉGRÉ directement
              dans la carte du bas (aucune carte autour, pas de titre doublon :
              le bouton « Voir le détail… » sert d'ouverture/fermeture). Lignes
              plates séparées par un filet, un seul résumé par produit.
              Le DÉCLENCHEUR migre EN TÊTE de la carte quand elle est ouverte
              (et revient en bas à la fermeture) : il sert d'en-tête au panneau. */}
          {hasDetail && detailOpen && detailToggle}
          {hasDetail && detailOpen && (
            <div className="divide-border border-border max-h-[40vh] divide-y overflow-y-auto border-b pb-1">
              {productBenefits.map((b) => (
                <div
                  key={b.item.line_key}
                  className="flex items-center gap-2.5 py-2"
                >
                  <div className="bg-surface size-8 shrink-0 overflow-hidden rounded-[8px]">
                    {b.item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={b.item.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-foreground line-clamp-1 text-[12.5px] font-bold">
                      {b.item.name}
                    </p>
                    {/* UN résumé compact : réduction → nouveau prix, et/ou
                        unités offertes. (Noms de promos retirés : redondants.) */}
                    <p className="text-muted flex items-center gap-1.5 text-[10.5px] font-semibold">
                      {b.hasDiscount && (
                        <span>
                          {b.discountPct > 0 ? `−${b.discountPct} % → ` : ""}
                          {formatDA(b.appliedUnit)}
                        </span>
                      )}
                      {b.freeUnits > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Gift className="size-3" />
                          {t("freeApplied", { count: b.freeUnits })}
                        </span>
                      )}
                    </p>
                  </div>

                  <span className="text-success-700 dark:text-success-400 shrink-0 text-[12.5px] font-black tabular-nums">
                    −{formatDA(b.totalSaved)}
                  </span>
                </div>
              ))}

              {/* Codes à saisir au paiement — même liste plate, chips légères. */}
              {codePromos.length > 0 && (
                <div className="py-2">
                  {/* TOUT sur UNE seule ligne : hint + chips de codes côte à
                      côte ; s'il y a trop long, la ligne DÉFILE (jamais de
                      retour à la ligne). */}
                  <div className="flex min-w-0 [scrollbar-width:none] items-center gap-2 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden">
                    <span className="text-primary-700 flex shrink-0 items-center gap-1.5 text-[11px] font-bold">
                      <Ticket className="text-accent-600 size-3.5 shrink-0" />
                      {t("promoCodeHint")}
                    </span>
                    {codePromos.map((p) => {
                      const val =
                        p.discount_kind === "percent"
                          ? `−${p.discount_value} %`
                          : `−${formatDA(p.discount_value ?? 0)}`;
                      return (
                        <CodeChip
                          key={p.id}
                          code={p.code ?? ""}
                          value={val}
                          minLabel={
                            p.min_subtotal_da != null
                              ? t("promoCodeFrom", {
                                  amount: formatDA(p.min_subtotal_da),
                                })
                              : null
                          }
                          copiedLabel={t("promoCodeCopied")}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Toggle « Voir le détail… » en BAS uniquement quand c'est fermé
              (ouvert → il est en tête du panneau, cf. plus haut). */}
          {hasDetail && !detailOpen && detailToggle}

          {cashbackGain > 0 && (
            <div className="bg-success-50 text-success-700 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px] font-bold">
              <Gift className="size-4 shrink-0" />
              {t("cashbackGain", { amount: formatDA(cashbackGain) })}
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="min-w-0">
              <span className="text-muted block text-[13px] font-semibold">
                {t("subtotalUnits", { count: units })}
              </span>
              {savings > 0 && (
                <span className="text-accent-600 text-[11.5px] font-bold">
                  {t("savings", { amount: formatDA(savings) })}
                </span>
              )}
            </span>
            <span className="flex flex-col items-end leading-none">
              {savings > 0 && (
                <span className="text-subtle mb-0.5 text-[12px] font-semibold tabular-nums line-through">
                  {formatDA(settled.normalTotalDa)}
                </span>
              )}
              <span className="text-foreground text-[21px] font-black tracking-[-0.6px] tabular-nums">
                {formatDA(subtotal)}
              </span>
            </span>
          </div>
          <Link
            href="/checkout"
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] text-base font-extrabold text-white shadow-[0_8px_22px_-6px_rgba(91,91,230,0.55)]"
          >
            {t("checkout")}
            <ArrowRight className="size-5 rtl:-scale-x-100" />
          </Link>
          {sharedCartEnabled && (
            <>
              <button
                type="button"
                onClick={() => void inviteFamily()}
                disabled={inviteBusy}
                className="border-primary-200 text-primary-700 hover:bg-primary-50 inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-[10px] border-2 text-[15px] font-extrabold transition-colors disabled:opacity-60"
              >
                {inviteBusy ? (
                  <Loader2 className="size-4.5 animate-spin" />
                ) : (
                  <Users className="size-4.5" />
                )}
                {tsc("inviteCta")}
              </button>
              {inviteError && (
                <p className="text-center text-xs font-medium text-rose-600">
                  {inviteError}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Chip de code promo AUTO-COPIANTE (composant autonome) : un tap copie le
 * code et la chip se ré-affiche en état « Copié » (vert, ✓) pendant 1,6 s —
 * aucun texte ajouté ailleurs. Le code long est tronqué proprement (la chip
 * garde une seule ligne, la valeur et le seuil restent visibles).
 */
function CodeChip({
  code,
  value,
  minLabel,
  copiedLabel,
}: {
  code: string;
  value: string;
  minLabel: string | null;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* Clipboard indisponible (vieux WebView) : rien à casser. */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${code} — ${copiedLabel}`}
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold transition-colors active:scale-[0.96]",
        copied
          ? "bg-success-100 text-success-700"
          : "bg-surface text-foreground"
      )}
    >
      {copied ? (
        <Check className="text-success-600 size-3 shrink-0" />
      ) : (
        <Copy className="text-muted size-3 shrink-0" />
      )}
      <span className="max-w-[9rem] truncate font-mono font-black tracking-wider">
        {copied ? copiedLabel : code}
      </span>
      {!copied && (
        <span className="text-success-700 dark:text-success-400 shrink-0 font-black">
          {value}
        </span>
      )}
      {!copied && minLabel && (
        <span className="text-muted shrink-0">· {minLabel}</span>
      )}
    </button>
  );
}
