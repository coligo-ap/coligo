// =============================================================================
// Webhook Stripe — POST /api/stripe/webhook (paiements internationaux EUR)
// =============================================================================
// ⚠️ CRITIQUE — mêmes règles non négociables que le webhook Chargily :
//   1. Signature vérifiée par la lib officielle (constructEvent). Un échec est
//      TRACÉ (admin_audit_log → alerte super-admin 'intl_webhook_sig_fail',
//      possible tentative d'usurpation) et répond 400.
//   2. Idempotence : toutes les transitions sont CONDITIONNELLES
//      (.eq(payment_status,'pending') / .eq(status,'created')) — un rejeu
//      Stripe est sans effet. La table intl_payment_events garde chaque
//      événement (audit brut), doublons absorbés (23505).
//   3. La confirmation de paiement vient UNIQUEMENT d'ici. Défense en
//      profondeur : le montant confirmé par Stripe doit être EXACTEMENT
//      l'eur_cents de la session enregistrée à la création (elle-même calculée
//      serveur au taux maison) ET la devise 'eur'. Un écart = event croisé ou
//      anormal → on ne marque PAS payé, on trace.
//   4. Client payé sur une commande morte (annulée entre-temps) → recrédité
//      en DA (total_da de la session) sur son Coligo Pay, jamais débité sans
//      contrepartie — même filet que Chargily, même alerte à réconcilier.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { constructStripeEvent } from "@/lib/payments/stripe";
import { auditIntl } from "@/lib/payments/intl";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyMerchantNewOrder, notifyDriversTour } from "@/lib/fcm/triggers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntlSessionRow = {
  id: string;
  order_id: string;
  customer_id: string;
  eur_cents: number;
  total_da: number;
  status: string;
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  const admin = createAdminClient();

  // 1. Signature (lib officielle : HMAC + tolérance d'horodatage anti-rejeu).
  let event: Stripe.Event;
  try {
    event = constructStripeEvent(rawBody, signature);
  } catch (e) {
    await auditIntl(
      admin,
      "intl_webhook_sig_fail",
      e instanceof Error ? e.message : "signature invalide"
    );
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Helpers de cast (tables intl_* absentes des types générés).
  const sessions = admin.from("intl_payment_sessions" as never) as unknown as {
    select: (cols: string) => {
      eq: (
        c: string,
        v: unknown
      ) => {
        maybeSingle: () => Promise<{ data: IntlSessionRow | null }>;
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
  const recordEvent = async (sessionId: string | null) => {
    try {
      await (
        admin.from("intl_payment_events" as never) as unknown as {
          insert: (row: Record<string, unknown>) => Promise<{
            error: { code?: string; message: string } | null;
          }>;
        }
      ).insert({
        stripe_event_id: event.id,
        type: event.type,
        session_id: sessionId,
        payload: event.data.object as unknown,
      });
    } catch {
      /* audit best-effort — jamais bloquant */
    }
  };

  // -------------------------------------------------------------------------
  // payment_intent.succeeded — paiement EMBARQUÉ confirmé (Payment Element).
  // Même logique que checkout.session.completed, session retrouvée par
  // stripe_payment_intent (index unique 0378).
  // -------------------------------------------------------------------------
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;

    // ── Course Drive (metadata.type === "ride") — miroir du flux Chargily :
    // séquestre via drive_card_paid (idempotent) puis DIFFUSION aux
    // chauffeurs. Montant vérifié contre la session (EUR figé serveur).
    if (pi.metadata?.type === "ride") {
      const rideId =
        typeof pi.metadata.ride_id === "string" ? pi.metadata.ride_id : null;
      const { data: rideSess } = await (
        admin.from("intl_payment_sessions" as never) as unknown as {
          select: (cols: string) => {
            eq: (
              c: string,
              v: unknown
            ) => {
              maybeSingle: () => Promise<{
                data: {
                  id: string;
                  ride_id: string | null;
                  eur_cents: number;
                  total_da: number;
                } | null;
              }>;
            };
          };
        }
      )
        .select("id, ride_id, eur_cents, total_da")
        .eq("stripe_payment_intent", pi.id)
        .maybeSingle();
      if (!rideSess || !rideId || rideSess.ride_id !== rideId) {
        await auditIntl(
          admin,
          "intl_session_mismatch",
          `payment_intent.succeeded (ride) sur intent inconnu ou croisé (${pi.id}).`
        );
        await recordEvent(null);
        return NextResponse.json({ ok: true, unknown_intent: true });
      }
      if (pi.currency !== "eur" || pi.amount !== rideSess.eur_cents) {
        await auditIntl(
          admin,
          "intl_amount_mismatch",
          `Intent ride ${pi.id} : payé ${pi.amount} ${pi.currency} ≠ attendu ${rideSess.eur_cents} c€.`,
          rideSess.id
        );
        await recordEvent(rideSess.id);
        return NextResponse.json({ ok: false, amount_mismatch: true });
      }
      await sessions
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("stripe_payment_intent", pi.id)
        .eq("status", "created");

      const rpc = admin.rpc.bind(admin) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      // Montant DA de la course = total_da FIGÉ dans la session (le taux a
      // servi uniquement à facturer l'EUR — le ledger Drive reste en DA).
      const { data, error } = await rpc("drive_card_paid", {
        p_ride_id: rideId,
        p_amount_da: rideSess.total_da,
        p_checkout_id: pi.id,
      });
      if (error) {
        console.error("[stripe/webhook] ride paid failed:", error);
        await recordEvent(rideSess.id);
        // 500 → Stripe réessaie (RPC idempotente, rejeu sans danger).
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }
      const row = (Array.isArray(data) ? data[0] : data) as {
        ok?: boolean;
        refunded?: boolean;
      };
      if (row?.ok && !row.refunded) {
        const { notifyChauffeursNewRide } = await import("@/lib/fcm/triggers");
        void notifyChauffeursNewRide({ rideId });
        void rpc("drive_demo_respond", { p_ride_id: rideId });
      }
      await recordEvent(rideSess.id);
      return NextResponse.json({ ok: true });
    }

    // ── Course Drive : paiement À L'ACCEPTATION (metadata.type ===
    // "ride_offer", mig 0386). Finalise l'acceptation au prix EXACT convenu.
    if (pi.metadata?.type === "ride_offer") {
      const offerId =
        typeof pi.metadata.offer_id === "string" ? pi.metadata.offer_id : null;
      const { data: offSess } = await (
        admin.from("intl_payment_sessions" as never) as unknown as {
          select: (cols: string) => {
            eq: (
              c: string,
              v: unknown
            ) => {
              maybeSingle: () => Promise<{
                data: {
                  id: string;
                  offer_id: string | null;
                  eur_cents: number;
                  total_da: number;
                } | null;
              }>;
            };
          };
        }
      )
        .select("id, offer_id, eur_cents, total_da")
        .eq("stripe_payment_intent", pi.id)
        .maybeSingle();
      if (!offSess || !offerId || offSess.offer_id !== offerId) {
        await auditIntl(
          admin,
          "intl_session_mismatch",
          `payment_intent.succeeded (ride_offer) sur intent inconnu ou croisé (${pi.id}).`
        );
        await recordEvent(null);
        return NextResponse.json({ ok: true, unknown_intent: true });
      }
      if (pi.currency !== "eur" || pi.amount !== offSess.eur_cents) {
        await auditIntl(
          admin,
          "intl_amount_mismatch",
          `Intent ride_offer ${pi.id} : payé ${pi.amount} ${pi.currency} ≠ attendu ${offSess.eur_cents} c€.`,
          offSess.id
        );
        await recordEvent(offSess.id);
        return NextResponse.json({ ok: false, amount_mismatch: true });
      }
      await sessions
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("stripe_payment_intent", pi.id)
        .eq("status", "created");
      const rpc = admin.rpc.bind(admin) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { data, error } = await rpc("drive_card_accept_reserved", {
        p_offer_id: offerId,
        p_amount_da: offSess.total_da,
        p_checkout_id: pi.id,
      });
      if (error) {
        console.error("[stripe/webhook] ride_offer accept failed:", error);
        await recordEvent(offSess.id);
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }
      const row = (Array.isArray(data) ? data[0] : data) as {
        ok?: boolean;
        ride_id?: string;
      };
      if (row?.ok && row.ride_id) {
        const [
          { notifyChauffeursRideGone, notifyChauffeurRideWon },
          { notifyRideEvent },
        ] = await Promise.all([
          import("@/lib/fcm/triggers"),
          import("@/lib/notifications/notify"),
        ]);
        void notifyRideEvent(row.ride_id, "ride_accepted");
        void notifyChauffeurRideWon({ rideId: row.ride_id });
        void notifyChauffeursRideGone({ rideId: row.ride_id });
      }
      await recordEvent(offSess.id);
      return NextResponse.json({ ok: true });
    }

    // ── Recharge portefeuille Coligo Pay par carte € (type "op_topup_intl",
    // mig 0389) : crédit via credit_operator_topup_chargily (idempotent sur
    // l'id du paiement).
    if (pi.metadata?.type === "op_topup_intl") {
      const walletId =
        typeof pi.metadata.wallet_id === "string"
          ? pi.metadata.wallet_id
          : null;
      const { data: wSess } = await (
        admin.from("intl_payment_sessions" as never) as unknown as {
          select: (cols: string) => {
            eq: (
              c: string,
              v: unknown
            ) => {
              maybeSingle: () => Promise<{
                data: {
                  id: string;
                  operator_wallet_id: string | null;
                  eur_cents: number;
                  total_da: number;
                } | null;
              }>;
            };
          };
        }
      )
        .select("id, operator_wallet_id, eur_cents, total_da")
        .eq("stripe_payment_intent", pi.id)
        .maybeSingle();
      if (!wSess || !walletId || wSess.operator_wallet_id !== walletId) {
        await auditIntl(
          admin,
          "intl_session_mismatch",
          `payment_intent.succeeded (op_topup_intl) intent inconnu ou croisé (${pi.id}).`
        );
        await recordEvent(null);
        return NextResponse.json({ ok: true, unknown_intent: true });
      }
      if (pi.currency !== "eur" || pi.amount !== wSess.eur_cents) {
        await auditIntl(
          admin,
          "intl_amount_mismatch",
          `Intent op_topup_intl ${pi.id} : payé ${pi.amount} ≠ ${wSess.eur_cents} c€.`,
          wSess.id
        );
        await recordEvent(wSess.id);
        return NextResponse.json({ ok: false, amount_mismatch: true });
      }
      await sessions
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("stripe_payment_intent", pi.id)
        .eq("status", "created");
      const rpc = admin.rpc.bind(admin) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { error } = await rpc("credit_operator_topup_chargily", {
        p_wallet_id: walletId,
        p_amount_da: wSess.total_da,
        p_checkout_id: pi.id,
      });
      if (error) {
        console.error("[stripe/webhook] op_topup_intl credit failed:", error);
        await recordEvent(wSess.id);
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }
      await recordEvent(wSess.id);
      return NextResponse.json({ ok: true });
    }

    const orderId =
      typeof pi.metadata?.order_id === "string" ? pi.metadata.order_id : null;

    const { data: sess } = await sessions
      .select("id, order_id, customer_id, eur_cents, total_da, status")
      .eq("stripe_payment_intent", pi.id)
      .maybeSingle();
    if (!sess || !orderId || sess.order_id !== orderId) {
      console.error("[stripe/webhook] intent inconnu/croisé", pi.id, orderId);
      await auditIntl(
        admin,
        "intl_session_mismatch",
        `payment_intent.succeeded sur intent inconnu ou croisé (${pi.id}).`
      );
      await recordEvent(null);
      return NextResponse.json({ ok: true, unknown_intent: true });
    }

    // Défense en profondeur : montant + devise confirmés par Stripe.
    if (pi.currency !== "eur" || pi.amount !== sess.eur_cents) {
      console.error(
        `[stripe/webhook] montant/devise inattendus ${pi.id}: ` +
          `${pi.amount} ${pi.currency} attendu=${sess.eur_cents} eur`
      );
      await auditIntl(
        admin,
        "intl_amount_mismatch",
        `Intent ${pi.id} : payé ${pi.amount} ${pi.currency} ≠ attendu ${sess.eur_cents} c€.`,
        sess.id
      );
      await recordEvent(sess.id);
      return NextResponse.json({ ok: false, amount_mismatch: true });
    }

    await sessions
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("stripe_payment_intent", pi.id)
      .eq("status", "created");

    const { data: target } = await admin
      .from("orders")
      .select("total_da, status, payment_status, customer_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!target) {
      await recordEvent(sess.id);
      return NextResponse.json({ ok: true, unknown_order: true });
    }

    const { data: updated, error } = await admin
      .from("orders")
      .update({ payment_status: "paid" })
      .eq("id", orderId)
      .eq("payment_status", "pending")
      .select("id, merchant_id, customer_name, total_da")
      .maybeSingle();
    if (error) {
      console.error("[stripe/webhook] intent order paid failed:", error);
      await recordEvent(sess.id);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }
    if (updated) {
      void notifyMerchantNewOrder({
        merchantId: updated.merchant_id,
        orderId: updated.id,
        customerName: updated.customer_name,
        totalDa: updated.total_da,
      });
      void notifyDriversTour({ orderId: updated.id });
      await recordEvent(sess.id);
      return NextResponse.json({ ok: true });
    }

    // Transition refusée. Trois cas, JAMAIS un client débité sans
    // contrepartie :
    //   - rejeu du même événement (sess.status déjà 'paid') → rien ;
    //   - payé APRÈS annulation de la commande → recrédit Coligo Pay ;
    //   - DOUBLE DÉBIT (commande déjà payée par un AUTRE intent alors que
    //     cette session était encore 'created' — vieux onglet/feuille) →
    //     recrédit Coligo Pay du même montant + alerte réconciliation.
    // Idempotent via l'index unique (l'id de l'intent tient lieu de
    // checkout id).
    const afterCancel = target.payment_status !== "paid";
    // sess.status lu AVANT la transition : 'paid' = rejeu du payeur (rien) ;
    // tout autre statut ('created' OU 'expired' supersédée mais payée quand
    // même) = un VRAI second débit → compensation.
    const doubleCharge =
      target.payment_status === "paid" && sess.status !== "paid";
    if ((afterCancel || doubleCharge) && target.customer_id) {
      const noteText = doubleCharge
        ? `DOUBLE paiement Stripe (€) détecté sur la commande ${orderId} — second débit recrédité sur Coligo Pay.`
        : `Paiement Stripe (€) reçu APRÈS annulation de la commande ${orderId} — recrédité sur Coligo Pay.`;
      const { error: compErr } = await (
        admin.from("customer_wallet_entries") as unknown as {
          insert: (row: Record<string, unknown>) => Promise<{
            error: { code?: string; message: string } | null;
          }>;
        }
      ).insert({
        customer_id: target.customer_id,
        order_id: orderId,
        type: "topup_credit",
        source: "topup",
        amount_da: sess.total_da,
        chargily_checkout_id: pi.id,
        note: noteText,
      });
      if (compErr?.code !== "23505") {
        if (compErr) {
          console.error(
            "[stripe/webhook] compensation credit failed:",
            compErr.message
          );
        }
        await admin.from("admin_audit_log").insert({
          admin_email: "stripe",
          action: "paid_after_cancel",
          target_kind: "order",
          target_id: orderId,
          note:
            `${sess.eur_cents} c€ payés (Stripe, embarqué) ${doubleCharge ? "en DOUBLE" : "APRÈS annulation"} ` +
            `(status=${target.status}, payment_status=${target.payment_status}) → ` +
            (compErr
              ? "ÉCHEC du recrédit Coligo Pay — RÉCONCILIATION MANUELLE REQUISE."
              : `${sess.total_da} DA recrédités sur Coligo Pay du client.`),
        });
      }
    }
    await recordEvent(sess.id);
    return NextResponse.json({ ok: true, already_processed: true });
  }

  // -------------------------------------------------------------------------
  // payment_intent.payment_failed — échec d'une tentative sur la feuille
  // embarquée. RIEN à annuler : le client est toujours devant le Payment
  // Element et peut réessayer avec une autre carte (la session reste
  // 'created' ; le filet d'expiration des commandes online pending fait le
  // ménage si le client abandonne). On trace seulement.
  // -------------------------------------------------------------------------
  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const { data: sess } = await sessions
      .select("id, order_id, customer_id, eur_cents, total_da, status")
      .eq("stripe_payment_intent", pi.id)
      .maybeSingle();
    await recordEvent(sess?.id ?? null);
    return NextResponse.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // payment_intent.canceled — intent annulé (jamais payé) : même traitement
  // que checkout.session.expired.
  // -------------------------------------------------------------------------
  if (event.type === "payment_intent.canceled") {
    const pi = event.data.object as Stripe.PaymentIntent;

    // Course Drive jamais payée → même traitement que Chargily failed :
    // drive_card_failed ramène le client au choix de gamme (mig 0163).
    // ⚠️ SUPERSESSION : si la session n'était PLUS 'created' (remplacée par
    // un nouvel intent — la course va être payée autrement), on n'annule
    // RIEN : cet événement ne fait que confirmer l'annulation du vieil
    // intent chez Stripe.
    if (pi.metadata?.type === "ride") {
      const rideId =
        typeof pi.metadata.ride_id === "string" ? pi.metadata.ride_id : null;
      const { data: rideSess } = await (
        admin.from("intl_payment_sessions" as never) as unknown as {
          select: (cols: string) => {
            eq: (
              c: string,
              v: unknown
            ) => {
              maybeSingle: () => Promise<{
                data: { id: string; status: string } | null;
              }>;
            };
          };
        }
      )
        .select("id, status")
        .eq("stripe_payment_intent", pi.id)
        .maybeSingle();
      const wasLive = rideSess?.status === "created";
      await sessions
        .update({ status: "expired" })
        .eq("stripe_payment_intent", pi.id)
        .eq("status", "created");
      if (rideId && wasLive) {
        const rpc = admin.rpc.bind(admin) as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ error: { message: string } | null }>;
        const { error } = await rpc("drive_card_failed", {
          p_ride_id: rideId,
        });
        if (error) {
          console.error("[stripe/webhook] ride card failed:", error.message);
        }
      }
      await recordEvent(rideSess?.id ?? null);
      return NextResponse.json({ ok: true });
    }

    // Paiement À L'ACCEPTATION échoué/annulé → on relâche la réservation
    // (course toujours en recherche, offre re-disponible). Aucune course
    // n'est annulée : « comme si rien n'était » (mig 0386).
    if (pi.metadata?.type === "ride_offer") {
      const offerId =
        typeof pi.metadata.offer_id === "string" ? pi.metadata.offer_id : null;
      const { data: offSess } = await (
        admin.from("intl_payment_sessions" as never) as unknown as {
          select: (cols: string) => {
            eq: (
              c: string,
              v: unknown
            ) => {
              maybeSingle: () => Promise<{
                data: { id: string; status: string } | null;
              }>;
            };
          };
        }
      )
        .select("id, status")
        .eq("stripe_payment_intent", pi.id)
        .maybeSingle();
      const wasLive = offSess?.status === "created";
      await sessions
        .update({ status: "expired" })
        .eq("stripe_payment_intent", pi.id)
        .eq("status", "created");
      if (offerId && wasLive) {
        const rpc = admin.rpc.bind(admin) as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ error: { message: string } | null }>;
        const { error } = await rpc("drive_card_release_offer", {
          p_offer_id: offerId,
        });
        if (error)
          console.error("[stripe/webhook] ride_offer release:", error.message);
      }
      await recordEvent(offSess?.id ?? null);
      return NextResponse.json({ ok: true });
    }

    // Recharge portefeuille € échouée/annulée → session expirée, aucun crédit.
    if (pi.metadata?.type === "op_topup_intl") {
      await sessions
        .update({ status: "expired" })
        .eq("stripe_payment_intent", pi.id)
        .eq("status", "created");
      await recordEvent(null);
      return NextResponse.json({ ok: true });
    }

    const { data: sess } = await sessions
      .select("id, order_id, customer_id, eur_cents, total_da, status")
      .eq("stripe_payment_intent", pi.id)
      .maybeSingle();
    // ⚠️ SUPERSESSION : session déjà sortie de 'created' (remplacée par un
    // nouvel intent, ou déjà traitée) → on n'annule PAS la commande — le
    // client est peut-être en train de la payer sur la nouvelle feuille.
    if (sess && sess.status === "created") {
      await sessions
        .update({ status: "expired" })
        .eq("stripe_payment_intent", pi.id)
        .eq("status", "created");
      const { error } = await admin
        .from("orders")
        .update({
          status: "cancelled",
          payment_status: "failed",
          payment_failure_reason: "Paiement en euros annulé (non complété).",
        })
        .eq("id", sess.order_id)
        .eq("payment_status", "pending");
      if (error) {
        console.error("[stripe/webhook] intent cancel failed:", error);
      }
    }
    await recordEvent(sess?.id ?? null);
    return NextResponse.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // checkout.session.completed — paiement confirmé
  // -------------------------------------------------------------------------
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const orderId =
      typeof s.metadata?.order_id === "string" ? s.metadata.order_id : null;

    const { data: sess } = await sessions
      .select("id, order_id, customer_id, eur_cents, total_da, status")
      .eq("stripe_session_id", s.id)
      .maybeSingle();
    if (!sess || !orderId || sess.order_id !== orderId) {
      console.error("[stripe/webhook] session inconnue/croisée", s.id, orderId);
      await auditIntl(
        admin,
        "intl_session_mismatch",
        `checkout.session.completed sur session inconnue ou croisée (${s.id}).`
      );
      await recordEvent(null);
      return NextResponse.json({ ok: true, unknown_session: true });
    }

    // Défense en profondeur : montant + devise + statut Stripe.
    if (
      s.currency !== "eur" ||
      s.amount_total !== sess.eur_cents ||
      s.payment_status !== "paid"
    ) {
      console.error(
        `[stripe/webhook] montant/devise inattendus ${s.id}: ` +
          `${s.amount_total} ${s.currency} (${s.payment_status}) attendu=${sess.eur_cents} eur`
      );
      await auditIntl(
        admin,
        "intl_amount_mismatch",
        `Session ${s.id} : payé ${s.amount_total} ${s.currency} ≠ attendu ${sess.eur_cents} c€.`,
        sess.id
      );
      await recordEvent(sess.id);
      return NextResponse.json({ ok: false, amount_mismatch: true });
    }

    // Session created → paid (conditionnel = idempotent).
    await sessions
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        stripe_payment_intent:
          typeof s.payment_intent === "string" ? s.payment_intent : null,
      })
      .eq("stripe_session_id", s.id)
      .eq("status", "created");

    // Commande pending → paid — MÊME transition que Chargily : c'est ici que
    // la commande devient visible/effective pour le commerçant (RLS 0068).
    const { data: target } = await admin
      .from("orders")
      .select("total_da, status, payment_status, customer_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!target) {
      await recordEvent(sess.id);
      return NextResponse.json({ ok: true, unknown_order: true });
    }

    const { data: updated, error } = await admin
      .from("orders")
      .update({ payment_status: "paid" })
      .eq("id", orderId)
      .eq("payment_status", "pending")
      .select("id, merchant_id, customer_name, total_da")
      .maybeSingle();
    if (error) {
      console.error("[stripe/webhook] order paid failed:", error);
      await recordEvent(sess.id);
      // 500 : paiement réel confirmé, erreur forcément transitoire → Stripe
      // réessaie ; les transitions conditionnelles rendent le rejeu sûr.
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }
    if (updated) {
      void notifyMerchantNewOrder({
        merchantId: updated.merchant_id,
        orderId: updated.id,
        customerName: updated.customer_name,
        totalDa: updated.total_da,
      });
      void notifyDriversTour({ orderId: updated.id });
      await recordEvent(sess.id);
      return NextResponse.json({ ok: true });
    }

    // Transition refusée : déjà payée (rejeu) OU commande annulée entre-temps
    // alors que le client vient de payer en EUR → FILET : recrédit du montant
    // DA de la session sur son Coligo Pay (idempotent via l'index unique sur
    // chargily_checkout_id — on y range l'id de session Stripe, même filet).
    if (target.payment_status !== "paid" && target.customer_id) {
      const { error: compErr } = await (
        admin.from("customer_wallet_entries") as unknown as {
          insert: (row: Record<string, unknown>) => Promise<{
            error: { code?: string; message: string } | null;
          }>;
        }
      ).insert({
        customer_id: target.customer_id,
        order_id: orderId,
        type: "topup_credit",
        source: "topup",
        amount_da: sess.total_da,
        chargily_checkout_id: s.id,
        note: `Paiement Stripe (€) reçu APRÈS annulation de la commande ${orderId} — recrédité sur Coligo Pay.`,
      });
      if (compErr?.code !== "23505") {
        if (compErr) {
          console.error(
            "[stripe/webhook] compensation credit failed:",
            compErr.message
          );
        }
        await admin.from("admin_audit_log").insert({
          admin_email: "stripe",
          action: "paid_after_cancel",
          target_kind: "order",
          target_id: orderId,
          note:
            `${sess.eur_cents} c€ payés (Stripe) APRÈS annulation ` +
            `(status=${target.status}, payment_status=${target.payment_status}) → ` +
            (compErr
              ? "ÉCHEC du recrédit Coligo Pay — RÉCONCILIATION MANUELLE REQUISE."
              : `${sess.total_da} DA recrédités sur Coligo Pay du client.`),
        });
      }
    }
    await recordEvent(sess.id);
    return NextResponse.json({ ok: true, already_processed: true });
  }

  // -------------------------------------------------------------------------
  // checkout.session.expired — client parti sans payer (31 min)
  // -------------------------------------------------------------------------
  if (event.type === "checkout.session.expired") {
    const s = event.data.object as Stripe.Checkout.Session;
    const { data: sess } = await sessions
      .select("id, order_id, customer_id, eur_cents, total_da, status")
      .eq("stripe_session_id", s.id)
      .maybeSingle();
    if (sess) {
      await sessions
        .update({ status: "expired" })
        .eq("stripe_session_id", s.id)
        .eq("status", "created");
      // Même traitement que Chargily failed/expired : la commande jamais payée
      // est annulée (libère créneau + re-crédite cashback/Coligo Pay réservés
      // via triggers) ; le panier client reste intact côté navigateur.
      const { error } = await admin
        .from("orders")
        .update({
          status: "cancelled",
          payment_status: "failed",
          payment_failure_reason: "Paiement en euros expiré (non complété).",
        })
        .eq("id", sess.order_id)
        .eq("payment_status", "pending");
      if (error) {
        console.error("[stripe/webhook] order cancel failed:", error);
      }
    }
    await recordEvent(sess?.id ?? null);
    return NextResponse.json({ ok: true });
  }

  // -------------------------------------------------------------------------
  // charge.refunded — remboursement (déclenché depuis le Dashboard/admin) :
  // trace + statut session ; le sort de la COMMANDE reste une décision humaine
  // (l'alerte finances pointe l'admin dessus).
  // -------------------------------------------------------------------------
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const pi =
      typeof charge.payment_intent === "string" ? charge.payment_intent : null;
    if (pi) {
      try {
        await (
          admin.from("intl_payment_sessions" as never) as unknown as {
            update: (row: Record<string, unknown>) => {
              eq: (
                c: string,
                v: unknown
              ) => Promise<{ error: { message: string } | null }>;
            };
          }
        )
          .update({ status: "refunded" })
          .eq("stripe_payment_intent", pi);
      } catch (e) {
        console.error("[stripe/webhook] refund mark failed:", e);
      }
      await auditIntl(
        admin,
        "intl_refunded",
        `Remboursement Stripe reçu (payment_intent ${pi}) — vérifier le sort de la commande.`
      );
    }
    await recordEvent(null);
    return NextResponse.json({ ok: true });
  }

  // Autres événements : acquittés sans traitement (pas de retries inutiles).
  await recordEvent(null);
  return NextResponse.json({ ok: true, skipped: event.type });
}
