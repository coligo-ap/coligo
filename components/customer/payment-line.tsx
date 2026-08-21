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
//
// UN SEUL libellé (décision produit du 12/08/2026) : on nomme la carte
// directement — « Carte Edahabia », « Carte Visa ••4242 » — au lieu d'empiler
// « Carte bancaire · Edahabia · Chargily ». Le FOURNISSEUR (Stripe/Chargily)
// n'est plus affiché : c'est de la plomberie interne, aucune valeur côté
// client. Il reste en base pour le support et la réconciliation.
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

  // UN SEUL libellé de moyen — décision produit : « Carte bancaire ·
  // Edahabia · Chargily » empilait trois façons de dire la même chose. On
  // nomme la carte DIRECTEMENT (« Carte Edahabia », « Carte Visa ») et on
  // tait le fournisseur (Stripe/Chargily) : c'est de la plomberie, le client
  // n'a rien à en faire.
  const parts: string[] = [];
  // Portefeuille du téléphone : c'est CE que le client a utilisé, il prime
  // sur la carte qui se cache derrière.
  const walletLabel = payment.wallet ? prettyWallet(payment.wallet) : null;
  // Type de carte : marque internationale (Visa/Mastercard/Amex) sinon
  // moyen local Chargily (CIB/Edahabia).
  const cardType = payment.brand
    ? prettyBrand(payment.brand)
    : payment.method
      ? prettyMethod(payment.method)
      : null;

  if (payment.mode === "cash") parts.push(t("cash"));
  else if (payment.mode === "coligo_pay") parts.push(t("wallet"));
  else if (walletLabel) parts.push(walletLabel);
  else if (payment.mode === "online" && !payment.provider && !cardType)
    parts.push(t("online"));
  else parts.push(cardType ? t("cardOf", { type: cardType }) : t("card"));

  // Les 4 derniers chiffres restent utiles pour reconnaître SA carte quand on
  // en a plusieurs (jamais le PAN, jamais de token).
  if (payment.last4) parts.push(`••${payment.last4}`);

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
