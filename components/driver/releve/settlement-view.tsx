"use client";

import { useState } from "react";
import { CreditCard, FileDown, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { formatDA } from "@/lib/utils";

/**
 * Écran « Relevé · règlement » (cf. MAQUETTE-livreur-pages, section Relevé).
 * Reproduit la net-card en dégradé violet, le détail (gains nets / commissions
 * / frais de service / part Coligo livraison 8 %) et le solde. Le SENS dépend du
 * mix COD/prépayé (cf. docs/livreur-paiement.md §1 & §7) :
 *   - direction 'reverse' → le livreur doit reverser (carte « À reverser »).
 *   - direction 'receive' → la plateforme doit au livreur (carte « À recevoir »).
 *
 * 100 % des montants viennent du backend (delivery_ledger non réglé + snapshots
 * orders) ; ce composant n'affiche que. Aucun mouvement d'argent ici : le
 * versement réel se fait via CCP/BaridiMob (coordonnées du profil).
 */

export type SettlementData = {
  periodLabel: string;
  deliveriesCount: number;
  grossDriverDa: number; // Σ driver_payout (gains nets livreur)
  commissionDa: number; // Σ commissions commerçants (cash)
  serviceFeeDa: number; // Σ frais de service (cash)
  driverFeeDa: number; // Σ part Coligo livraison (cash)
  toReverseDa: number; // Σ owes_platform (cash)
  toReceiveDa: number; // Σ driver_net (prépayé)
  netDa: number; // toReceive − toReverse
  direction: "reverse" | "receive" | "settled";
  driverFeeRatePct: number; // ex. 8
  method: string | null; // ccp | baridimob | bank
  details: string | null;
  dueLabel: string | null;
};

const METHOD_LABEL: Record<string, string> = {
  ccp: "CCP",
  baridimob: "BaridiMob",
  bank: "Virement bancaire",
};

function grp(n: number) {
  // Groupage manuel (espace) — déterministe SSR↔client (anti-hydratation #418).
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function SettlementView({ data }: { data: SettlementData }) {
  const [showInstructions, setShowInstructions] = useState(false);
  const isReverse = data.direction === "reverse";
  const isReceive = data.direction === "receive";
  const methodLabel = data.method ? METHOD_LABEL[data.method] : null;

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center gap-3">
        <Link
          href="/driver/gains"
          className="grid size-10 place-items-center rounded-[13px] bg-[#f4f5f9] text-[#0a0a0a]"
          aria-label="Retour"
        >
          <ChevronLeft className="size-[19px]" />
        </Link>
        <h1 className="text-[19px] font-bold tracking-[-0.4px] text-[#0a0a0a]">
          Relevé · {data.periodLabel}
        </h1>
      </div>

      {/* Net-card dégradé violet. */}
      <div
        className="rounded-[22px] p-5 text-white shadow-[0_18px_40px_-14px_rgba(108,43,217,.45)]"
        style={{ background: "linear-gradient(135deg,#6c2bd9,#4b1fa6)" }}
      >
        <div className="text-[12.5px] font-semibold opacity-85">
          {isReverse
            ? "À reverser à Coligo"
            : isReceive
              ? "À recevoir de Coligo"
              : "Compte soldé"}
        </div>
        <div className="my-1.5 text-[34px] font-extrabold tracking-[-1px]">
          {grp(data.netDa)} <span className="text-[18px] opacity-80">DA</span>
        </div>
        {data.dueLabel && (
          <div className="text-[12px] opacity-90">{data.dueLabel}</div>
        )}
        {methodLabel && (
          <div className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-white/[.18] px-3 py-1.5 text-[12px] font-semibold">
            <CreditCard className="size-3.5" />
            {methodLabel}
            {data.details ? ` · ${data.details}` : ""}
          </div>
        )}
      </div>

      {/* Détail. */}
      <div>
        <Row
          k="Tes gains nets (à toi)"
          v={`+${formatDA(data.grossDriverDa)}`}
          tone="gain"
        />
        <Row k="Commissions commerçants" v={formatDA(data.commissionDa)} />
        <Row k="Frais de service" v={formatDA(data.serviceFeeDa)} />
        <Row
          k={`Part Coligo livraison (${data.driverFeeRatePct}%)`}
          v={formatDA(data.driverFeeDa)}
        />
        {data.toReceiveDa > 0 && (
          <Row
            k="Livraisons prépayées (dues par Coligo)"
            v={`+${formatDA(data.toReceiveDa)}`}
            tone="gain"
          />
        )}
        <Row
          k={
            isReverse
              ? "Solde à reverser"
              : isReceive
                ? "Solde à recevoir"
                : "Solde"
          }
          v={`${grp(data.netDa)} DA`}
          total
        />
      </div>

      {data.direction !== "settled" && (
        <button
          type="button"
          onClick={() => setShowInstructions((s) => !s)}
          className="h-[54px] w-full rounded-[16px] bg-[#6c2bd9] text-[16px] font-bold text-white shadow-[0_14px_28px_-12px_#6c2bd9]"
        >
          {isReverse
            ? `Reverser ${grp(data.netDa)} DA`
            : `Recevoir ${grp(data.netDa)} DA`}
        </button>
      )}

      {showInstructions && (
        <div className="rounded-[16px] bg-[#f4f5f9] p-4 text-[13px] leading-relaxed text-[#1a1a1a]">
          {isReverse ? (
            <>
              <b className="text-[#0a0a0a]">Comment reverser&nbsp;?</b>
              <p className="mt-1.5 text-[#555]">
                Effectue un versement de{" "}
                <b className="text-[#0a0a0a]">{grp(data.netDa)} DA</b> vers le
                compte Coligo{" "}
                {methodLabel ? `(${methodLabel})` : "(CCP / BaridiMob)"}, ou
                remets l&apos;espèce à un point de collecte. Le solde se met à
                jour après confirmation.
              </p>
            </>
          ) : (
            <>
              <b className="text-[#0a0a0a]">Versement à venir</b>
              <p className="mt-1.5 text-[#555]">
                Coligo te versera{" "}
                <b className="text-[#0a0a0a]">{grp(data.netDa)} DA</b> sur{" "}
                {methodLabel
                  ? `${methodLabel}${data.details ? ` · ${data.details}` : ""}`
                  : "ta méthode de versement"}{" "}
                au prochain cycle de règlement.
              </p>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => window.print()}
        className="flex w-full items-center justify-center gap-2 text-[13.5px] font-bold text-[#6c2bd9]"
      >
        <FileDown className="size-4" />
        Télécharger le relevé (PDF)
      </button>

      <p className="px-1 text-[11px] leading-relaxed text-[#9e9e9e]">
        {data.deliveriesCount} livraison
        {data.deliveriesCount > 1 ? "s" : ""} sur la période · non encore
        réglées. Les relevés clôturés sont générés automatiquement à chaque
        cycle (hebdo/mensuel).
      </p>
    </div>
  );
}

function Row({
  k,
  v,
  tone,
  total,
}: {
  k: string;
  v: string;
  tone?: "gain";
  total?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between border-b border-[#eef0f4] py-[13px] text-[13.5px] last:border-b-0"
      }
    >
      <span
        className={
          total ? "font-bold text-[#0a0a0a]" : "font-medium text-[#757575]"
        }
      >
        {k}
      </span>
      <span
        className={
          "font-bold tabular-nums " +
          (total
            ? "text-[16px] text-[#6c2bd9]"
            : tone === "gain"
              ? "text-[#00a86b]"
              : "text-[#0a0a0a]")
        }
      >
        {v}
      </span>
    </div>
  );
}
