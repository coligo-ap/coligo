import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * CRON — Auto-refus des commandes « À confirmer » non acceptées à temps (D-1).
 *
 * Balayage GLOBAL (tous commerçants) de catch-all : le board commerçant applique
 * déjà l'auto-refus en poll gaté pour le commerçant ACTIF (mig 0244,
 * `expire_my_stale_pending_orders`). Ce cron couvre les commerçants ABSENTS pour
 * qu'une commande online payée jamais acceptée finisse par être remboursée.
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
  const { data, error } = await rpc("expire_stale_pending_orders", {
    p_merchant_id: null,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { expired?: number }
    | undefined;
  return NextResponse.json({ ok: true, expired: row?.expired ?? 0 });
}
