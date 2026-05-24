// =============================================================================
// Webhook Chargily Pay v2 — POST /api/chargily/webhook
// =============================================================================
// ⚠️ CRITIQUE — règles non négociables (cf. PARTIE A du prompt 18) :
//   1. Vérification de signature OBLIGATOIRE (HMAC-SHA256). Sinon n'importe
//      qui pourrait marquer une commande comme payée.
//   2. Idempotency : Chargily peut renvoyer le même event plusieurs fois. On
//      ne traite la transition payment_status -> 'paid' qu'une seule fois (la
//      mise à jour conditionnelle ".eq(payment_status, 'pending')" + le trigger
//      SQL nous protègent).
//   3. La confirmation de paiement vient UNIQUEMENT du webhook. La redirection
//      `success_url` est cosmétique (le client peut fermer son navigateur).
//   4. On répond 200 vite — toujours. Même en cas d'erreur métier on log et on
//      renvoie 200 pour éviter les retries Chargily inutiles (sauf erreur de
//      signature → 401, et erreur de body → 400).
//
// L'UPDATE de `orders.payment_status` doit se faire avec un client `service_role`
// (bypass RLS) car le webhook arrive sans session utilisateur Supabase.
// =============================================================================

import { NextResponse, type NextRequest } from "next/server";
import {
  verifyWebhookSignature,
  type ChargilyWebhookEvent,
} from "@/lib/payments/chargily";
import { extractFailureReason } from "@/lib/payments/failure-reason";
import { createAdminClient } from "@/lib/supabase/admin";

// Force le runtime Node (le helper utilise `node:crypto`) et évite tout cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. Body BRUT — la signature est calculée dessus, pas sur le JSON re-stringifié.
  const rawBody = await req.text();
  const signature = req.headers.get("signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  // 2. Parse du payload une fois la signature vérifiée.
  let event: ChargilyWebhookEvent;
  try {
    event = JSON.parse(rawBody) as ChargilyWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (event.entity !== "event" || !event.data) {
    return NextResponse.json({ error: "Unexpected payload." }, { status: 400 });
  }

  const meta = event.data.metadata ?? null;
  const type = (meta && typeof meta.type === "string" ? meta.type : null) as
    | "order"
    | "topup"
    | null;

  const admin = createAdminClient();

  // -------------------------------------------------------------------------
  // ÉTAPE A — paiement d'une commande (metadata.type === "order")
  // -------------------------------------------------------------------------
  if (type === "order") {
    const orderId =
      meta && typeof meta.order_id === "string" ? meta.order_id : null;
    if (!orderId) {
      return NextResponse.json(
        { error: "metadata.order_id manquant." },
        { status: 400 }
      );
    }

    if (event.type === "checkout.paid") {
      const { data: updated, error } = await admin
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", orderId)
        .eq("payment_status", "pending")
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("[chargily/webhook] order paid failed:", error);
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 200 }
        );
      }
      return NextResponse.json({
        ok: true,
        already_processed: updated === null,
      });
    }

    if (
      event.type === "checkout.failed" ||
      event.type === "checkout.canceled"
    ) {
      const reason = extractFailureReason(event);
      const { error } = await admin
        .from("orders")
        .update({
          payment_status: "failed",
          payment_failure_reason: reason,
        })
        .eq("id", orderId)
        .eq("payment_status", "pending");
      if (error) {
        console.error("[chargily/webhook] order failed update failed:", error);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, ignored: event.type });
  }

  // -------------------------------------------------------------------------
  // ÉTAPE B — recharge Coligo Pay (metadata.type === "topup")
  //
  // Idempotency : UNIQUE INDEX uq_cwe_chargily_checkout sur
  // customer_wallet_entries(chargily_checkout_id) → un même checkout ne peut
  // créditer qu'une seule fois. ON CONFLICT (chargily_checkout_id) absorbe
  // les rejeux de Chargily.
  // -------------------------------------------------------------------------
  if (type === "topup") {
    const customerId =
      meta && typeof meta.customer_id === "string" ? meta.customer_id : null;
    if (!customerId) {
      return NextResponse.json(
        { error: "metadata.customer_id manquant." },
        { status: 400 }
      );
    }
    const checkoutId = event.data.id;
    if (!checkoutId) {
      return NextResponse.json(
        { error: "checkout id manquant." },
        { status: 400 }
      );
    }

    if (event.type === "checkout.paid") {
      // Montant : on prend l'amount confirmé par Chargily (source de vérité),
      // pas la valeur de metadata (modifiable par l'utilisateur).
      const amount = Math.round(event.data.amount);
      if (amount <= 0) {
        return NextResponse.json(
          { error: "Montant invalide." },
          { status: 400 }
        );
      }

      // INSERT direct via service_role (bypass RLS). L'idempotency est
      // garantie par l'UNIQUE INDEX partiel sur chargily_checkout_id :
      // un rejeu Chargily renvoie 23505, qu'on absorbe silencieusement.
      // On caste le `from` (Insert: never) car la table interdit l'INSERT
      // côté client RLS — mais en service_role on peut insérer.
      const { error: insertErr } = await (
        admin.from("customer_wallet_entries") as unknown as {
          insert: (row: {
            customer_id: string;
            order_id: null;
            type: "topup_credit";
            source: "topup";
            amount_da: number;
            chargily_checkout_id: string;
            note: string;
          }) => Promise<{ error: { code?: string; message: string } | null }>;
        }
      ).insert({
        customer_id: customerId,
        order_id: null,
        type: "topup_credit",
        source: "topup",
        amount_da: amount,
        chargily_checkout_id: checkoutId,
        note: `Recharge Coligo Pay via Chargily Pay (${checkoutId}).`,
      });

      if (insertErr && insertErr.code !== "23505") {
        console.error("[chargily/webhook] topup insert failed:", insertErr);
        return NextResponse.json(
          { ok: false, error: insertErr.message },
          { status: 200 }
        );
      }
      return NextResponse.json({
        ok: true,
        already_processed: insertErr?.code === "23505",
      });
    }

    // checkout.failed / checkout.canceled sur un topup → on ne fait rien
    // (aucune écriture, le client n'a jamais été crédité).
    return NextResponse.json({ ok: true });
  }

  // Type inconnu ou absent : on accepte pour éviter les retries.
  return NextResponse.json({ ok: true, skipped: true });
}
