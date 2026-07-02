import { createAdminClient } from "@/lib/supabase/admin";
import type { SettlementPeriod } from "@/lib/driver/settlement-data";

/**
 * Données du RELEVÉ CHAUFFEUR par période — SOURCE UNIQUE partagée par la
 * page /chauffeur/releve et l'export PDF /api/pdf/releve-chauffeur. Sommes
 * des SNAPSHOTS figés sur les courses terminées de [from, to)
 * (agreed_price_da + boost, commission_da, chauffeur_net_da) + abonnements
 * payés dans la période. Lectures admin FILTRÉES sur l'id de session (même
 * pattern que getChauffeurFinances) ; défaut = mois courant.
 */

export type ChauffeurReleve = {
  periodLabel: string;
  ridesCount: number;
  grossDa: number;
  commissionDa: number;
  subFeesDa: number;
  netDa: number;
};

/** Mois courant (Alger ≈ UTC+1 sans DST — bornes UTC du mois civil local). */
export function currentMonthPeriod(): SettlementPeriod {
  const now = new Date(Date.now() + 3600_000); // UTC+1
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const MONTHS_FR = [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ];
  return {
    from: new Date(Date.UTC(y, m, 1)).toISOString(),
    to: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
    label: `${MONTHS_FR[m]} ${y}`,
  };
}

export async function getChauffeurReleve(
  chauffeurId: string,
  period: SettlementPeriod
): Promise<ChauffeurReleve> {
  const admin = createAdminClient();
  const [{ data: rides }, { data: subs }] = await Promise.all([
    admin
      .from("rides")
      .select(
        "agreed_price_da, boost_amount_da, commission_da, chauffeur_net_da"
      )
      .eq("chauffeur_id", chauffeurId)
      .eq("status", "completed")
      .gte("completed_at", period.from)
      .lt("completed_at", period.to),
    admin
      .from("chauffeur_subscription_payments")
      .select("amount_da, status, created_at")
      .eq("chauffeur_id", chauffeurId)
      // Statuts réels de la table : pending / approved / rejected.
      .eq("status", "approved")
      .gte("created_at", period.from)
      .lt("created_at", period.to),
  ]);

  type RideRow = {
    agreed_price_da: number | null;
    boost_amount_da: number | null;
    commission_da: number | null;
    chauffeur_net_da: number | null;
  };
  const rows = (rides ?? []) as RideRow[];
  const gross = rows.reduce(
    (s, r) => s + (r.agreed_price_da ?? 0) + (r.boost_amount_da ?? 0),
    0
  );
  const commission = rows.reduce((s, r) => s + (r.commission_da ?? 0), 0);
  // Net = snapshot si présent, sinon brut − commission (courses d'avant le
  // snapshot net).
  const net = rows.reduce(
    (s, r) =>
      s +
      (r.chauffeur_net_da ??
        (r.agreed_price_da ?? 0) +
          (r.boost_amount_da ?? 0) -
          (r.commission_da ?? 0)),
    0
  );
  const subFees = ((subs ?? []) as { amount_da: number }[]).reduce(
    (s, p) => s + p.amount_da,
    0
  );

  return {
    periodLabel: period.label,
    ridesCount: rows.length,
    grossDa: gross,
    commissionDa: commission,
    subFeesDa: subFees,
    netDa: net,
  };
}

/** Premier mois d'activité (courses terminées) — borne du sélecteur. */
export async function getChauffeurFirstActivityMonth(
  chauffeurId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("rides")
    .select("completed_at")
    .eq("chauffeur_id", chauffeurId)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.completed_at ? String(data.completed_at).slice(0, 7) : null;
}
