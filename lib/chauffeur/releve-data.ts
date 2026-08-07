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
  /** Tranches par mode de paiement — filtre client de « Gains et Relevés ».
   *  cash = espèces ; online = Coligo Pay + carte. */
  byMethod: {
    all: RideSlice;
    cash: RideSlice;
    online: RideSlice;
  };
  /** Ventilation COVOITURAGE de la période (mig 0443/0444) — les montants
   *  sont DÉJÀ inclus dans les totaux et tranches ci-dessus ; ceci sert la
   *  ligne « dont covoiturage » (écran Gains + PDF). */
  carpool: { tripsCount: number; seatsCount: number; netDa: number };
};

export type RideSlice = { count: number; netDa: number; coligoDa: number };

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
  // Tables carpool_* (0443) hors types générés → cast du `from` BINDÉ.
  const afrom = admin.from.bind(admin) as unknown as (t: string) => {
    select: (s: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        eq: (
          c: string,
          v: string
        ) => {
          gte: (
            c: string,
            v: string
          ) => {
            lt: (
              c: string,
              v: string
            ) => Promise<{ data: Record<string, unknown>[] | null }>;
          };
        };
      };
    };
  };
  const [{ data: rides }, { data: subs }, { data: cpTrips }] =
    await Promise.all([
      admin
        .from("rides")
        .select(
          "agreed_price_da, boost_amount_da, commission_da, chauffeur_net_da, payment_method"
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
      // Départs covoiturage CLÔTURÉS dans la période.
      afrom("carpool_trips")
        .select("id")
        .eq("chauffeur_id", chauffeurId)
        .eq("status", "completed")
        .gte("completed_at", period.from)
        .lt("completed_at", period.to),
    ]);

  // Réservations terminées + payouts du grand livre des départs de la période.
  const tripIds = ((cpTrips ?? []) as { id: string }[]).map((t) => t.id);
  let cpBookings: {
    id: string;
    amount_da: number;
    payment_method: string;
    seats: number;
  }[] = [];
  const cpPayout = new Map<string, number>();
  if (tripIds.length) {
    const infrom = admin.from.bind(admin) as unknown as (t: string) => {
      select: (s: string) => {
        in: (
          c: string,
          v: string[]
        ) => {
          eq: (
            c: string,
            v: string
          ) => Promise<{ data: Record<string, unknown>[] | null }>;
        };
      };
    };
    const [{ data: bks }, { data: led }] = await Promise.all([
      infrom("carpool_bookings")
        .select("id, amount_da, payment_method, seats")
        .in("trip_id", tripIds)
        .eq("status", "completed"),
      infrom("carpool_ledger")
        .select("booking_id, amount_da")
        .in("trip_id", tripIds)
        .eq("type", "chauffeur_payout"),
    ]);
    cpBookings = ((bks ?? []) as Record<string, unknown>[]).map((b) => ({
      id: b.id as string,
      amount_da: Number(b.amount_da ?? 0),
      payment_method: (b.payment_method as string) ?? "cash",
      seats: Number(b.seats ?? 0),
    }));
    for (const l of (led ?? []) as Record<string, unknown>[]) {
      cpPayout.set(l.booking_id as string, Number(l.amount_da ?? 0));
    }
  }

  type RideRow = {
    agreed_price_da: number | null;
    boost_amount_da: number | null;
    commission_da: number | null;
    chauffeur_net_da: number | null;
    payment_method: string | null;
  };
  const rows = (rides ?? []) as RideRow[];
  const gross = rows.reduce(
    (s, r) => s + (r.agreed_price_da ?? 0) + (r.boost_amount_da ?? 0),
    0
  );
  const commission = rows.reduce((s, r) => s + (r.commission_da ?? 0), 0);
  // Net d'une course = snapshot si présent, sinon brut − commission (courses
  // d'avant le snapshot net).
  const rideNet = (r: RideRow) =>
    r.chauffeur_net_da ??
    (r.agreed_price_da ?? 0) +
      (r.boost_amount_da ?? 0) -
      (r.commission_da ?? 0);
  const net = rows.reduce((s, r) => s + rideNet(r), 0);
  const subFees = ((subs ?? []) as { amount_da: number }[]).reduce(
    (s, p) => s + p.amount_da,
    0
  );

  // Tranches par mode de paiement (cash vs coligo_pay/card).
  const slice = (): RideSlice => ({ count: 0, netDa: 0, coligoDa: 0 });
  const byMethod = { all: slice(), cash: slice(), online: slice() };
  for (const r of rows) {
    const m =
      r.payment_method && r.payment_method !== "cash" ? "online" : "cash";
    byMethod[m].count += 1;
    byMethod[m].netDa += rideNet(r);
    byMethod[m].coligoDa += r.commission_da ?? 0;
  }

  // COVOITURAGE : chaque réservation terminée = 1 encaissement (net = payout
  // du grand livre, commission = montant − payout), fondu dans les tranches
  // ET les totaux — le relevé (écran + PDF) dit la vérité complète.
  let cpNet = 0;
  let cpGross = 0;
  let cpSeats = 0;
  for (const b of cpBookings) {
    const bNet = cpPayout.get(b.id) ?? b.amount_da;
    const bCom = b.amount_da - bNet;
    const m = b.payment_method !== "cash" ? "online" : "cash";
    byMethod[m].count += 1;
    byMethod[m].netDa += bNet;
    byMethod[m].coligoDa += bCom;
    cpNet += bNet;
    cpGross += b.amount_da;
    cpSeats += b.seats;
  }
  const totalCount = rows.length + cpBookings.length;
  const totalNet = net + cpNet;
  const totalCommission = commission + (cpGross - cpNet);
  byMethod.all = {
    count: totalCount,
    netDa: totalNet,
    coligoDa: totalCommission,
  };

  return {
    periodLabel: period.label,
    ridesCount: totalCount,
    grossDa: gross + cpGross,
    commissionDa: totalCommission,
    subFeesDa: subFees,
    netDa: totalNet,
    byMethod,
    carpool: { tripsCount: tripIds.length, seatsCount: cpSeats, netDa: cpNet },
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
