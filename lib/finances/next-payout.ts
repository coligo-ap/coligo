// =============================================================================
// Prochain versement automatique — calcul PUR (miroir de generate_scheduled_payouts).
// =============================================================================
// Le moteur (mig 0102) crée une payout_request quand la fenêtre est échue :
//   weekly  : last_auto_payout_at <= now − 7 j   (ou jamais versé)
//   monthly : last_auto_payout_at <= now − 30 j  (ou jamais versé)
// …à condition : pas gelé, coordonnées renseignées, disponible >= min (1000 DA).
// Le cron tourne TOUS LES JOURS à 06:00 UTC → le versement réel a lieu au
// prochain passage du cron à partir de la date d'échéance.
//
// Ce helper traduit ce moteur en UN message clair pour le commerçant.
// =============================================================================

export type NextPayoutInput = {
  payoutAuto: "none" | "weekly" | "monthly";
  lastAutoPayoutAt: string | null;
  method: string | null;
  details: string | null;
  isFrozen?: boolean | null;
  /** Solde disponible (après réservations) — summary.available. */
  available: number;
  minDa?: number;
};

export type NextPayout =
  | { kind: "manual" } // versement à la demande (auto désactivé)
  | { kind: "frozen" } // compte gelé → versements suspendus
  | { kind: "needs_setup"; cadence: "weekly" | "monthly" } // coordonnées manquantes
  | {
      // auto OK mais solde sous le minimum → on attend qu'il monte
      kind: "waiting_balance";
      cadence: "weekly" | "monthly";
      minDa: number;
      available: number;
    }
  | {
      // versement programmé : date concrète + montant estimé
      kind: "scheduled";
      cadence: "weekly" | "monthly";
      date: string; // ISO du passage du cron qui exécutera le versement
      available: number;
    };

const DAY_MS = 86_400_000;
const CRON_HOUR_UTC = 6; // vercel.json : "0 6 * * *"

/** Prochain passage quotidien du cron (06:00 UTC) à partir de `after` inclus. */
function nextCronRun(after: Date): Date {
  const run = new Date(
    Date.UTC(
      after.getUTCFullYear(),
      after.getUTCMonth(),
      after.getUTCDate(),
      CRON_HOUR_UTC,
      0,
      0,
      0
    )
  );
  if (run.getTime() < after.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}

export function computeNextPayout(
  i: NextPayoutInput,
  now: Date = new Date()
): NextPayout {
  if (i.payoutAuto === "none") return { kind: "manual" };
  if (i.isFrozen) return { kind: "frozen" };

  const cadence = i.payoutAuto;
  const hasCoords = !!i.method && !!i.details && i.details.trim().length > 0;
  if (!hasCoords) return { kind: "needs_setup", cadence };

  const minDa = i.minDa ?? 1000;

  // Date d'échéance de la fenêtre : last + intervalle, ou « maintenant » si
  // aucun versement auto n'a encore eu lieu (dû immédiatement).
  const intervalDays = cadence === "weekly" ? 7 : 30;
  const dueAt = i.lastAutoPayoutAt
    ? new Date(new Date(i.lastAutoPayoutAt).getTime() + intervalDays * DAY_MS)
    : now;
  // Le versement part au prochain passage du cron >= échéance.
  const runAt = nextCronRun(dueAt < now ? now : dueAt);

  if (i.available < minDa) {
    return { kind: "waiting_balance", cadence, minDa, available: i.available };
  }
  return {
    kind: "scheduled",
    cadence,
    date: runAt.toISOString(),
    available: i.available,
  };
}
