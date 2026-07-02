"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { CreditCard } from "lucide-react";
import {
  BRAND_GO,
  BRAND_VIOLET,
  PartnerBackHeader,
  PartnerHeroCard,
  SORA,
} from "@/components/shared/partner-ui";

/**
 * Écran « Relevé · règlement » — MÊME langage que les écrans chauffeur
 * (header retour partagé, carte héro dégradé violet, lignes de détail façon
 * d-gains, CTA Sora). Le SENS dépend du mix COD/prépayé (cf.
 * docs/livreur-paiement.md). 100 % des montants viennent du backend
 * (delivery_ledger non réglé + snapshots orders) — logique INCHANGÉE.
 */

export type SettlementData = {
  periodLabel: string;
  deliveriesCount: number;
  grossDriverDa: number;
  commissionDa: number;
  serviceFeeDa: number;
  driverFeeDa: number;
  toReverseDa: number;
  toReceiveDa: number;
  netDa: number;
  direction: "reverse" | "receive" | "settled";
  driverFeeRatePct: number;
  method: string | null;
  details: string | null;
  dueLabel: string | null;
};

const METHOD_LABEL: Record<string, string> = {
  ccp: "CCP",
  baridimob: "BaridiMob",
  bank: "Virement bancaire",
};

function grp(n: number) {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function SettlementView({
  data,
  pdfHref = "/api/pdf/releve",
  periodPicker,
}: {
  data: SettlementData;
  /** Export PDF de la MÊME période que l'écran (query reprise par la page). */
  pdfHref?: string;
  /** Sélecteur de période (mois / dates personnalisées), fourni par la page. */
  periodPicker?: React.ReactNode;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [showInstructions, setShowInstructions] = useState(false);
  const isReverse = data.direction === "reverse";
  const isReceive = data.direction === "receive";
  const methodLabel = data.method
    ? data.method === "bank"
      ? tr("Virement bancaire", "تحويل بنكي")
      : METHOD_LABEL[data.method]
    : null;

  return (
    <>
      <PartnerBackHeader
        href="/driver/gains"
        title={`${tr("Relevé", "كشف الحساب")} · ${data.periodLabel}`}
        subtitle={`${data.deliveriesCount} ${isAr ? "توصيلة" : "courses"}`}
      />

      {/* Période : en cours · par mois (toute l'ancienneté) · personnalisée. */}
      {periodPicker}

      {/* Carte héro violette (parité « À reverser » chauffeur). */}
      <PartnerHeroCard
        label={
          isReverse
            ? tr("À reverser à Coligo", "للتسديد إلى كوليغو")
            : isReceive
              ? tr("À recevoir de Coligo", "لاستلامه من كوليغو")
              : tr("Compte soldé", "الحساب مُسوّى")
        }
        value={`${grp(data.netDa)} DA`}
        sub={data.dueLabel}
      >
        {methodLabel && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/18 px-3 py-1.5 text-[12px] font-semibold">
            <CreditCard className="size-3.5" />
            {methodLabel}
            {data.details ? ` · ${data.details}` : " · BaridiMob"}
          </div>
        )}
      </PartnerHeroCard>

      {/* Détail qui réconcilie au solde (lignes façon d-gains). */}
      <div className="mt-3 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] px-3.5 py-1">
        <Line
          k={tr("Tes gains nets (à toi)", "أرباحك الصافية (لك)")}
          v={`+${grp(data.grossDriverDa)} DA`}
          tone={BRAND_GO}
        />
        <Line
          k={tr("Commissions commerçants", "عمولات التجّار")}
          v={`${grp(data.commissionDa)} DA`}
        />
        <Line
          k={tr("Frais de service", "رسوم الخدمة")}
          v={`${grp(data.serviceFeeDa)} DA`}
        />
        <Line
          k={`${tr("Part Coligo livraison", "حصة كوليغو للتوصيل")} (${data.driverFeeRatePct}%)`}
          v={`${grp(data.driverFeeDa)} DA`}
        />
        {data.toReceiveDa > 0 && (
          <Line
            k={tr(
              "Livraisons prépayées (dues par Coligo)",
              "توصيلات مدفوعة مسبقاً (مستحقة من كوليغو)"
            )}
            v={`+${grp(data.toReceiveDa)} DA`}
            tone={BRAND_GO}
          />
        )}
        <Line
          k={
            isReverse
              ? tr("Solde à reverser", "الرصيد المطلوب تسديده")
              : isReceive
                ? tr("Solde à recevoir", "الرصيد المطلوب استلامه")
                : tr("Solde", "الرصيد")
          }
          v={`${grp(data.netDa)} DA`}
          tone={BRAND_VIOLET}
          strong
        />
      </div>

      {data.direction !== "settled" && (
        <button
          type="button"
          onClick={() => setShowInstructions((s) => !s)}
          className="mt-4 flex h-[54px] w-full items-center justify-center rounded-[16px] text-[16px] font-bold text-white active:scale-[0.99]"
          style={{
            fontFamily: SORA,
            background: BRAND_VIOLET,
            boxShadow: "0 14px 28px -12px rgba(108,43,217,.6)",
          }}
        >
          {isReverse
            ? isAr
              ? `تسديد ${grp(data.netDa)} دج`
              : `Reverser ${grp(data.netDa)} DA`
            : isAr
              ? `استلام ${grp(data.netDa)} دج`
              : `Recevoir ${grp(data.netDa)} DA`}
        </button>
      )}

      {showInstructions && (
        <div className="mt-3 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-soft)] p-4 text-[13px] leading-relaxed text-[var(--d-ink)]">
          {isReverse ? (
            isAr ? (
              <>
                <b>كيف تسدّد؟</b> قم بتحويل <b>{grp(data.netDa)} دج</b> إلى حساب
                كوليغو {methodLabel ? `(${methodLabel})` : "(CCP / BaridiMob)"}،
                أو سلّم المبلغ نقداً في نقطة تجميع. يُحدَّث الرصيد بعد التأكيد.
              </>
            ) : (
              <>
                <b>Comment reverser&nbsp;?</b> Effectue un versement de{" "}
                <b>{grp(data.netDa)} DA</b> vers le compte Coligo{" "}
                {methodLabel ? `(${methodLabel})` : "(CCP / BaridiMob)"}, ou
                remets l&apos;espèce à un point de collecte. Le solde se met à
                jour après confirmation.
              </>
            )
          ) : isAr ? (
            <>
              <b>تسديد قادم.</b> ستحوّل لك كوليغو <b>{grp(data.netDa)} دج</b>{" "}
              إلى {methodLabel ?? "طريقة التسديد الخاصة بك"} في الدورة القادمة.
            </>
          ) : (
            <>
              <b>Versement à venir.</b> Coligo te versera{" "}
              <b>{grp(data.netDa)} DA</b> sur{" "}
              {methodLabel ?? "ta méthode de versement"} au prochain cycle.
            </>
          )}
        </div>
      )}

      {/* VRAI PDF (A4 généré serveur, /api/pdf/releve) — affiché dans le
          lecteur PDF puis téléchargeable ; plus de window.print() qui
          capturait l'écran mobile. */}
      <a
        href={pdfHref}
        target="_blank"
        rel="noopener"
        className="mt-3 block w-full text-center text-[13.5px] font-bold"
        style={{ color: BRAND_VIOLET }}
      >
        {tr("Télécharger le relevé (PDF)", "تحميل كشف الحساب (PDF)")}
      </a>
    </>
  );
}

/** Ligne de détail (parité d-gains). */
function Line({
  k,
  v,
  tone,
  strong,
}: {
  k: string;
  v: string;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--d-line)] py-3 text-[13.5px] last:border-b-0">
      <span
        className={strong ? "font-bold" : ""}
        style={{ color: strong ? "var(--d-ink)" : "var(--d-muted)" }}
      >
        {k}
      </span>
      <b
        style={{
          fontFamily: SORA,
          color: tone ?? "var(--d-ink)",
          fontSize: strong ? 16 : undefined,
        }}
      >
        {v}
      </b>
    </div>
  );
}
