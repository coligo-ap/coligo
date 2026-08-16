"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Ban,
  ChevronRight,
  CreditCard,
  Gift,
  Percent,
  Plus,
  Search,
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
  type LoyaltyHistoryEntry,
} from "@/app/(customer)/cashback/actions";

type StoreSort = "balance" | "progress" | "name";

function dayFr(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1)
    .toString()
    .padStart(2, "0")}`;
}

/** Dégradé « carte fidélité Coligo » (référence imprimée : violet profond →
 *  violet marque → rose accent) — uniquement des tokens, jamais d'hex ici. */
const LOYALTY_GRADIENT =
  "linear-gradient(130deg, var(--color-primary-900) 0%, var(--color-primary-700) 38%, var(--color-primary-600) 64%, var(--color-accent-500) 128%)";

/** Facettes diagonales translucides (langage visuel de la carte imprimée). */
function CardFacets() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute start-[46%] -top-10 bottom-0 w-24 -skew-x-12 bg-white/[.05]" />
      <div className="absolute start-[68%] -top-10 bottom-0 w-40 -skew-x-12 bg-white/[.04]" />
      <div
        className="absolute -end-16 -bottom-24 size-64 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, var(--color-accent-500) 0%, transparent 70%)",
          opacity: 0.35,
        }}
      />
    </div>
  );
}

/**
 * Onglet « Fidélité en magasin » de /cashback (SPEC-FIDELITE 3.2).
 * Le CLOISONNEMENT est rendu ÉVIDENT par la forme : une CARTE-MAGASIN
 * distincte par commerçant, au design de la carte physique Coligo (dégradé
 * violet → rose, facettes) — la cagnotte de chaque magasin se dépense CHEZ CE
 * magasin uniquement, zéro jargon. QR personnel présentable en caisse (le
 * compte SERT de carte), liaison de carte à tout moment, historique par
 * magasin, blocage d'une carte perdue.
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
  // Recherche + tri PUREMENT client sur les données déjà en cache → instantané.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<StoreSort>("balance");

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

  const visibleAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? accounts.filter((a) => a.merchant_name.toLowerCase().includes(q))
      : accounts;
    const pctOf = (a: LoyaltyAccountCard) =>
      a.summary.progress && a.summary.progress.threshold_da > 0
        ? a.summary.progress.spent_da / a.summary.progress.threshold_da
        : -1;
    return [...filtered].sort((x, y) =>
      sort === "name"
        ? x.merchant_name.localeCompare(y.merchant_name)
        : sort === "progress"
          ? pctOf(y) - pctOf(x)
          : y.summary.available_da - x.summary.available_da
    );
  }, [accounts, query, sort]);

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
    <section>
      {/* HERO « ma carte » — même langage que la carte physique Coligo :
          dégradé violet → rose, facettes, QR sur panneau blanc. */}
      <section
        className="rounded-panel-lg relative overflow-hidden px-5 pt-5 pb-5 text-white"
        style={{ backgroundImage: LOYALTY_GRADIENT }}
      >
        <CardFacets />
        <div className="relative z-10">
          <span className="text-caption rounded-full bg-white/15 px-2.5 py-1 font-extrabold tracking-wider uppercase">
            {t("loySectionTitle")}
          </span>

          <div className="mt-4 flex items-center gap-3.5">
            {/* Le QR vit sur un SOCLE BLANC (stage) — lisible en caisse et en
                sombre, comme sur la carte imprimée. */}
            {overview?.handle ? (
              <div className="bg-on-brand isolate shrink-0 rounded-md p-1.5">
                <QrZoom
                  value={`coligo:user:${overview.handle}`}
                  size={78}
                  caption={t("loyMyQrDesc")}
                  fullValue={t("loyMyQrTitle")}
                  expandLabel={t("loyMyQrTitle")}
                />
              </div>
            ) : (
              <div className="size-[90px] shrink-0 animate-pulse rounded-md bg-white/25" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-base leading-tight font-black tracking-tight">
                {t("loyMyQrTitle")}
              </p>
              <p className="mt-1 text-xs leading-relaxed font-semibold opacity-85">
                {t("loyMyQrDesc")}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setLinkPrefill(null);
              setLinkOpen(true);
            }}
            className="bg-on-brand text-primary-700 rounded-control mt-4 flex h-11 w-full items-center justify-center gap-1.5 text-sm font-extrabold transition active:scale-[.98]"
          >
            <Plus className="size-4" />
            {t("loyLinkCard")}
          </button>
        </div>
      </section>

      {newVoucherIds.length > 0 && (
        <div className="border-success-200 bg-success-50 mt-3 flex items-center gap-2.5 rounded-md border p-3">
          <Sparkles className="text-success-600 size-5 shrink-0" />
          <p className="text-success-800 text-sm font-bold">
            {t("loyNewVoucher", { count: newVoucherIds.length })}
          </p>
        </div>
      )}

      {/* CARTES-MAGASINS : une cagnotte PAR commerçant, dépensable chez LUI. */}
      <div className="mt-6 mb-2.5">
        <h2 className="text-foreground text-heading-sm font-black tracking-tight">
          {t("loyStores")}
        </h2>
        <p className="text-muted mt-1 text-xs font-medium">
          {t("loySectionDesc")}
        </p>
      </div>

      {/* Recherche + tri INSTANTANÉS (données en cache, zéro round-trip). */}
      {accounts.length > 1 && (
        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search className="text-subtle absolute start-3 top-1/2 size-4 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("loySearchPlaceholder")}
              className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 rounded-control h-11 w-full border bg-white ps-10 pe-3 text-sm font-medium focus:ring-2 focus:outline-none"
            />
          </div>
          <div className="flex gap-1.5">
            {(["balance", "progress", "name"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={sort === k}
                onClick={() => setSort(k)}
                className={
                  "rounded-full px-2.5 py-1 text-xs font-bold transition " +
                  (sort === k
                    ? "bg-primary-600 text-white"
                    : "bg-surface-2 text-muted hover:text-foreground")
                }
              >
                {t(
                  k === "balance"
                    ? "loySortBalance"
                    : k === "progress"
                      ? "loySortProgress"
                      : "loySortName"
                )}
              </button>
            ))}
          </div>
        </div>
      )}

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
      ) : visibleAccounts.length === 0 ? (
        <p className="text-muted py-6 text-center text-sm font-medium">
          {t("loyNoResults")}
        </p>
      ) : (
        <div className="space-y-3">
          {visibleAccounts.map((a) => (
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
                  <p className="text-foreground font-mono text-sm font-bold tracking-widest">
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

      {/* Feuille : FICHE du magasin sélectionné — solde, programme, progression
          colorée, bons, historique. */}
      <Sheet
        open={!!historyFor}
        onClose={() => setHistoryFor(null)}
        title={historyFor?.merchant_name ?? ""}
      >
        {historyFor && (
          <StoreDetail
            account={historyFor}
            history={history}
            pending={historyPending}
          />
        )}
      </Sheet>
    </section>
  );
}

/**
 * FICHE MAGASIN (feuille) : tout ce que le client veut savoir sur SA fidélité
 * chez ce commerçant — solde dépensable ici, conditions du programme (taux,
 * palier), progression COLORÉE vers le prochain bon, bons actifs, historique.
 */
function StoreDetail({
  account,
  history,
  pending,
}: {
  account: LoyaltyAccountCard;
  history: LoyaltyHistoryEntry[] | undefined;
  pending: boolean;
}) {
  const t = useTranslations("wallet");
  const { summary, program } = account;
  const progress = summary.progress;
  const pct =
    progress && progress.threshold_da > 0
      ? Math.min(100, (progress.spent_da / progress.threshold_da) * 100)
      : 0;
  const [animPct, setAnimPct] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimPct(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  return (
    <div className="space-y-4">
      {/* Solde dépensable CHEZ CE magasin uniquement. */}
      <div className="bg-surface-2 flex items-center justify-between gap-3 rounded-md p-3.5">
        <div>
          <p className="text-muted text-xs font-semibold">
            {t("loySpendableHere")}
          </p>
          <p className="text-primary-700 mt-0.5 text-2xl font-black tabular-nums">
            {formatDA(summary.available_da)}
          </p>
        </div>
        {account.merchant_logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.merchant_logo}
            alt=""
            loading="lazy"
            className="bg-surface size-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="bg-primary-50 text-primary-600 flex size-11 shrink-0 items-center justify-center rounded-full">
            <Store className="size-5" />
          </div>
        )}
      </div>

      {/* Conditions du programme de CE commerçant (si actif chez lui). */}
      {program?.enabled && (
        <div className="flex flex-wrap gap-1.5">
          <span className="bg-primary-50 text-primary-700 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold">
            <Percent className="size-3.5" />
            {t("loyProgramRate", {
              rate: String(Number(program.earn_rate_pct)),
            })}
          </span>
          {program.tier_threshold_da != null &&
            program.tier_reward_da != null && (
              <span className="bg-primary-50 text-primary-700 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold">
                <Gift className="size-3.5" />
                {t("loyProgramTier", {
                  reward: formatDA(program.tier_reward_da),
                  threshold: formatDA(program.tier_threshold_da),
                })}
              </span>
            )}
        </div>
      )}

      {/* Progression vers le prochain bon — barre COLORÉE + pourcentage. */}
      {progress && progress.remaining_da > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-foreground text-xs font-bold">
              {t("loySortProgress")}
            </p>
            <p className="text-primary-700 text-xs font-extrabold tabular-nums">
              {Math.round(pct)} %
            </p>
          </div>
          <div className="bg-surface-3 h-2.5 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${animPct}%`,
                backgroundImage:
                  "linear-gradient(90deg, var(--color-primary-600), var(--color-accent-500))",
              }}
            />
          </div>
          <p className="text-muted mt-1.5 text-xs font-semibold">
            {t("loyProgressShort", {
              amount: formatDA(progress.remaining_da),
              reward: formatDA(progress.reward_da),
            })}
          </p>
        </div>
      )}

      {/* Bons actifs chez ce commerçant. */}
      {summary.vouchers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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

      {/* Historique chez ce commerçant. */}
      <div>
        <h4 className="text-foreground mb-1.5 text-sm font-extrabold">
          {t("loyHistory")}
        </h4>
        {pending && !history ? (
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
      </div>
    </div>
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

/**
 * Carte-magasin au design de la CARTE PHYSIQUE Coligo (dégradé violet → rose,
 * facettes) : « Chez {magasin} », cagnotte dépensable ICI uniquement, bons, et
 * barre de progression vers le prochain palier du commerçant.
 */
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
      className="rounded-panel-lg relative block w-full overflow-hidden p-4 text-start text-white transition-transform active:scale-[.99]"
      style={{ backgroundImage: LOYALTY_GRADIENT }}
    >
      <CardFacets />
      <div className="relative z-10">
        <div className="flex items-center gap-3">
          {account.merchant_logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={account.merchant_logo}
              alt=""
              loading="lazy"
              className="bg-on-brand size-11 shrink-0 rounded-full border-2 border-white/60 object-cover"
            />
          ) : (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-white/60 bg-white/15">
              <Store className="size-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-caption leading-none font-extrabold tracking-wider uppercase opacity-70">
              {t("loyChez")}
            </p>
            <p className="mt-0.5 truncate text-lg leading-tight font-black tracking-tight">
              {account.merchant_name}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 opacity-60 rtl:-scale-x-100" />
        </div>

        <div className="mt-3.5 flex items-end justify-between gap-3">
          <p className="text-xs font-semibold opacity-80">
            {t("loySpendableHere")}
          </p>
          <p className="text-2xl leading-none font-black tabular-nums">
            {formatDA(summary.available_da)}
          </p>
        </div>

        {summary.vouchers.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {summary.vouchers.map((v) => (
              <span
                key={v.id}
                className="bg-on-brand text-primary-700 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold"
              >
                <Gift className="size-3.5" />
                {t("loyVoucher", { amount: formatDA(v.amount_da) })}
                <span className="text-primary-400 font-semibold">
                  · {t("loyVoucherExp", { date: dayFr(v.expires_at) })}
                </span>
              </span>
            ))}
          </div>
        )}

        {progress && progress.remaining_da > 0 && (
          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="bg-on-brand h-full rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${animPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs font-semibold opacity-85">
              {t("loyProgressShort", {
                amount: formatDA(progress.remaining_da),
                reward: formatDA(progress.reward_da),
              })}
            </p>
          </div>
        )}
      </div>
    </button>
  );
}
