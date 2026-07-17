import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runFraudTick } from "@/lib/fraud/tick";

/**
 * CRON — Anti-fraude QUOTIDIEN (mig 0373-0374, docs/ANTI-FRAUDE.md).
 *
 * `fraud_daily()` : rafraîchit les statistiques de POPULATION (z-scores),
 * RÉ-ÉVALUE tous les acteurs connus/actifs (décroissance temporelle + poids
 * appris depuis les verdicts admin), purge la rétention (événements > 180 j,
 * historique > 1 an). Puis un `fraud_tick()` immédiat balaye les présences
 * muettes et ENVOIE les notifications en attente (cloche + push).
 *
 * Le temps réel n'attend PAS ce cron : le sweep tourne en piggyback des
 * chemins chauds (heartbeats livreur/chauffeur, ping télémétrie, annulations).
 *
 * Sécurité : Vercel Cron envoie « Authorization: Bearer <CRON_SECRET> ».
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  const { data, error } = await rpc("fraud_daily");
  if (error) {
    console.error("[cron/fraud] fraud_daily error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tick = await runFraudTick();
  return NextResponse.json({ ok: true, daily: data ?? null, tick });
}
