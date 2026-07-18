// =============================================================================
// Garde-fous du rail € — ANTI-DOUBLE-PAIEMENT + FILET D'EXPIRATION
// =============================================================================
// Un PaymentIntent Stripe n'expire JAMAIS tout seul (contrairement à une page
// Chargily, 30 min). Deux trous à fermer :
//   1. SUPERSÉDER : re-soumettre une commande/course crée un NOUVEL intent —
//      l'ancien restait confirmable pour toujours (double débit possible
//      depuis une vieille feuille/onglet). Avant chaque nouvel intent, les
//      sessions 'created' de la MÊME cible sont marquées 'expired' PUIS leur
//      intent est annulé chez Stripe. L'ordre compte : le webhook
//      payment_intent.canceled n'annule la cible QUE si la session était
//      encore 'created' — une session supersédée n'annule donc rien.
//   2. BALAYER : une session 'created' > 35 min (client parti, app tuée) est
//      abandonnée — on annule l'intent chez Stripe et le webhook fait le
//      ménage complet (commande annulée / course drive_card_failed), comme
//      checkout.session.expired le faisait sur le flux hébergé. Repli direct
//      en base si Stripe est injoignable. Déclenché de façon OPPORTUNISTE à
//      chaque nouveau paiement € + cron quotidien de sécurité.
// =============================================================================

import "server-only";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { auditIntl } from "@/lib/payments/intl";

type Admin = ReturnType<typeof createAdminClient>;

/** Annule un PaymentIntent — on tente les DEUX environnements (un intent
 *  n'existe que dans le sien ; l'autre renvoie une erreur qu'on ignore).
 *  true = annulé (ou déjà annulé) quelque part. */
export async function cancelStripeIntent(intentId: string): Promise<boolean> {
  const keys = [
    process.env.STRIPE_LIVE_SECRET_KEY,
    process.env.STRIPE_TEST_SECRET_KEY,
  ].filter((k): k is string => !!k);
  for (const key of keys) {
    try {
      await new Stripe(key).paymentIntents.cancel(intentId);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // Déjà annulé / déjà finalisé = objectif atteint dans cet environnement.
      if (/canceled|already|succeeded/i.test(msg)) return true;
      /* mauvais environnement ou réseau → clé suivante */
    }
  }
  return false;
}

type StaleSession = {
  id: string;
  stripe_payment_intent: string | null;
  order_id: string | null;
  ride_id: string | null;
};

function sessionsTbl(admin: Admin) {
  return admin.from("intl_payment_sessions" as never) as unknown as {
    select: (cols: string) => {
      eq: (
        c: string,
        v: unknown
      ) => {
        eq: (
          c2: string,
          v2: unknown
        ) => Promise<{ data: StaleSession[] | null }>;
      };
      lt: (
        c: string,
        v: string
      ) => {
        eq: (
          c2: string,
          v2: unknown
        ) => Promise<{ data: StaleSession[] | null }>;
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (
        c: string,
        v: unknown
      ) => {
        eq: (
          c2: string,
          v2: unknown
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Avant de créer un NOUVEL intent pour cette cible : neutralise les sessions
 * 'created' précédentes (marquage 'expired' PUIS annulation Stripe — jamais
 * l'inverse, sinon le webhook annulerait la cible qu'on s'apprête à payer).
 */
export async function supersedeStaleSessions(
  admin: Admin,
  target: { orderId?: string; rideId?: string }
): Promise<void> {
  const col = target.orderId ? "order_id" : "ride_id";
  const val = target.orderId ?? target.rideId;
  if (!val) return;
  try {
    const { data } = await sessionsTbl(admin)
      .select("id, stripe_payment_intent, order_id, ride_id")
      .eq(col, val)
      .eq("status", "created");
    for (const s of data ?? []) {
      await sessionsTbl(admin)
        .update({ status: "expired" })
        .eq("id", s.id)
        .eq("status", "created");
      if (s.stripe_payment_intent) {
        await cancelStripeIntent(s.stripe_payment_intent);
      }
    }
  } catch (e) {
    console.error("[intl-guard] supersede failed:", e);
  }
}

/**
 * FILET D'EXPIRATION global : sessions 'created' > 35 min → annulation de
 * l'intent chez Stripe (le webhook payment_intent.canceled fait alors le
 * ménage complet : commande annulée + soldes re-crédités, ou course
 * drive_card_failed). Si Stripe est injoignable, repli DIRECT en base pour ne
 * jamais laisser une cible zombie. Borné (20/lot), best-effort, idempotent.
 */
export async function sweepStaleIntlSessions(): Promise<number> {
  const admin = createAdminClient();
  let cleaned = 0;
  try {
    const cutoff = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    const { data } = await (
      admin.from("intl_payment_sessions" as never) as unknown as {
        select: (cols: string) => {
          eq: (
            c: string,
            v: unknown
          ) => {
            lt: (
              c2: string,
              v2: string
            ) => {
              limit: (n: number) => Promise<{ data: StaleSession[] | null }>;
            };
          };
        };
      }
    )
      .select("id, stripe_payment_intent, order_id, ride_id")
      .eq("status", "created")
      .lt("created_at", cutoff)
      .limit(20);

    for (const s of data ?? []) {
      const cancelled = s.stripe_payment_intent
        ? await cancelStripeIntent(s.stripe_payment_intent)
        : false;
      if (cancelled) {
        // Le webhook payment_intent.canceled fera le ménage (session +
        // cible). On compte et on passe.
        cleaned += 1;
        continue;
      }
      // Stripe injoignable / intent introuvable → repli DIRECT en base.
      await sessionsTbl(admin)
        .update({ status: "expired" })
        .eq("id", s.id)
        .eq("status", "created");
      if (s.order_id) {
        await admin
          .from("orders")
          .update({
            status: "cancelled",
            payment_status: "failed",
            payment_failure_reason: "Paiement en euros expiré (non complété).",
          })
          .eq("id", s.order_id)
          .eq("payment_status", "pending");
      }
      if (s.ride_id) {
        const rpc = admin.rpc.bind(admin) as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ error: { message: string } | null }>;
        await rpc("drive_card_failed", { p_ride_id: s.ride_id });
      }
      cleaned += 1;
    }
    if (cleaned > 0) {
      await auditIntl(
        admin,
        "intl_sweep",
        `${cleaned} session(s) € abandonnée(s) expirée(s) par le filet.`
      );
    }
  } catch (e) {
    console.error("[intl-guard] sweep failed:", e);
  }
  return cleaned;
}
