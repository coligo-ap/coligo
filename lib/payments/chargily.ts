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
import { createAdminClient } from "@/lib/supabase/admin";

// Chargily Pay v2 a DEUX endpoints distincts :
//   - test  : https://pay.chargily.net/test/api/v2   (utilisé par les clés test_sk_…)
//   - live  : https://pay.chargily.net/api/v2        (utilisé par les clés live_sk_…)
//
// On détecte automatiquement le mode à partir du préfixe de la clé pour
// éviter le piège classique "clé test sur endpoint live → 401 Unauthenticated".
// L'override manuel via CHARGILY_API_BASE reste possible (debug / nouvelle URL).
const LIVE_BASE = "https://pay.chargily.net/api/v2";
const TEST_BASE = "https://pay.chargily.net/test/api/v2";

// ─────────────────────────────────────────────────────────────────────────────
// Mode TEST / LIVE — piloté par le super-admin (toggle /admin/controle,
// colonne platform_settings.chargily_live_mode, mig 0347). Les CLÉS restent
// dans l'environnement :
//   - test : CHARGILY_TEST_SECRET_KEY (repli : CHARGILY_SECRET_KEY historique)
//   - live : CHARGILY_LIVE_SECRET_KEY
// Fail-safe : toute erreur de lecture ⇒ TEST (on n'encaisse jamais du vrai
// argent par accident). Garde de préfixe : une clé qui ne correspond pas au
// mode demandé fait ÉCHOUER le paiement plutôt que de l'envoyer au mauvais
// environnement.
// ─────────────────────────────────────────────────────────────────────────────
export type ChargilyMode = "live" | "test";

export async function getChargilyMode(): Promise<ChargilyMode> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("platform_settings")
      .select("chargily_live_mode" as never)
      .eq("id", true)
      .maybeSingle();
    return (data as { chargily_live_mode?: boolean } | null)
      ?.chargily_live_mode === true
      ? "live"
      : "test";
  } catch {
    return "test";
  }
}

function secretKeyFor(mode: ChargilyMode): string {
  const key =
    mode === "live"
      ? process.env.CHARGILY_LIVE_SECRET_KEY
      : (process.env.CHARGILY_TEST_SECRET_KEY ??
        process.env.CHARGILY_SECRET_KEY);
  if (!key || key.length < 10) {
    throw new Error(
      `Clé secrète Chargily du mode ${mode.toUpperCase()} manquante dans ` +
        "l'environnement. Branchement Chargily impossible."
    );
  }
  const expected = mode === "live" ? "live_" : "test_";
  if (!key.startsWith(expected)) {
    throw new Error(
      `La clé Chargily configurée pour le mode ${mode.toUpperCase()} ne ` +
        `commence pas par « ${expected} » — refus d'envoyer le paiement au ` +
        "mauvais environnement."
    );
  }
  return key;
}

/** Clés candidates pour vérifier un webhook (test + live si configurées). */
function webhookCandidateKeys(): string[] {
  return [
    process.env.CHARGILY_LIVE_SECRET_KEY,
    process.env.CHARGILY_TEST_SECRET_KEY,
    process.env.CHARGILY_SECRET_KEY,
  ].filter((k): k is string => !!k && k.length >= 10);
}

/** Présence des clés par mode (pour l'écran admin — jamais les valeurs). */
export function chargilyKeysPresence(): { test: boolean; live: boolean } {
  return {
    test: !!(
      process.env.CHARGILY_TEST_SECRET_KEY ?? process.env.CHARGILY_SECRET_KEY
    ),
    live: !!process.env.CHARGILY_LIVE_SECRET_KEY,
  };
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
  // Le mode actif (test/live) est lu en base à CHAQUE création : le toggle
  // super-admin prend effet immédiatement, sans redéploiement.
  const mode = await getChargilyMode();
  const secret = secretKeyFor(mode);
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
  const provided = signatureHeader.trim();

  // Un webhook peut provenir de l'environnement TEST ou LIVE (ex. events test
  // encore en file après le passage en live) : on vérifie contre CHAQUE clé
  // configurée. Un HMAC ne valide que pour sa propre clé — aucune perte de
  // sécurité, et l'event.livemode du payload reste disponible aux consommateurs.
  for (const secret of webhookCandidateKeys()) {
    const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (computed.length !== provided.length) continue;
    try {
      if (timingSafeEqual(Buffer.from(computed), Buffer.from(provided))) {
        return true;
      }
    } catch {
      /* longueur/encodage invalide → clé suivante */
    }
  }
  return false;
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
