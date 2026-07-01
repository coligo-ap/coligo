import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * CRON — Auto-refus des commandes « À confirmer » non acceptées à temps (D-1).
 *
 * Balayage GLOBAL (tous commerçants) de catch-all, QUOTIDIEN (plan Hobby Vercel
 * = cron quotidien max). Le temps réel de l'auto-refus « 15 min » est assuré par
 * le POLL GATÉ du board commerçant pour le commerçant ACTIF (mig 0244,
 * `expire_my_stale_pending_orders`). Ce cron quotidien n'est que le filet pour
 * les commerçants ABSENTS, afin qu'une commande online payée jamais acceptée
 * finisse par être annulée + remboursée (au pire dans la journée).
 *
 * La RPC `expire_stale_pending_orders` décide elle-même quoi expirer (seuil
 * `pending_auto_cancel_min`, commandes immédiates uniquement) et rembourse
 * (carte → Coligo Pay + re-crédit cashback/topup par triggers).
 *
 * Sécurité : Vercel Cron envoie « Authorization: Bearer <CRON_SECRET> ».
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  // 1) Auto-refus des commandes VISIBLES (cash / online payée) non acceptées
  //    (mig 0244) — filet pour les commerçants absents.
  const { data, error } = await rpc("expire_stale_pending_orders", {
    p_merchant_id: null,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { expired?: number }
    | undefined;

  // 2) Annulation des commandes ONLINE non payées qui traînent (mig 0295) —
  //    filet INDÉPENDANT de l'event `checkout.expired` de Chargily (pas
  //    toujours reçu → la commande resterait `pending` pour toujours, occupant
  //    un créneau et gelant le cashback/Coligo Pay réservé). Re-crédit auto par
  //    les triggers de contre-passation.
  const { data: unpaidData, error: unpaidErr } = await rpc(
    "expire_unpaid_online_orders",
    { p_max_age_min: 60 }
  );
  if (unpaidErr) {
    console.error("[cron/expire-orders] unpaid online:", unpaidErr.message);
  }
  const unpaidRow = (Array.isArray(unpaidData) ? unpaidData[0] : unpaidData) as
    | { expired?: number }
    | undefined;

  return NextResponse.json({
    ok: true,
    expired: row?.expired ?? 0,
    unpaidOnlineExpired: unpaidRow?.expired ?? 0,
  });
}
