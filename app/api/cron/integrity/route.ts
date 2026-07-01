import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * CRON — Audit d'intégrité QUOTIDIEN (surveillance façon Uber).
 *
 * Appelle la fonction SQL `integrity_violations()` (mig 0298) — source UNIQUE des
 * invariants financiers/d'état (gating paiement, soldes non négatifs, double-
 * entrée SUM=0, cohérence). Elle ne renvoie que les invariants VIOLÉS (0 ligne =
 * base saine). En cas de violation :
 *   • log BRUYANT (Vercel logs) pour l'ops ;
 *   • trace dans admin_audit_log (action='integrity_violation') → remontée en
 *     ALERTE super-admin (mig 0299, domaine Confiance).
 * Répond toujours 200 (avec le détail) sauf secret invalide / erreur RPC.
 *
 * Sécurité : Vercel Cron envoie « Authorization: Bearer <CRON_SECRET> ».
 */
export const dynamic = "force-dynamic";

type Violation = {
  code: string;
  severity: string;
  cnt: number;
  detail: string;
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  const { data, error } = await rpc("integrity_violations");
  if (error) {
    console.error("[cron/integrity] rpc error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as Violation[] | null) ?? [];
  if (rows.length > 0) {
    // Ops : log immédiat + exploitable dans les logs Vercel.
    console.error(
      "[cron/integrity] 🚨 VIOLATIONS D'INTÉGRITÉ :",
      JSON.stringify(rows)
    );
    // Trace → alerte super-admin (une ligne par run en anomalie ; l'alerte
    // (mig 0299, fenêtre courte) s'efface d'elle-même dès que la base redevient
    // saine — le prochain run quotidien n'écrit alors plus rien).
    const summary = rows.map((r) => `${r.code}×${r.cnt}`).join(", ");
    await admin.from("admin_audit_log").insert({
      admin_email: "system",
      action: "integrity_violation",
      target_kind: "integrity",
      target_id: null,
      note: summary.slice(0, 500),
    });
  }

  return NextResponse.json({
    ok: true,
    healthy: rows.length === 0,
    violations: rows,
  });
}
