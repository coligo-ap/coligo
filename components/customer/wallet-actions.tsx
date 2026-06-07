"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDownToLine, Plus, QrCode, Send } from "lucide-react";
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
      {/* Panneau d'actions UNIFIÉ (une seule carte, 4 colonnes) — épuré. */}
      <div className="border-border -mt-7 grid grid-cols-4 gap-1 rounded-[22px] border bg-white p-2 shadow-[0_14px_34px_-18px_rgba(40,35,90,.3)]">
        <Action
          href="/coligo-pay/qr"
          icon={<QrCode className="size-[21px]" />}
          label={t("actionPay")}
          primary
        />
        <Action
          href="/coligo-pay/envoyer"
          icon={<Send className="size-[21px]" />}
          label={t("actionSend")}
        />
        <Action
          href="/coligo-pay/qr?tab=recv"
          icon={<Plus className="size-[21px]" />}
          label={t("actionReceive")}
        />
        <Action
          onClick={() => setOpen(true)}
          disabled={rechargeDisabled}
          icon={<ArrowDownToLine className="size-[21px]" />}
          label={t("actionRecharge")}
        />
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

function Action({
  href,
  onClick,
  disabled,
  icon,
  label,
  primary,
}: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  const inner = (
    <span className="flex flex-col items-center gap-1.5 rounded-[16px] py-2.5 transition active:scale-95">
      <span
        className={
          primary
            ? "bg-primary-600 grid size-[46px] place-items-center rounded-[14px] text-white shadow-[0_6px_14px_-4px_rgba(91,91,230,.45)]"
            : "bg-primary-50 text-primary-600 grid size-[46px] place-items-center rounded-[14px]"
        }
      >
        {icon}
      </span>
      <span className="text-foreground text-[11.5px] font-extrabold">
        {label}
      </span>
    </span>
  );
  if (href) {
    return (
      <Link href={href} className="hover:bg-surface-2 rounded-[16px]">
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hover:bg-surface-2 rounded-[16px] disabled:opacity-50"
    >
      {inner}
    </button>
  );
}
