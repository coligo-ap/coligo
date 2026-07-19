"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  MessageCircle,
  ReceiptText,
} from "lucide-react";
import {
  getMyWalletEntry,
  type MyWalletEntryDetail,
} from "@/app/wallet/recharge-actions";
import {
  BRAND_GO,
  BRAND_RED,
  PartnerBackHeader,
  PartnerBadge,
  PartnerEmptyState,
  SORA,
} from "@/components/shared/partner-ui";
import {
  isSupportConfigured,
  openSupportChat,
} from "@/components/support/tawk-chat";
import { OWNER_BADGE } from "@/components/wallet/operator-recharge-strings";
import {
  PayCard,
  PayScreen,
  PaySkeleton,
  entryLabel,
  fmtDayTime,
  groupNum,
  kindOf,
  KIND_LABEL,
  ownerOf,
  payHref,
  usePayLang,
  usePayWallet,
  type PayBase,
} from "./pay-core";

/**
 * DÉTAIL DE L'OPÉRATION — un reçu financier : montant, type, date exacte,
 * références traçables. Affichage instantané depuis le cache (ligne déjà
 * vue dans l'historique), complété par la RPC de détail (référence liée).
 */
export function PayEntryDetail({ base, id }: { base: PayBase; id: string }) {
  const { lang, t, dir } = usePayLang();
  const { state, entries } = usePayWallet();

  // Amorce instantanée depuis le cache ; le détail serveur complète (ref_id).
  const cached = entries.find((e) => e.id === id) ?? null;
  const [detail, setDetail] = useState<MyWalletEntryDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    void getMyWalletEntry(id).then((d) => {
      if (!alive) return;
      if (d) setDetail(d);
      else setNotFound(true);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const entry = detail ?? cached;

  if (!entry) {
    return (
      <PayScreen dir={dir}>
        <PartnerBackHeader
          title={t.opDetail}
          href={payHref(base, "/historique")}
        />
        {notFound ? (
          <PartnerEmptyState
            icon={<ReceiptText className="size-5" />}
            text={t.opNotFound}
          />
        ) : (
          <PaySkeleton hero={false} />
        )}
      </PayScreen>
    );
  }

  const credit = entry.amountDa >= 0;
  const Icon = credit ? ArrowDownLeft : ArrowUpRight;
  const kind = kindOf(entry);
  // La note n'est une info NOUVELLE que hors `finance_mirror` (où elle sert
  // déjà de type — l'afficher en plus dupliquerait le libellé).
  const note =
    entry.type !== "finance_mirror" && entry.note?.trim() ? entry.note : null;

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t.opType, value: entryLabel(entry, lang) },
    { label: t.opDate, value: fmtDayTime(entry.createdAt, lang) },
    ...(note ? [{ label: t.opNote, value: note }] : []),
    {
      label: t.opImpact,
      value: (
        <span style={{ color: credit ? BRAND_GO : BRAND_RED }}>
          {credit ? t.credit : t.debit}
        </span>
      ),
    },
    { label: t.opRef, value: shortRef(entry.id) },
    ...(detail?.refId
      ? [{ label: t.opLinkedRef, value: shortRef(detail.refId) }]
      : []),
  ];

  return (
    <PayScreen dir={dir}>
      <PartnerBackHeader
        title={t.opDetail}
        href={payHref(base, "/historique")}
      />

      <PayCard className="px-4 pt-7 pb-4 text-center">
        <span
          className="mx-auto grid size-14 place-items-center rounded-full"
          style={{
            background: credit ? "rgba(22,179,100,.12)" : "rgba(229,72,77,.10)",
            color: credit ? BRAND_GO : BRAND_RED,
          }}
        >
          <Icon className="size-6 rtl:-scale-x-100" />
        </span>
        <p className="mt-3 text-[13px] font-bold text-[var(--d-muted)]">
          {entryLabel(entry, lang)}
        </p>
        <p
          className="mt-1 text-[30px] leading-none font-extrabold tracking-[-1px]"
          style={{
            color: credit ? BRAND_GO : BRAND_RED,
            fontFamily: SORA,
          }}
        >
          {credit ? "+" : "−"}
          {groupNum(entry.amountDa)} DA
        </p>
        <div className="mt-2.5">
          <PartnerBadge tone={credit ? "ok" : "ko"}>
            {KIND_LABEL[kind][lang === "ar" ? 1 : 0]}
          </PartnerBadge>
        </div>

        {/* Reçu — lignes de traçabilité */}
        <div className="mt-5 border-t border-dashed border-[var(--d-line)]">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-3 border-b border-[var(--d-line)] py-2.5 last:border-b-0"
            >
              <span className="text-[12px] font-semibold text-[var(--d-muted)]">
                {r.label}
              </span>
              <span className="min-w-0 truncate text-[12.5px] font-bold text-[var(--d-ink)]">
                {r.value}
              </span>
            </div>
          ))}
        </div>
      </PayCard>

      {isSupportConfigured() && (
        <button
          type="button"
          onClick={() =>
            openSupportChat({
              attributes: {
                sujet: `Coligo Pay — opération ${shortRef(entry.id)}`,
                espace: OWNER_BADGE.fr[ownerOf(state)],
              },
            })
          }
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] border border-[var(--d-line)] py-3 text-[12.5px] font-bold"
          style={{ color: "var(--d-violet)" }}
        >
          <MessageCircle className="size-4" />
          {t.opSupport}
        </button>
      )}
    </PayScreen>
  );
}

/** Référence courte lisible (8 premiers caractères, majuscules). */
function shortRef(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}
