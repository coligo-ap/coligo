"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Ban,
  CreditCard,
  Gift,
  Plus,
  QrCode,
  Sparkles,
  Store,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { useConfirm } from "@/components/ui/confirm";
import { formatDA } from "@/lib/utils";
import { QrZoom } from "@/components/shared/qr-zoom";
import { LinkCardFlow } from "@/components/customer/loyalty/link-card-flow";
import {
  blockLoyaltyCard,
  fetchLoyaltyHistory,
  fetchLoyaltyOverview,
  type LoyaltyAccountCard,
} from "@/app/(customer)/cashback/actions";

function dayFr(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Section « Fidélité en magasin » de /cashback (SPEC-FIDELITE 3.2).
 * Le CLOISONNEMENT est rendu ÉVIDENT par la forme : une CARTE-MAGASIN
 * distincte par commerçant (logo + nom + cagnotte propre) — zéro jargon.
 * QR personnel présentable en caisse (le compte SERT de carte), liaison de
 * carte à tout moment, historique par magasin, blocage d'une carte perdue.
 */
export function LoyaltySection({ userId }: { userId: string }) {
  const t = useTranslations("wallet");
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const params = useSearchParams();

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkPrefill, setLinkPrefill] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<LoyaltyAccountCard | null>(null);
  const [blockPending, setBlockPending] = useState<string | null>(null);
  const [newVoucherIds, setNewVoucherIds] = useState<string[]>([]);

  const { data: overview, isPending } = useQuery({
    queryKey: ["loyalty-overview", userId],
    queryFn: fetchLoyaltyOverview,
    staleTime: 30_000,
  });

  const { data: history, isPending: historyPending } = useQuery({
    queryKey: ["loyalty-history", userId, historyFor?.merchant_id ?? null],
    queryFn: () => fetchLoyaltyHistory(historyFor?.merchant_id ?? null),
    enabled: !!historyFor,
    staleTime: 30_000,
  });

  // Landing /c/<code> → « Lier cette carte à mon compte » : /cashback?lier=CODE
  // ouvre la feuille pré-remplie puis nettoie l'URL (zéro round-trip).
  useEffect(() => {
    const code = params.get("lier");
    if (!code) return;
    setLinkPrefill(code);
    setLinkOpen(true);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("lier");
      window.history.replaceState(null, "", u);
    } catch {
      /* sans gravité */
    }
    // volontairement une seule fois au montage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Micro-célébration aux paliers débloqués : bons jamais vus (clé PAR compte).
  useEffect(() => {
    if (!overview) return;
    const key = `coligo_loy_seen:${userId}`;
    const ids = overview.accounts.flatMap((a) =>
      a.summary.vouchers.map((v) => v.id)
    );
    try {
      const seenRaw = window.localStorage.getItem(key);
      const seen: string[] = seenRaw ? JSON.parse(seenRaw) : [];
      if (seenRaw !== null) {
        setNewVoucherIds(ids.filter((id) => !seen.includes(id)));
      }
      window.localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      /* stockage indisponible : pas de célébration, rien de cassé */
    }
  }, [overview, userId]);

  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: ["loyalty-overview", userId],
    });

  const accounts = overview?.accounts ?? [];
  const cards = overview?.cards ?? [];
  const activeCards = useMemo(
    () => cards.filter((c) => c.status !== "blocked"),
    [cards]
  );

  async function blockCard(cardId: string) {
    if (
      !(await confirm({
        title: t("loyCardBlockConfirm"),
      }))
    ) {
      return;
    }
    setBlockPending(cardId);
    try {
      await blockLoyaltyCard(cardId);
      invalidate();
    } finally {
      setBlockPending(null);
    }
  }

  return (
    <section className="mt-6">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-foreground text-heading-sm font-black tracking-tight">
          {t("loySectionTitle")}
        </h2>
        <button
          type="button"
          onClick={() => {
            setLinkPrefill(null);
            setLinkOpen(true);
          }}
          className="bg-primary-600 hover:bg-primary-700 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white transition active:scale-[0.97]"
        >
          <Plus className="size-3.5" />
          {t("loyLinkCard")}
        </button>
      </div>
      <p className="text-muted mb-3 text-xs font-medium">
        {t("loySectionDesc")}
      </p>

      {newVoucherIds.length > 0 && (
        <div className="border-success-200 bg-success-50 mb-3 flex items-center gap-2.5 rounded-md border p-3">
          <Sparkles className="text-success-600 size-5 shrink-0" />
          <p className="text-success-800 text-sm font-bold">
            {t("loyNewVoucher", { count: newVoucherIds.length })}
          </p>
        </div>
      )}

      {/* QR personnel : le compte SERT de carte chez tous les commerçants. */}
      {overview?.handle && (
        <div className="rounded-sheet-lg mb-3 flex items-center gap-3 bg-white p-4">
          <QrZoom
            value={`coligo:user:${overview.handle}`}
            size={64}
            caption={t("loyMyQrDesc")}
            fullValue={t("loyMyQrTitle")}
            expandLabel={t("loyMyQrTitle")}
          />
          <div className="min-w-0 flex-1">
            <p className="text-foreground flex items-center gap-1.5 text-sm font-extrabold">
              <QrCode className="text-primary-600 size-4" />
              {t("loyMyQrTitle")}
            </p>
            <p className="text-muted mt-0.5 text-xs font-medium">
              {t("loyMyQrDesc")}
            </p>
          </div>
        </div>
      )}

      {/* CARTES-MAGASINS : une cagnotte PAR commerçant, visuellement séparées. */}
      {isPending && !overview ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-3 h-28 animate-pulse rounded-lg"
            />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-sheet-lg bg-white p-5 text-center">
          <Store className="text-primary-300 mx-auto size-10" />
          <p className="text-foreground mt-2 text-base font-extrabold">
            {t("loyEmptyTitle")}
          </p>
          <p className="text-muted mx-auto mt-1 max-w-xs text-sm font-medium">
            {t("loyEmptyDesc")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <StoreCard
              key={a.merchant_id}
              account={a}
              onHistory={() => setHistoryFor(a)}
            />
          ))}
        </div>
      )}

      {/* Cartes physiques liées (+ blocage en cas de perte). */}
      {activeCards.length > 0 && (
        <div className="mt-4">
          <h3 className="text-foreground mb-2 text-sm font-extrabold">
            {t("loyCards")}
          </h3>
          <div className="space-y-2">
            {activeCards.map((c) => (
              <div
                key={c.id}
                className="rounded-sheet-lg flex items-center gap-3 bg-white p-3"
              >
                <div className="bg-primary-50 text-primary-600 rounded-card flex size-10 shrink-0 items-center justify-center">
                  <CreditCard className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground font-mono text-sm font-bold">
                    {c.code_masked}
                  </p>
                  {c.merchant_name && (
                    <p className="text-muted text-xs font-medium">
                      {c.merchant_name}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={blockPending === c.id}
                  onClick={() => void blockCard(c.id)}
                  className="text-danger-600 hover:bg-danger-50 flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-50"
                >
                  <Ban className="size-3.5" />
                  {t("loyCardBlock")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feuille : lier une carte (même parcours que l'onboarding). */}
      <Sheet
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={t("loyLinkTitle")}
      >
        <LinkCardFlow
          key={`${linkOpen}-${linkPrefill ?? ""}`}
          variant="sheet"
          prefillCode={linkPrefill}
          onLinked={invalidate}
          onFinish={() => setLinkOpen(false)}
        />
      </Sheet>

      {/* Feuille : historique du magasin sélectionné. */}
      <Sheet
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        title={historyFor?.merchant_name ?? ""}
        description={t("loyHistory")}
      >
        {historyPending && !history ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-3 h-12 animate-pulse rounded-md"
              />
            ))}
          </div>
        ) : (history ?? []).length === 0 ? (
          <p className="text-muted py-4 text-center text-sm">
            {t("loyHistoryEmpty")}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {(history ?? []).map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-semibold">
                    {t(historyLabelKey(e.type))}
                  </p>
                  <p className="text-subtle text-xs">{dayFr(e.created_at)}</p>
                </div>
                <span
                  className={
                    "text-sm font-extrabold tabular-nums " +
                    (e.amount_da >= 0 ? "text-success-700" : "text-foreground")
                  }
                >
                  {e.amount_da >= 0 ? "+" : "−"}
                  {formatDA(Math.abs(e.amount_da))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </section>
  );
}

function historyLabelKey(type: string): string {
  switch (type) {
    case "credit":
      return "loyEntryCredit";
    case "link_bonus":
      return "loyEntryLinkBonus";
    case "voucher_grant":
      return "loyEntryVoucherGrant";
    case "voucher_redeem":
      return "loyEntryVoucherRedeem";
    case "voucher_expire":
      return "loyEntryVoucherExpire";
    case "redeem":
      return "loyEntryRedeem";
    case "transfer_in":
      return "loyEntryTransferIn";
    case "transfer_out":
      return "loyEntryTransferOut";
    default:
      return "loyEntryAdjustment";
  }
}

/** Carte-magasin : cagnotte, bons, progression animée vers le prochain bon. */
function StoreCard({
  account,
  onHistory,
}: {
  account: LoyaltyAccountCard;
  onHistory: () => void;
}) {
  const t = useTranslations("wallet");
  const { summary } = account;
  const progress = summary.progress;
  const pct =
    progress && progress.threshold_da > 0
      ? Math.min(100, (progress.spent_da / progress.threshold_da) * 100)
      : 0;
  // Barre ANIMÉE : largeur 0 au montage puis transition vers la vraie valeur.
  const [animPct, setAnimPct] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimPct(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  return (
    <button
      type="button"
      onClick={onHistory}
      className="rounded-sheet-lg block w-full bg-white p-4 text-start transition-transform active:scale-[.99]"
    >
      <div className="flex items-center gap-3">
        {account.merchant_logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.merchant_logo}
            alt=""
            loading="lazy"
            className="bg-surface-2 size-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="bg-primary-50 text-primary-600 flex size-11 shrink-0 items-center justify-center rounded-full">
            <Store className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-base font-extrabold">
            {account.merchant_name}
          </p>
          <p className="text-muted text-xs font-medium">{t("loyAvailable")}</p>
        </div>
        <p className="text-primary-700 text-2xl font-black tabular-nums">
          {formatDA(summary.available_da)}
        </p>
      </div>

      {summary.vouchers.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {summary.vouchers.map((v) => (
            <span
              key={v.id}
              className="border-success-200 bg-success-50 text-success-800 flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold"
            >
              <Gift className="size-3.5" />
              {t("loyVoucher", { amount: formatDA(v.amount_da) })}
              <span className="text-success-600 font-medium">
                · {t("loyVoucherExp", { date: dayFr(v.expires_at) })}
              </span>
            </span>
          ))}
        </div>
      )}

      {progress && progress.remaining_da > 0 && (
        <div className="mt-3">
          <div className="bg-surface-3 h-2.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary-600 h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${animPct}%` }}
            />
          </div>
          <p className="text-muted mt-1.5 text-xs font-semibold">
            {t("loyProgressRemaining", {
              amount: formatDA(progress.remaining_da),
              merchant: account.merchant_name,
              reward: formatDA(progress.reward_da),
            })}
          </p>
        </div>
      )}
    </button>
  );
}
