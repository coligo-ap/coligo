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

  return NextResponse.json({
    ok: true,
    subs_expired: expiredRows.length,
    frozen: frozenRows.length,
    stale_rides: staleRow?.expired_rides ?? 0,
    stale_offers: staleRow?.expired_offers ?? 0,
  });
}
