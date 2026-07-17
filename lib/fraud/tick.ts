/**
 * Sweep anti-fraude « fraud_tick » (mig 0374) — appelé en PIGGYBACK des chemins
 * chauds (heartbeats, pings télémétrie, annulations) + par le cron quotidien.
 *
 * Le SQL fait le travail (auto-déconnexions, file d'actions à notifier) et se
 * throttle LUI-MÊME (verrou advisory + intervalle minimal) ; ici on ajoute un
 * throttle in-process pour éviter même l'aller-retour réseau. Les notifications
 * retournées (avertissement, limitation, hors-ligne forcé, suspension…) sont
 * poussées via la cloche + FCM. Fire-and-forget : jamais de throw.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  storeAndPushNotification,
  type NotifAudience,
} from "@/lib/notifications/notify";

type TickNotification = {
  user_id: string;
  audience: NotifAudience;
  kind: string;
  title: string;
  body: string;
};

type TickResult = {
  ok?: boolean;
  skipped?: string;
  chauffeurs_offline?: number;
  drivers_closed?: number;
  notifications?: TickNotification[];
};

/** Route d'atterrissage de la notification, par espace. */
const AUDIENCE_ROUTE: Record<NotifAudience, string> = {
  customer: "/",
  driver: "/driver",
  chauffeur: "/chauffeur",
  merchant: "/merchant",
};

let lastTickAt = 0;

/** Lance le sweep si le dernier date d'au moins 60 s (par instance serverless). */
export async function maybeFraudTick(): Promise<void> {
  const now = Date.now();
  if (now - lastTickAt < 60_000) return;
  lastTickAt = now;
  await runFraudTick();
}

/** Lance le sweep sans throttle in-process (cron) et envoie les notifications. */
export async function runFraudTick(): Promise<TickResult | null> {
  try {
    const admin = createAdminClient();
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("fraud_tick");
    if (error) {
      console.warn("[fraud] tick rpc failed:", error.message);
      return null;
    }
    const res = (data ?? {}) as TickResult;
    const notifs = res.notifications ?? [];
    await Promise.all(
      notifs.map((n) =>
        storeAndPushNotification({
          userId: n.user_id,
          audience: n.audience,
          kind: n.kind,
          title: n.title,
          body: n.body,
          route: AUDIENCE_ROUTE[n.audience] ?? "/",
        })
      )
    );
    return res;
  } catch (err) {
    console.warn("[fraud] tick failed:", err);
    return null;
  }
}
