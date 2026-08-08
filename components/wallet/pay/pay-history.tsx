"use client";

import { useMemo, useState } from "react";
import { Loader2, ReceiptText } from "lucide-react";
import {
  PartnerBackHeader,
  PartnerEmptyState,
} from "@/components/shared/partner-ui";
import {
  PayCard,
  PayEntryRow,
  PayScreen,
  PaySkeleton,
  kindOf,
  KIND_LABEL,
  payHref,
  usePayLang,
  usePayWallet,
  type OpsKind,
  type PayBase,
} from "./pay-core";

/**
 * HISTORIQUE — page dédiée : filtres par type (chips) + période (mois /
 * dates libres), liste complète en chargement progressif (borné 200 serveur).
 * Chaque ligne ouvre la page de DÉTAIL (reçu) — plus de ligne dépliable.
 */
export function PayHistory({ base }: { base: PayBase }) {
  const { lang, t, dir } = usePayLang();
  const { entries, loading, refresh } = usePayWallet({ entriesLimit: 40 });

  const [kind, setKind] = useState<"all" | OpsKind>("all");
  const [month, setMonth] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(40);
  const [more, setMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);

  // Chips = « Tout » + seulement les types PRÉSENTS dans l'historique chargé.
  const kindsPresent = useMemo(() => {
    const s = new Set<OpsKind>();
    for (const e of entries) s.add(kindOf(e));
    return (
      ["recharge", "vente", "commission", "cashback", "autre"] as const
    ).filter((k) => s.has(k));
  }, [entries]);

  const monthsAvailable = useMemo(
    () => [...new Set(entries.map((e) => String(e.createdAt).slice(0, 7)))],
    [entries]
  );

  const filtered = entries.filter((e) => {
    if (kind !== "all" && kindOf(e) !== kind) return false;
    const day = String(e.createdAt).slice(0, 10);
    if (month === "custom") {
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    }
    if (month !== "all") return day.startsWith(month);
    return true;
  });

  const loadMore = async () => {
    if (more) return;
    setMore(true);
    try {
      const next = Math.min(200, limit + 40);
      const data = await refresh(next);
      const count = data?.entries.length ?? 0;
      setAllLoaded(count < next || next >= 200);
      setLimit(next);
    } finally {
      setMore(false);
    }
  };

  const inputCls =
    "w-full rounded-md border border-[var(--d-line)] bg-[var(--d-surface)] px-3 py-2.5 text-label-lg font-semibold text-[var(--d-ink)] outline-none";

  return (
    <PayScreen dir={dir}>
      <PartnerBackHeader
        title={t.history}
        subtitle={t.historySub}
        href={payHref(base)}
      />

      {/* Filtre TYPE (chips serrées) */}
      <div className="flex flex-wrap gap-1.5">
        <Chip on={kind === "all"} onClick={() => setKind("all")}>
          {t.allKinds}
        </Chip>
        {kindsPresent.map((k) => (
          <Chip key={k} on={kind === k} onClick={() => setKind(k)}>
            {KIND_LABEL[k][lang === "ar" ? 1 : 0]}
          </Chip>
        ))}
      </div>

      {/* Filtre PÉRIODE */}
      <div className="mt-2.5">
        <select
          className={inputCls}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          <option value="all">{t.allPeriods}</option>
          {monthsAvailable.map((m) => (
            <option key={m} value={m}>
              {new Date(`${m}-01T00:00:00Z`).toLocaleDateString(
                lang === "ar" ? "ar-DZ" : "fr-FR",
                { month: "long", year: "numeric", timeZone: "UTC" }
              )}
            </option>
          ))}
          <option value="custom">{t.customDates}</option>
        </select>
        {month === "custom" && (
          <div className="mt-2 flex gap-2">
            <input
              type="date"
              className={inputCls}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label={t.from}
            />
            <input
              type="date"
              className={inputCls}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label={t.to}
            />
          </div>
        )}
      </div>

      {/* Liste */}
      <div className="mt-3">
        {loading && entries.length === 0 ? (
          <PaySkeleton hero={false} />
        ) : filtered.length === 0 ? (
          <PartnerEmptyState
            icon={<ReceiptText className="size-5" />}
            title={t.noOps}
            text={entries.length === 0 ? t.noOpsSub : t.emptyFilter}
          />
        ) : (
          <PayCard>
            {filtered.map((e) => (
              <PayEntryRow
                key={e.id}
                entry={e}
                lang={lang}
                href={payHref(base, `/historique/${e.id}`)}
              />
            ))}
          </PayCard>
        )}
      </div>

      {/* Chargement progressif (jusqu'à 200, borné serveur) */}
      {!allLoaded && entries.length >= limit && (
        <button
          type="button"
          disabled={more}
          onClick={() => void loadMore()}
          className="rounded-card-lg text-body-sm mt-3 flex w-full items-center justify-center gap-2 border border-[var(--d-line)] py-3 font-bold text-[var(--d-ink)] disabled:opacity-60"
        >
          {more && <Loader2 className="size-4 animate-spin" />}
          {t.loadMore}
        </button>
      )}
    </PayScreen>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-caption-lg rounded-full border px-2.5 py-1 font-bold"
      style={
        on
          ? {
              background: "var(--d-violet)",
              borderColor: "var(--d-violet)",
              color: "#fff",
            }
          : {
              background: "var(--d-surface)",
              borderColor: "var(--d-line)",
              color: "var(--d-muted)",
            }
      }
    >
      {children}
    </button>
  );
}
