"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDownToLine, Plus, QrCode, Send } from "lucide-react";
import { TopupModal } from "@/components/customer/coligo-pay-card";

// =============================================================================
// WalletActions — rangée d'actions wallet (façon Alipay) sur /coligo-pay :
//   • Payer (QR)  → scanner /coligo-pay/qr (commerçant OU QR ami → transfert)
//   • Envoyer     → /coligo-pay/envoyer (P2P : recherche tél/@handle, récents)
//   • Recevoir    → /coligo-pay/qr?tab=recv : mon QR perso (handle) — ACTIF
//   • Recharger   → modale recharge (CIB/EDAHABIA via Chargily)
// Transfert P2P boucle fermée (mig 0084/0085/0086) : PIN, idempotence,
// double-entrée (SUM=0), anti double-dépense — testé de bout en bout.
// =============================================================================
// Le plafond glissant (remaining30d) est vérifié serveur ; côté client on
// désactive « Recharger » s'il est nul.
// =============================================================================

export function WalletActions({
  remaining30d,
  maxPerRecharge,
  p2pEnabled = false,
}: {
  remaining30d: number;
  maxPerRecharge: number;
  // ch.0.10 SPEC-COLIGO-PAY — P2P désactivé au lancement : Envoyer/Recevoir
  // grisés (« Bientôt disponible ») tant que p2pEnabled est faux. Le paiement
  // marchand (Payer) et la recharge restent actifs.
  p2pEnabled?: boolean;
}) {
  const t = useTranslations("wallet");
  const [open, setOpen] = useState(false);
  const rechargeDisabled = remaining30d <= 0;

  return (
    <>
      {/* Panneau d'actions UNIFIÉ (une seule carte) — épuré. Pas de chevauchement
          avec le hero : marge nette au-dessus.
          P2P (Envoyer/Recevoir) MASQUÉ tant que p2pEnabled est faux — aucune
          surface « transfert d'argent » exposée (cf. lib/customer/p2p.ts). Le
          panneau retombe alors sur 2 colonnes (Payer + Recharger). */}
      <div
        className={
          "border-border rounded-sheet-xl mt-4 grid gap-1 border bg-white p-2 shadow-[0_10px_28px_-18px_rgba(40,35,90,.28)] " +
          (p2pEnabled ? "grid-cols-4" : "grid-cols-2")
        }
      >
        <Action
          href="/coligo-pay/qr"
          icon={<QrCode className="size-[21px]" />}
          label={t("actionPay")}
          primary
        />
        {p2pEnabled && (
          <Action
            href="/coligo-pay/envoyer"
            icon={<Send className="size-[21px]" />}
            label={t("actionSend")}
          />
        )}
        {p2pEnabled && (
          <Action
            href="/coligo-pay/qr?tab=recv"
            icon={<Plus className="size-[21px]" />}
            label={t("actionReceive")}
          />
        )}
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
  soon,
  icon,
  label,
  primary,
}: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  soon?: boolean;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  const t = useTranslations("wallet");
  const inner = (
    <span className="flex flex-col items-center gap-1.5 rounded-lg py-2.5 transition active:scale-95">
      <span
        className={
          primary
            ? "bg-primary-600 rounded-card-lg grid size-[46px] place-items-center text-white shadow-[0_6px_14px_-4px_rgba(91,91,230,.45)]"
            : "bg-primary-50 text-primary-600 rounded-card-lg grid size-[46px] place-items-center"
        }
      >
        {icon}
      </span>
      <span className="text-foreground text-caption-lg font-extrabold">
        {label}
      </span>
      {soon && (
        <span className="text-muted-foreground text-nano font-semibold">
          {t("comingSoon")}
        </span>
      )}
    </span>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className="hover:bg-surface-2 rounded-lg">
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hover:bg-surface-2 rounded-lg disabled:opacity-50"
    >
      {inner}
    </button>
  );
}
