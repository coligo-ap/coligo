// =============================================================================
// Chargily Pay v2 — helper serveur
// =============================================================================
// ⚠️ ARGENT RÉEL — règles NON négociables (cf. PARTIE A du prompt 18) :
//   - CHARGILY_SECRET_KEY est UNIQUEMENT côté serveur (Server Actions /
//     Route Handlers). JAMAIS importé depuis un composant client.
//   - L'API utilisée : v2 publique, base configurable via CHARGILY_API_BASE
//     (https://pay.chargily.net/api/v2 par défaut). Le passage en LIVE se fait
//     juste en changeant les clés (test_sk_… → live_sk_…) dans l'env.
//   - La vérification de signature du webhook est obligatoire :
//     HMAC-SHA256(rawBody, secretKey) en hex, header "signature",
//     comparaison à temps constant (timingSafeEqual).
//   - Les montants sont en DA ENTIERS (Chargily accepte "amount" en integer + currency "dzd").
//
// Le `metadata` est notre principal vecteur d'idempotency côté webhook :
//   - `type`  : "order" | "topup"   (distingue paiement commande vs recharge)
//   - `order_id` ou `customer_id`   (selon le type)
//   - `client_operation_id`         (idempotency commande)
// =============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

// Chargily Pay v2 a DEUX endpoints distincts :
//   - test  : https://pay.chargily.net/test/api/v2   (utilisé par les clés test_sk_…)
//   - live  : https://pay.chargily.net/api/v2        (utilisé par les clés live_sk_…)
//
// On détecte automatiquement le mode à partir du préfixe de la clé pour
// éviter le piège classique "clé test sur endpoint live → 401 Unauthenticated".
// L'override manuel via CHARGILY_API_BASE reste possible (debug / nouvelle URL).
const LIVE_BASE = "https://pay.chargily.net/api/v2";
const TEST_BASE = "https://pay.chargily.net/test/api/v2";

function requireSecretKey(): string {
  const key = process.env.CHARGILY_SECRET_KEY;
  if (!key || key.length < 10) {
    throw new Error(
      "CHARGILY_SECRET_KEY manquant dans l'environnement. " +
        "Branchement Chargily impossible."
    );
  }
  return key;
}

function resolveApiBase(secretKey: string): string {
  const override = process.env.CHARGILY_API_BASE?.replace(/\/+$/, "");
  if (override) return override;
  return secretKey.startsWith("test_") ? TEST_BASE : LIVE_BASE;
}

// -----------------------------------------------------------------------------
// Types — on ne tape que ce dont on a besoin.
// -----------------------------------------------------------------------------
export type ChargilyMetadata = Record<string, string | number | boolean | null>;

export type CreateCheckoutInput = {
  amount: number; // entier DA (>= 1)
  successUrl: string;
  failureUrl?: string | null;
  webhookEndpoint?: string | null;
  metadata?: ChargilyMetadata | null;
  description?: string | null;
  locale?: "ar" | "fr" | "en";
  // Chargily répercute les frais selon ce champ. "merchant" = Coligo paie les
  // frais (modèle actuel : frais en `platform_ledger.chargily_fee`).
  feesAllocation?: "merchant" | "customer" | "split";
};

export type ChargilyCheckout = {
  id: string;
  entity: "checkout";
  livemode: boolean;
  amount: number;
  currency: string;
  status: string;
  checkout_url: string;
  success_url: string;
  failure_url: string | null;
  webhook_endpoint: string | null;
  metadata: ChargilyMetadata | null;
  created_at: number;
  updated_at: number;
};

export type ChargilyWebhookEvent = {
  id: string;
  entity: "event";
  livemode: boolean;
  type: "checkout.paid" | "checkout.failed" | "checkout.canceled" | string;
  data: ChargilyCheckout;
  created_at: number;
  updated_at: number;
};

// -----------------------------------------------------------------------------
// createCheckout — appelle POST /checkouts et renvoie le checkout (avec URL).
// -----------------------------------------------------------------------------
export async function createCheckout(
  input: CreateCheckoutInput
): Promise<ChargilyCheckout> {
  const secret = requireSecretKey();
  const apiBase = resolveApiBase(secret);

  const body: Record<string, unknown> = {
    amount: Math.round(input.amount),
    currency: "dzd",
    success_url: input.successUrl,
    chargily_pay_fees_allocation: input.feesAllocation ?? "merchant",
  };
  if (input.failureUrl) body.failure_url = input.failureUrl;
  if (input.webhookEndpoint) body.webhook_endpoint = input.webhookEndpoint;
  if (input.metadata) body.metadata = input.metadata;
  if (input.description) body.description = input.description;
  if (input.locale) body.locale = input.locale;

  const res = await fetch(`${apiBase}/checkouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const msg =
      (parsed as { message?: string } | null)?.message ??
      `Chargily a renvoyé ${res.status} ${res.statusText}`;
    throw new Error(`Chargily createCheckout: ${msg}`);
  }

  const checkout = parsed as ChargilyCheckout | null;
  if (!checkout || !checkout.id || !checkout.checkout_url) {
    throw new Error("Chargily createCheckout: réponse invalide.");
  }
  return checkout;
}

// -----------------------------------------------------------------------------
// verifyWebhookSignature — HMAC-SHA256(rawBody, secretKey) en hex.
// La comparaison se fait à temps constant pour éviter les timing attacks.
// -----------------------------------------------------------------------------
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined
): boolean {
  if (!signatureHeader) return false;
  const secret = requireSecretKey();

  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.trim();

  // Longueurs identiques requises pour timingSafeEqual.
  if (computed.length !== provided.length) return false;

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(provided));
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// buildCallbackUrls — construit les URLs absolues que Chargily appellera.
// `NEXT_PUBLIC_APP_URL` doit être configuré (ngrok en dev, domaine en prod).
// -----------------------------------------------------------------------------
export function buildCallbackUrls(opts: {
  context: "order" | "topup";
  orderId?: string;
}): { successUrl: string; failureUrl: string; webhookEndpoint: string } {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL manquant — Chargily a besoin d'URLs absolues."
    );
  }

  const orderQs = opts.orderId
    ? `?order_id=${encodeURIComponent(opts.orderId)}`
    : "";
  if (opts.context === "order") {
    return {
      successUrl: `${base}/checkout/success${orderQs}`,
      failureUrl: `${base}/checkout/failure${orderQs}`,
      webhookEndpoint: `${base}/api/chargily/webhook`,
    };
  }
  // topup
  return {
    successUrl: `${base}/cashback?topup=success`,
    failureUrl: `${base}/cashback?topup=failed`,
    webhookEndpoint: `${base}/api/chargily/webhook`,
  };
}
