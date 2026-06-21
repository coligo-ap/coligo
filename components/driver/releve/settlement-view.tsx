"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";

/**
 * Écran « Relevé · règlement » reproduit À L'IDENTIQUE de MAQUETTE-livreur-pages
 * (.backh + .net-card dégradé + .brk + .mq-btn + .btnlink). Le SENS dépend du mix
 * COD/prépayé (cf. docs/livreur-paiement.md). 100 % des montants viennent du
 * backend (delivery_ledger non réglé + snapshots orders).
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

export function SettlementView({ data }: { data: SettlementData }) {
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
      <div className="backh">
        <Link
          href="/driver/gains"
          className="b"
          aria-label={tr("Retour", "رجوع")}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1>
          {tr("Relevé", "كشف الحساب")} · {data.periodLabel}
        </h1>
      </div>

      <div className="net-card">
        <div className="lbl">
          {isReverse
            ? tr("À reverser à Coligo", "للتسديد إلى كوليغو")
            : isReceive
              ? tr("À recevoir de Coligo", "لاستلامه من كوليغو")
              : tr("Compte soldé", "الحساب مُسوّى")}
        </div>
        <div className="v">{grp(data.netDa)} DA</div>
        {data.dueLabel && <div className="due">{data.dueLabel}</div>}
        {methodLabel && (
          <div className="meth">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
            </svg>
            {methodLabel}
            {data.details ? ` · ${data.details}` : " · BaridiMob"}
          </div>
        )}
      </div>

      <div className="brk">
        <div className="r gain">
          <span className="k">
            {tr("Tes gains nets (à toi)", "أرباحك الصافية (لك)")}
          </span>
          <span className="vv">+{grp(data.grossDriverDa)} DA</span>
        </div>
        <div className="r">
          <span className="k">
            {tr("Commissions commerçants", "عمولات التجّار")}
          </span>
          <span className="vv">{grp(data.commissionDa)} DA</span>
        </div>
        <div className="r">
          <span className="k">{tr("Frais de service", "رسوم الخدمة")}</span>
          <span className="vv">{grp(data.serviceFeeDa)} DA</span>
        </div>
        <div className="r">
          <span className="k">
            {tr("Part Coligo livraison", "حصة كوليغو للتوصيل")} (
            {data.driverFeeRatePct}%)
          </span>
          <span className="vv">{grp(data.driverFeeDa)} DA</span>
        </div>
        {data.toReceiveDa > 0 && (
          <div className="r gain">
            <span className="k">
              {tr(
                "Livraisons prépayées (dues par Coligo)",
                "توصيلات مدفوعة مسبقاً (مستحقة من كوليغو)"
              )}
            </span>
            <span className="vv">+{grp(data.toReceiveDa)} DA</span>
          </div>
        )}
        <div className="r total">
          <span className="k">
            {isReverse
              ? tr("Solde à reverser", "الرصيد المطلوب تسديده")
              : isReceive
                ? tr("Solde à recevoir", "الرصيد المطلوب استلامه")
                : tr("Solde", "الرصيد")}
          </span>
          <span className="vv">{grp(data.netDa)} DA</span>
        </div>
      </div>

      {data.direction !== "settled" && (
        <button
          type="button"
          className="mq-btn"
          onClick={() => setShowInstructions((s) => !s)}
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
        <div
          className="card"
          style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6 }}
        >
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

      <button type="button" className="btnlink" onClick={() => window.print()}>
        {tr("Télécharger le relevé (PDF)", "تحميل كشف الحساب (PDF)")}
      </button>
    </>
  );
}
