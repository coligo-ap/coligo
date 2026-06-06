"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDownToLine, Plus, QrCode } from "lucide-react";
import { TopupModal } from "@/components/customer/coligo-pay-card";

// =============================================================================
// WalletActions — rangée d'actions wallet (façon Alipay) sur /coligo-pay :
//   • Payer (QR)  → écran scanner /coligo-pay/qr (MVP : payer un commerçant)
//   • Recevoir    → /coligo-pay/qr?tab=recv (affiché « bientôt » — P2P gelé)
//   • Recharger   → modale recharge (CIB/EDAHABIA via Chargily)
// =============================================================================
// Le plafond glissant (remaining30d) est vérifié serveur ; côté client on
// désactive « Recharger » s'il est nul.
// =============================================================================

export function WalletActions({
  remaining30d,
  maxPerRecharge,
}: {
  remaining30d: number;
  maxPerRecharge: number;
}) {
  const t = useTranslations("wallet");
  const [open, setOpen] = useState(false);
  const rechargeDisabled = remaining30d <= 0;

  return (
    <>
      <div className="mt-5 grid grid-cols-3 gap-2.5">
        <Link
          href="/coligo-pay/qr"
          className="flex flex-col items-center gap-2 rounded-[18px] bg-white p-3.5 shadow-[0_8px_20px_-14px_rgba(40,35,90,.2)] transition-transform active:scale-95"
        >
          <span className="bg-primary-600 grid size-[46px] place-items-center rounded-[14px] text-white shadow-[0_6px_14px_-4px_rgba(91,91,230,.45)]">
            <QrCode className="size-[22px]" />
          </span>
          <span className="text-foreground text-[11.5px] font-extrabold">
            {t("actionPay")}
          </span>
        </Link>

        <Link
          href="/coligo-pay/qr?tab=recv"
          className="flex flex-col items-center gap-2 rounded-[18px] bg-white p-3.5 shadow-[0_8px_20px_-14px_rgba(40,35,90,.2)] transition-transform active:scale-95"
        >
          <span className="bg-primary-50 text-primary-600 grid size-[46px] place-items-center rounded-[14px]">
            <Plus className="size-[22px]" />
          </span>
          <span className="text-foreground text-[11.5px] font-extrabold">
            {t("actionReceive")}
          </span>
        </Link>

        <button
          type="button"
          disabled={rechargeDisabled}
          onClick={() => setOpen(true)}
          className="flex flex-col items-center gap-2 rounded-[18px] bg-white p-3.5 shadow-[0_8px_20px_-14px_rgba(40,35,90,.2)] transition-transform active:scale-95 disabled:opacity-50"
        >
          <span className="bg-primary-50 text-primary-600 grid size-[46px] place-items-center rounded-[14px]">
            <ArrowDownToLine className="size-[22px]" />
          </span>
          <span className="text-foreground text-[11.5px] font-extrabold">
            {t("actionRecharge")}
          </span>
        </button>
      </div>

      {rechargeDisabled && (
        <p className="text-warning-700 mt-2 text-center text-xs">
          {t("monthlyCapReached")}
        </p>
      )}

      {open && (
        <TopupModal
          onClose={() => setOpen(false)}
          remaining30d={remaining30d}
          maxPerRecharge={maxPerRecharge}
        />
      )}
    </>
  );
}
