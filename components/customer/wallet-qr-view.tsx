"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, Clock, Keyboard, Plus, QrCode } from "lucide-react";
import { QrScanner } from "@/components/scanner/qr-scanner";
import { OrderQr } from "@/components/customer/order-qr";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// =============================================================================
// WalletQrView — écran QR du wallet Coligo Pay (façon Alipay).
// =============================================================================
// Onglets glissants Payer | Recevoir.
//
// ⚠️ PÉRIMÈTRE MVP (cf. PROMPT-COMPTE-WALLET.md) :
//  • PAYER  : le client scanne le QR d'un COMMERÇANT pour payer en magasin avec
//             son solde Coligo Pay. Le scanner est opérationnel ; l'exécution du
//             paiement (débit ledger / crédit commande, idempotence, snapshot,
//             validation serveur) reste à brancher côté commerçant → on affiche
//             un état « bientôt » au scan tant que l'infra QR marchand n'existe
//             pas. AUCUN mouvement d'argent n'est déclenché ici.
//  • RECEVOIR (P2P entre particuliers) : GELÉ — exige licence Banque d'Algérie +
//             KYC/AML. Affiché en « Bientôt disponible ». L'architecture reste
//             prête : le QR encode un identifiant, pas un secret.
// =============================================================================

type Tab = "pay" | "recv";

export function WalletQrView({
  customerName,
  identifier,
  initialTab = "pay",
}: {
  customerName: string;
  identifier: string;
  initialTab?: Tab;
}) {
  const t = useTranslations("wallet");
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [codeMode, setCodeMode] = useState(false);
  const [code, setCode] = useState("");

  function comingSoon() {
    toast.info(t("qrPayComingSoon"));
  }

  return (
    <div className="from-primary-600 to-primary-800 relative flex min-h-screen flex-col bg-gradient-to-b text-white">
      {/* En-tête */}
      <header className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-1.5">
        <button
          type="button"
          onClick={() => router.push("/coligo-pay")}
          aria-label={t("qrTitle")}
          className="grid size-9 place-items-center rounded-full bg-white/20 transition-transform active:scale-90"
        >
          <ChevronLeft className="size-[18px] rtl:-scale-x-100" />
        </button>
        <h1 className="text-[19px] font-black">{t("qrTitle")}</h1>
      </header>

      {/* Onglets glissants Payer | Recevoir */}
      <div className="relative mx-4 mt-3 flex rounded-[14px] bg-white/15 p-1">
        <span
          className={cn(
            "absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-[11px] bg-white transition-transform duration-300 ease-[cubic-bezier(.34,1.4,.64,1)]",
            tab === "recv" && "translate-x-full rtl:-translate-x-full"
          )}
        />
        <button
          type="button"
          onClick={() => setTab("pay")}
          className={cn(
            "relative z-10 flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-extrabold transition-colors",
            tab === "pay" ? "text-primary-700" : "text-white/80"
          )}
        >
          <QrCode className="size-4" />
          {t("qrTabPay")}
        </button>
        <button
          type="button"
          onClick={() => setTab("recv")}
          className={cn(
            "relative z-10 flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-extrabold transition-colors",
            tab === "recv" ? "text-primary-700" : "text-white/80"
          )}
        >
          <Plus className="size-4" />
          {t("qrTabReceive")}
        </button>
      </div>

      {/* ── PAYER : scanner ───────────────────────────────────────────────── */}
      {tab === "pay" && (
        <div className="flex flex-1 flex-col items-center px-6 pt-6">
          <QrScanner
            onScan={comingSoon}
            oneShot={false}
            className="aspect-square w-full max-w-[240px] rounded-[28px]"
          />
          <p className="mt-6 max-w-[280px] text-center text-[13.5px] font-bold opacity-90">
            {t("qrScanMerchant")}
          </p>

          {!codeMode ? (
            <button
              type="button"
              onClick={() => setCodeMode(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-[13px] bg-white/15 px-5 py-3 text-[13px] font-extrabold"
            >
              <Keyboard className="size-4" />
              {t("qrEnterCode")}
            </button>
          ) : (
            <div className="mt-6 w-full max-w-[280px] space-y-2.5">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t("qrEnterCodePlaceholder")}
                className="text-foreground w-full rounded-[13px] bg-white px-3.5 py-3.5 text-center text-sm font-bold outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCodeMode(false);
                    setCode("");
                  }}
                  className="h-11 flex-1 rounded-[12px] bg-white/15 text-sm font-extrabold"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  disabled={code.trim() === ""}
                  onClick={comingSoon}
                  className="text-primary-700 h-11 flex-1 rounded-[12px] bg-white text-sm font-extrabold disabled:opacity-50"
                >
                  {t("qrValidate")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── RECEVOIR : QR personnel (gelé — bientôt disponible) ────────────── */}
      {tab === "recv" && (
        <div className="flex flex-1 flex-col items-center px-6 pt-6">
          <div className="relative w-[236px] rounded-[26px] bg-white p-5 text-center shadow-[0_20px_50px_-16px_rgba(0,0,0,.4)]">
            <div className="pointer-events-none opacity-40 blur-[2px] select-none">
              <div className="mx-auto w-fit">
                <OrderQr value={`coligo:pay:${identifier}`} size={170} />
              </div>
            </div>
            {/* Badge « Bientôt disponible » par-dessus le QR */}
            <span className="bg-primary-600 absolute top-1/2 left-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-extrabold whitespace-nowrap text-white shadow-lg">
              <Clock className="size-3.5" />
              {t("qrComingSoon")}
            </span>
            <p className="text-foreground mt-4 text-[15px] font-black">
              {customerName}
            </p>
            <p className="text-muted mt-0.5 text-xs font-medium">
              {t("qrMyQrName")} · {identifier}
            </p>
          </div>
          <p className="mt-5 max-w-[300px] text-center text-[13px] font-bold opacity-90">
            {t("qrReceiveComingSoonDesc")}
          </p>
        </div>
      )}

      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}
