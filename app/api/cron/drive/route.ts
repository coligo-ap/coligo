import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFcm } from "@/lib/fcm/send";

/**
 * CRON — Coligo Drive (quotidien) :
 *  1. drive_sub_expire_job  : abonnement impayé à l'échéance (+ grâce) →
 *     retour automatique au plan Gratuit + notification FCM au chauffeur ;
 *  2. drive_freeze_job      : GEL automatique (dette > seuil, annulations
 *     répétées, note trop basse — seuils en config admin) + notification ;
 *  3. drive_expire_stale    : demandes/propositions expirées (TTL) retirées.
 *
 * Sécurité : « Authorization: Bearer <CRON_SECRET> » exigé.
 */
export const dynamic = "force-dynamic";

async function tokensFor(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("device_tokens")
    .select("token")
    .eq("user_id", userId)
    .eq("role", "chauffeur");
  return (data ?? []).map((r) => r.token).filter(Boolean);
}

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

  // 1. Retour au plan Gratuit (échéance impayée).
  const { data: expired } = await rpc("drive_sub_expire_job", {});
  const expiredRows =
    (expired as { chauffeur_user_id: string | null; plan: string }[] | null) ??
    [];
  for (const row of expiredRows) {
    if (!row.chauffeur_user_id) continue;
    const tokens = await tokensFor(row.chauffeur_user_id);
    if (tokens.length === 0) continue;
    await sendFcm(
      tokens,
      {
        title: "Abonnement expiré",
        body: "Votre abonnement n'a pas été renouvelé — retour au plan Gratuit (8 %). Renouvelez quand vous voulez.",
      },
      { route: "/chauffeur/abonnement", kind: "drive_sub_expired" }
    );
  }

  // 2. Gel automatique (motifs maquette, seuils en config).
  const { data: frozen } = await rpc("drive_freeze_job", {});
  const frozenRows =
    (frozen as
      | { chauffeur_user_id: string | null; freeze_reason: string }[]
      | null) ?? [];
  for (const row of frozenRows) {
    if (!row.chauffeur_user_id) continue;
    const tokens = await tokensFor(row.chauffeur_user_id);
    if (tokens.length === 0) continue;
    await sendFcm(
      tokens,
      {
        title: "Compte gelé",
        body: `${row.freeze_reason}. Contactez le support Coligo.`,
      },
      { route: "/chauffeur", kind: "drive_frozen" }
    );
  }

  // 3. Nettoyage TTL.
  const { data: stale } = await rpc("drive_expire_stale", {});
  const staleRow = (Array.isArray(stale) ? stale[0] : stale) as
    | { expired_rides?: number; expired_offers?: number }
    | undefined;

  // 4. Filet de sécurité : courses programmées dues → diffusion (l'activation
  //    principale est déclenchée par le poll chauffeur, ceci est un backstop).
  const { data: activated } = await rpc("drive_activate_due_scheduled", {});
  const activatedRows = (activated as { ride_id: string }[] | null) ?? [];
  for (const row of activatedRows) {
    try {
      const { notifyChauffeursNewRide } = await import("@/lib/fcm/triggers");
      await notifyChauffeursNewRide({ rideId: row.ride_id });
    } catch {
      /* best-effort */
    }
  }

  // 5. Auto-calibrage du prix : recalcule le coef appris par zone × créneau
  //    depuis les signaux réels (expirations, boosts, prix acceptés).
  const { data: learned } = await rpc("drive_recompute_learning", {});
  const learnedCount = typeof learned === "number" ? learned : 0;

  // 6. Purge des courses FANTÔMES : annulées AVANT toute attribution (recherche
  //    abandonnée, TTL, carte échouée) → aucun chauffeur, aucun argent (escrow
  //    0/null, donc aucune écriture au grand livre). Elles sont déjà MASQUÉES de
  //    l'historique client ; on les supprime définitivement après 2 j pour ne
  //    pas encombrer la base. Les vraies courses (terminées / annulées AVEC
  //    chauffeur) sont conservées. CASCADE nettoie events/offers (simples logs).
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data: purged } = await admin
    .from("rides")
    .delete()
    .eq("status", "cancelled")
    .is("chauffeur_id", null)
    .or("escrow_da.eq.0,escrow_da.is.null")
    .lt("created_at", twoDaysAgo)
    .select("id");
  const phantomPurged = purged?.length ?? 0;

  return NextResponse.json({
    ok: true,
    subs_expired: expiredRows.length,
    frozen: frozenRows.length,
    stale_rides: staleRow?.expired_rides ?? 0,
    stale_offers: staleRow?.expired_offers ?? 0,
    scheduled_activated: activatedRows.length,
    learning_bands: learnedCount,
    phantom_purged: phantomPurged,
  });
}
