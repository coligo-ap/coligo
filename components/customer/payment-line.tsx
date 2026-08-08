"use client";

// =============================================================================
// Ligne « comment ça a été payé » — historique client (courses + commandes)
// =============================================================================
// Une seule implémentation partagée : la même information doit se lire à
// l'identique dans l'historique Drive et dans le détail d'une commande.
//
// Règle : on n'affiche QUE ce qu'on sait réellement (mig 0394). Chargily
// n'expose ni la marque ni les 4 derniers chiffres → on montre le moyen local
// (CIB / Edahabia) sans inventer de carte. Aucune donnée sensible : jamais de
// PAN, jamais de token — marque + 4 chiffres uniquement.
// =============================================================================

import { useLocale, useTranslations } from "next-intl";
import { CreditCard, Wallet, Banknote, AlertTriangle } from "lucide-react";

export type PaymentInfo = {
  /** 'online' = payé en ligne sans reçu détaillé (portefeuille, commande
   *  historique antérieure à la mig 0394) — on reste vague plutôt que faux. */
  mode: "cash" | "card" | "coligo_pay" | "online";
  provider: "stripe" | "chargily" | null;
  brand: string | null;
  last4: string | null;
  wallet: string | null;
  method: string | null;
  status: "paid" | "failed" | "refunded" | null;
  paid_at: string | null;
};

/** « visa » → « Visa », « mastercard » → « Mastercard ». */
function prettyBrand(brand: string): string {
  if (brand.toLowerCase() === "mastercard") return "Mastercard";
  if (brand.toLowerCase() === "amex") return "Amex";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function prettyMethod(method: string): string | null {
  const m = method.toLowerCase();
  if (m === "cib") return "CIB";
  if (m === "edahabia") return "Edahabia";
  return null; // 'card' n'apporte rien de plus que le libellé du mode
}

function prettyWallet(wallet: string): string | null {
  const w = wallet.toLowerCase();
  if (w === "apple_pay") return "Apple Pay";
  if (w === "google_pay") return "Google Pay";
  return null;
}

export function PaymentLine({
  payment,
  className = "",
  /** Affiche aussi la date/heure du paiement (détail d'une commande). */
  withDate = false,
}: {
  payment: PaymentInfo;
  className?: string;
  withDate?: boolean;
}) {
  const t = useTranslations("payment");
  const locale = useLocale();

  const Icon =
    payment.mode === "cash"
      ? Banknote
      : payment.mode === "coligo_pay"
        ? Wallet
        : CreditCard;

  // Fragments cumulés dans l'ordre « quoi · avec quoi · par qui ».
  const parts: string[] = [];
  if (payment.mode === "cash") parts.push(t("cash"));
  else if (payment.mode === "coligo_pay") parts.push(t("wallet"));
  else if (payment.mode === "online" && !payment.provider)
    parts.push(t("online"));
  else parts.push(t("card"));

  if (payment.brand && payment.last4) {
    parts.push(`${prettyBrand(payment.brand)} ••${payment.last4}`);
  } else if (payment.last4) {
    parts.push(`••${payment.last4}`);
  } else if (payment.method) {
    const m = prettyMethod(payment.method);
    if (m) parts.push(m);
  }

  if (payment.wallet) {
    const w = prettyWallet(payment.wallet);
    if (w) parts.push(w);
  }

  if (payment.provider) {
    parts.push(payment.provider === "stripe" ? "Stripe" : "Chargily");
  }

  if (withDate && payment.paid_at) {
    parts.push(
      new Date(payment.paid_at).toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Algiers",
      })
    );
  }

  // Un paiement échoué ou remboursé ne doit JAMAIS se lire comme un paiement
  // normal : statut explicite, en tête.
  const abnormal = payment.status === "failed" || payment.status === "refunded";

  return (
    <span
      className={`text-caption-lg inline-flex flex-wrap items-center gap-1.5 font-semibold ${className}`}
      style={{ color: abnormal ? "var(--warning-700, #a15c00)" : undefined }}
    >
      {abnormal ? (
        <AlertTriangle className="size-3.5 shrink-0" />
      ) : (
        <Icon className="size-3.5 shrink-0 opacity-70" />
      )}
      {abnormal && (
        <b>
          {payment.status === "refunded" ? t("refunded") : t("failed")}
          {" ·"}
        </b>
      )}
      <span>{parts.join(" · ")}</span>
    </span>
  );
}
