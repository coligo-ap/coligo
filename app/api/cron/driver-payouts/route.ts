import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * CRON — Règlement livreur (driver-settlement-run).
 *
 * Appelé quotidiennement par Vercel Cron (cf. vercel.json, 07:00). Selon le
 * cycle configuré (`platform_settings.driver_settlement_cycle`), calcule les
 * bornes de la DERNIÈRE période complète puis appelle la RPC
 * `generate_driver_statements(period_start, period_end)` qui agrège, crée un
 * relevé immuable par livreur (`driver_statements`) et marque les écritures
 * `delivery_ledger` correspondantes comme réglées (settled_at).
 *
 * Idempotent : UNIQUE (driver_id, period_start, period_end) + on ne traite que
 * les écritures non réglées → un appel quotidien ne double JAMAIS un relevé.
 * Aucun argent n'est déplacé ici : l'admin/le livreur exécute le virement réel
 * (CCP / BaridiMob) ensuite selon le sens du solde.
 *
 * Sécurité : Bearer CRON_SECRET (comme /api/cron/payouts).
 */
export const dynamic = "force-dynamic";

/** Format YYYY-MM-DD en UTC (les bornes de période sont des DATE). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Bornes (incluses) de la dernière période COMPLÈTE.
 *  - weekly  : lundi → dimanche de la semaine précédente.
 *  - monthly : 1er → dernier jour du mois précédent.
 */
function lastCompletePeriod(cycle: "weekly" | "monthly"): {
  start: string;
  end: string;
} {
  const now = new Date();
  if (cycle === "monthly") {
    const firstOfThisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    );
    const end = new Date(firstOfThisMonth.getTime() - 86_400_000); // dernier jour mois préc.
    const start = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)
    );
    return { start: ymd(start), end: ymd(end) };
  }
  // weekly — ISO (lundi = début de semaine).
  const day = now.getUTCDay(); // 0=dim … 6=sam
  const isoDow = day === 0 ? 7 : day; // 1=lun … 7=dim
  const mondayThisWeek = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      (isoDow - 1) * 86_400_000
  );
  const end = new Date(mondayThisWeek.getTime() - 86_400_000); // dimanche préc.
  const start = new Date(end.getTime() - 6 * 86_400_000); // lundi préc.
  return { start: ymd(start), end: ymd(end) };
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

  // Cycle configuré (défaut weekly).
  const { data: settings } = (await admin
    .from("platform_settings")
    .select("driver_settlement_cycle")
    .eq("id", true)
    .single()) as { data: { driver_settlement_cycle?: string } | null };
  const cycle =
    settings?.driver_settlement_cycle === "monthly" ? "monthly" : "weekly";

  // Sur weekly on ne génère QUE le lundi (fin de la semaine précédente) ;
  // sur monthly QUE le 1er du mois. Les autres jours : no-op (le cron quotidien
  // reste idempotent, mais on évite des appels inutiles).
  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const isFirstOfMonth = now.getUTCDate() === 1;
  if (cycle === "weekly" && !isMonday) {
    return NextResponse.json({ ok: true, skipped: "not settlement day" });
  }
  if (cycle === "monthly" && !isFirstOfMonth) {
    return NextResponse.json({ ok: true, skipped: "not settlement day" });
  }

  const { start, end } = lastCompletePeriod(cycle);
  const { data, error } = await rpc("generate_driver_statements", {
    p_period_start: start,
    p_period_end: end,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { statements_created?: number; drivers_total?: number }
    | undefined;
  return NextResponse.json({
    ok: true,
    cycle,
    period: { start, end },
    created: row?.statements_created ?? 0,
    drivers: row?.drivers_total ?? 0,
  });
}
