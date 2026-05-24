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

  // L'étape B (recharge) sera branchée plus tard. Pour l'instant on n'accepte
  // QUE le type "order" — un autre type renvoie 200 (pas de retry Chargily)
  // mais ne fait rien.
  if (type !== "order") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const orderId =
    meta && typeof meta.order_id === "string" ? meta.order_id : null;
  if (!orderId) {
    return NextResponse.json(
      { error: "metadata.order_id manquant." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // 3. Traitement par type d'event.
  if (event.type === "checkout.paid") {
    // UPDATE conditionnel — la transition vers 'paid' ne se fait que si on est
    // encore 'pending'. Si Chargily renvoie 10× le même event, seul le premier
    // fait fire le trigger SQL (qui de toute façon a son propre garde
    // ON CONFLICT (order_id, type) DO NOTHING sur les wallet_entries).
    const { data: updated, error } = await admin
      .from("orders")
      .update({ payment_status: "paid" })
      .eq("id", orderId)
      .eq("payment_status", "pending")
      .select("id")
      .maybeSingle();

    if (error) {
      // On log via la réponse — Chargily la reverra dans son dashboard.
      console.error("[chargily/webhook] update paid failed:", error);
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

  if (event.type === "checkout.failed" || event.type === "checkout.canceled") {
    // On marque 'failed' uniquement si la commande est encore 'pending'. Si
    // elle a déjà été payée (race condition improbable), on ne touche à rien.
    const { error } = await admin
      .from("orders")
      .update({ payment_status: "failed" })
      .eq("id", orderId)
      .eq("payment_status", "pending");
    if (error) {
      console.error("[chargily/webhook] update failed failed:", error);
    }
    return NextResponse.json({ ok: true });
  }

  // Event inconnu : on accepte pour éviter les retries, on n'agit pas.
  return NextResponse.json({ ok: true, ignored: event.type });
}
