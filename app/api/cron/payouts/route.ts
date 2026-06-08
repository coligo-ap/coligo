import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * CRON — Versements programmés au commerçant (auto hebdo / mensuel).
 *
 * Appelé quotidiennement par Vercel Cron (cf. vercel.json). La RPC
 * `generate_scheduled_payouts` décide elle-même qui est dû (cadence + dernière
 * date) et crée des `payout_request` (status 'pending') — aucun argent n'est
 * déplacé ici, l'admin exécute le virement réel ensuite.
 *
 * Sécurité : Vercel Cron envoie « Authorization: Bearer <CRON_SECRET> » quand la
 * variable CRON_SECRET est définie. On refuse tout appel sans ce jeton.
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
  const { data, error } = await rpc("generate_scheduled_payouts", {
    p_min_da: 1000,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { created?: number; total_da?: number }
    | undefined;
  return NextResponse.json({
    ok: true,
    created: row?.created ?? 0,
    total_da: row?.total_da ?? 0,
  });
}
