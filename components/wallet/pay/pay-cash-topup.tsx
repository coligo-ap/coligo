"use client";

import { Info } from "lucide-react";
import { PartnerBackHeader } from "@/components/shared/partner-ui";
import { RECHARGE_STYLE } from "@/components/wallet/operator-recharge.style";
import { CashFinder } from "@/components/wallet/operator-recharge-cash-finder";
import { PayScreen, payHref, usePayLang, type PayBase } from "./pay-core";

/**
 * RECHARGER EN ESPÈCES — page dédiée à l'annuaire d'agents Coligo Pay
 * (liste / carte / « ma position »). Réutilise `CashFinder` tel quel : le
 * composant vit dans le scope `.cgw` + RECHARGE_STYLE dont il dépend.
 */
export function PayCashTopup({ base }: { base: PayBase }) {
  const { lang, tr, dir } = usePayLang();
  return (
    <PayScreen dir={dir}>
      <PartnerBackHeader
        title={
          lang === "ar" ? "لدى وكيل Coligo Pay" : "Chez un agent Coligo Pay"
        }
        subtitle={lang === "ar" ? "اشحن نقدًا" : "Rechargez en espèces"}
        href={payHref(base, "/methode")}
      />

      <section className="cgw" dir={dir}>
        <style>{RECHARGE_STYLE}</style>
        <div className="panel">
          <CashFinder t={tr} />
        </div>
      </section>

      {/* À savoir — le crédit est immédiat une fois l'espèce remise */}
      <div
        className="mt-3 flex items-start gap-2.5 rounded-lg p-3.5"
        style={{ background: "var(--d-accent)" }}
      >
        <Info
          className="mt-[1px] size-4 shrink-0"
          style={{ color: "var(--d-violet)" }}
        />
        <p className="text-label leading-snug font-semibold text-[var(--d-ink)]">
          {tr.cashNote}
        </p>
      </div>
    </PayScreen>
  );
}
