// =============================================================================
// Stripe — helper serveur (paiements internationaux EUR, diaspora)
// =============================================================================
// ⚠️ ARGENT RÉEL — mêmes règles non négociables que Chargily :
//   - Les clés Stripe sont UNIQUEMENT côté serveur (Server Actions / Route
//     Handlers). JAMAIS importées d'un composant client.
//   - Mode TEST/LIVE piloté par le super-admin (platform_settings.
//     stripe_live_mode, mig 0377 — même modèle que chargily_live_mode) :
//     lu en base à CHAQUE création de session, effet immédiat. Fail-safe :
//     toute erreur de lecture ⇒ TEST. Garde de préfixe : une clé qui ne
//     correspond pas au mode demandé fait ÉCHOUER le paiement plutôt que de
//     l'envoyer au mauvais environnement.
//   - La confirmation de paiement vient UNIQUEMENT du webhook (signature
//     vérifiée par la lib officielle, secrets test ET live essayés — un
//     event ne valide que contre le secret de son environnement).
//   - 3-D Secure FORCÉ sur toutes les cartes (request_three_d_secure: "any") :
//     DSP2 + bascule de responsabilité fraude vers la banque du porteur.
//   - Montants en CENTIMES d'euro entiers, calculés côté serveur au taux
//     maison (lib/payments/intl.ts) — le taux n'apparaît JAMAIS côté client.
// =============================================================================

import "server-only";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export type StripeMode = "live" | "test";

/** Mode actif — colonne platform_settings.stripe_live_mode (super-admin). */
export async function getStripeMode(): Promise<StripeMode> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("platform_settings")
      .select("stripe_live_mode" as never)
      .eq("id", true)
      .maybeSingle();
    return (data as { stripe_live_mode?: boolean } | null)?.stripe_live_mode ===
      true
      ? "live"
      : "test";
  } catch {
    return "test";
  }
}

function secretKeyFor(mode: StripeMode): string {
  const key =
    mode === "live"
      ? process.env.STRIPE_LIVE_SECRET_KEY
      : process.env.STRIPE_TEST_SECRET_KEY;
  if (!key || key.length < 10) {
    throw new Error(
      `Clé secrète Stripe du mode ${mode.toUpperCase()} manquante dans ` +
        "l'environnement. Paiement international impossible."
    );
  }
  const expected = mode === "live" ? "sk_live_" : "sk_test_";
  if (!key.startsWith(expected)) {
    throw new Error(
      `La clé Stripe configurée pour le mode ${mode.toUpperCase()} ne ` +
        `commence pas par « ${expected} » — refus d'envoyer le paiement au ` +
        "mauvais environnement."
    );
  }
  return key;
}

// Un client par mode (le super-admin peut basculer sans redéploiement).
const clients: Partial<Record<StripeMode, Stripe>> = {};

function stripeFor(mode: StripeMode): Stripe {
  const existing = clients[mode];
  if (existing) return existing;
  const created = new Stripe(secretKeyFor(mode));
  clients[mode] = created;
  return created;
}

/** Au moins une clé secrète configurée ? (gating grossier côté éligibilité —
 *  le mode précis est revérifié à la création de session). */
export function stripeAnyKeyPresent(): boolean {
  return !!(
    process.env.STRIPE_TEST_SECRET_KEY ?? process.env.STRIPE_LIVE_SECRET_KEY
  );
}

/** Clé publiable du mode actif — SEULE clé qui a le droit d'aller au client
 *  (elle est faite pour ça : monter le Payment Element). */
export async function getPublishableKey(): Promise<string | null> {
  const mode = await getStripeMode();
  const key =
    mode === "live"
      ? process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY
      : process.env.NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY;
  if (!key) return null;
  const expected = mode === "live" ? "pk_live_" : "pk_test_";
  return key.startsWith(expected) ? key : null;
}

/** Présence des clés par mode (pour l'écran admin — jamais les valeurs). */
export function stripeKeysPresence(): {
  test: boolean;
  live: boolean;
  webhook_test: boolean;
  webhook_live: boolean;
} {
  return {
    test: !!process.env.STRIPE_TEST_SECRET_KEY,
    live: !!process.env.STRIPE_LIVE_SECRET_KEY,
    webhook_test: !!process.env.STRIPE_TEST_WEBHOOK_SECRET,
    webhook_live: !!process.env.STRIPE_LIVE_WEBHOOK_SECRET,
  };
}

// Stripe Checkout ne supporte pas l'arabe → repli 'auto' (langue navigateur).
function stripeLocale(
  locale: string
): Stripe.Checkout.SessionCreateParams.Locale {
  if (locale === "fr") return "fr";
  if (locale === "en") return "en";
  return "auto";
}

export type CreateIntlSessionInput = {
  orderId: string;
  eurCents: number; // calculé serveur (taux maison) — JAMAIS depuis le client
  description: string;
  locale: string;
  paypalEnabled: boolean;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
};

/** Crée la session Stripe Checkout (page hébergée — Apple Pay / Google Pay
 *  automatiques sur carte). Expire à 31 min : la réservation de plafond
 *  s'auto-libère (cf. intl_caps_usage, fenêtre 35 min). Le mode (test/live)
 *  est lu en base à CHAQUE appel — bascule super-admin à effet immédiat. */
export async function createIntlCheckoutSession(
  input: CreateIntlSessionInput
): Promise<{ id: string; url: string; livemode: boolean }> {
  const mode = await getStripeMode();
  const stripe = stripeFor(mode);
  const types: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
    input.paypalEnabled ? ["card", "paypal"] : ["card"];
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: types,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: input.eurCents,
          product_data: { name: input.description },
        },
      },
    ],
    payment_method_options: {
      card: { request_three_d_secure: "any" },
    },
    locale: stripeLocale(input.locale),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    metadata: input.metadata,
  });
  if (!session.url) {
    throw new Error("Stripe n'a pas renvoyé d'URL de paiement.");
  }
  return { id: session.id, url: session.url, livemode: mode === "live" };
}

export type CreateIntlIntentInput = {
  orderId: string;
  eurCents: number; // calculé serveur (taux maison) — JAMAIS depuis le client
  description: string;
  metadata: Record<string, string>;
};

/** Crée un PaymentIntent pour le PAIEMENT EMBARQUÉ (Payment Element dans la
 *  page — carte + Apple Pay + Google Pay via automatic_payment_methods).
 *  3DS FORCÉ. Le client ne reçoit que le client_secret (fait pour ça) ; le
 *  webhook payment_intent.succeeded reste la seule source de vérité. */
export async function createIntlPaymentIntent(
  input: CreateIntlIntentInput
): Promise<{ id: string; clientSecret: string; livemode: boolean }> {
  const mode = await getStripeMode();
  const stripe = stripeFor(mode);
  const intent = await stripe.paymentIntents.create({
    amount: input.eurCents,
    currency: "eur",
    description: input.description,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    payment_method_options: {
      card: { request_three_d_secure: "any" },
    },
    metadata: input.metadata,
  });
  if (!intent.client_secret) {
    throw new Error("Stripe n'a pas renvoyé de client_secret.");
  }
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    livemode: mode === "live",
  };
}

/**
 * Détails NON SENSIBLES de la carte ayant payé un PaymentIntent — marque,
 * 4 derniers chiffres et portefeuille (Apple Pay / Google Pay), pour que le
 * client retrouve « par quelle carte ai-je payé ? » dans son historique.
 *
 * Le payload du webhook ne porte que `latest_charge` sous forme d'ID : on
 * re-interroge Stripe en l'expandant. Jamais de PAN ni de token réutilisable —
 * seulement ce qui est affichable. Ne throw pas : un détail manquant ne doit
 * jamais faire échouer un webhook de paiement.
 */
export async function fetchCardDetails(paymentIntentId: string): Promise<{
  brand: string | null;
  last4: string | null;
  wallet: string | null;
} | null> {
  try {
    const mode = await getStripeMode();
    const stripe = stripeFor(mode);
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge = pi.latest_charge as Stripe.Charge | null;
    const card = charge?.payment_method_details?.card;
    if (!card) return null;
    return {
      brand: card.brand ?? null,
      last4: card.last4 ?? null,
      wallet: card.wallet?.type ?? null,
    };
  } catch (err) {
    console.warn("[stripe] détails carte indisponibles:", err);
    return null;
  }
}

/** Vérifie la signature du webhook et parse l'événement. Un webhook peut
 *  provenir de l'environnement TEST ou LIVE (events test encore en file après
 *  une bascule) : on essaie CHAQUE secret configuré — une signature ne valide
 *  que contre le secret de son environnement, aucune perte de sécurité.
 *  Throw si aucun ne valide. */
export function constructStripeEvent(
  rawBody: string,
  signatureHeader: string | null
): Stripe.Event {
  if (!signatureHeader) {
    throw new Error("En-tête stripe-signature absent.");
  }
  const candidates = [
    process.env.STRIPE_LIVE_WEBHOOK_SECRET,
    process.env.STRIPE_TEST_WEBHOOK_SECRET,
  ].filter((s): s is string => !!s && s.length >= 10);
  if (candidates.length === 0) {
    throw new Error(
      "Aucun STRIPE_*_WEBHOOK_SECRET configuré — webhook refusé."
    );
  }
  // constructEvent n'a besoin que du secret → n'importe quel client fait
  // l'affaire ; on en construit un sans lire le mode en base (chemin webhook).
  const anyKey =
    process.env.STRIPE_TEST_SECRET_KEY ?? process.env.STRIPE_LIVE_SECRET_KEY;
  if (!anyKey) throw new Error("Aucune clé Stripe configurée.");
  const stripe = new Stripe(anyKey);
  let lastErr: unknown = null;
  for (const secret of candidates) {
    try {
      return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Signature webhook Stripe invalide.");
}
