"use client";

import { useState } from "react";
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
  const [showInstructions, setShowInstructions] = useState(false);
  const isReverse = data.direction === "reverse";
  const isReceive = data.direction === "receive";
  const methodLabel = data.method ? METHOD_LABEL[data.method] : null;

  return (
    <>
      <div className="backh">
        <Link href="/driver/gains" className="b" aria-label="Retour">
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
        <h1>Relevé · {data.periodLabel}</h1>
      </div>

      <div className="net-card">
        <div className="lbl">
          {isReverse
            ? "À reverser à Coligo"
            : isReceive
              ? "À recevoir de Coligo"
              : "Compte soldé"}
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
          <span className="k">Tes gains nets (à toi)</span>
          <span className="vv">+{grp(data.grossDriverDa)} DA</span>
        </div>
        <div className="r">
          <span className="k">Commissions commerçants</span>
          <span className="vv">{grp(data.commissionDa)} DA</span>
        </div>
        <div className="r">
          <span className="k">Frais de service</span>
          <span className="vv">{grp(data.serviceFeeDa)} DA</span>
        </div>
        <div className="r">
          <span className="k">
            Part Coligo livraison ({data.driverFeeRatePct}%)
          </span>
          <span className="vv">{grp(data.driverFeeDa)} DA</span>
        </div>
        {data.toReceiveDa > 0 && (
          <div className="r gain">
            <span className="k">Livraisons prépayées (dues par Coligo)</span>
            <span className="vv">+{grp(data.toReceiveDa)} DA</span>
          </div>
        )}
        <div className="r total">
          <span className="k">
            {isReverse
              ? "Solde à reverser"
              : isReceive
                ? "Solde à recevoir"
                : "Solde"}
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
            ? `Reverser ${grp(data.netDa)} DA`
            : `Recevoir ${grp(data.netDa)} DA`}
        </button>
      )}

      {showInstructions && (
        <div
          className="card"
          style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6 }}
        >
          {isReverse ? (
            <>
              <b>Comment reverser&nbsp;?</b> Effectue un versement de{" "}
              <b>{grp(data.netDa)} DA</b> vers le compte Coligo{" "}
              {methodLabel ? `(${methodLabel})` : "(CCP / BaridiMob)"}, ou
              remets l&apos;espèce à un point de collecte. Le solde se met à
              jour après confirmation.
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
        Télécharger le relevé (PDF)
      </button>
    </>
  );
}
