// =============================================================================
// Broadcast Realtime CÔTÉ SERVEUR (dispatch push)
// =============================================================================
// Émet des messages `broadcast` Supabase Realtime depuis le serveur SANS ouvrir
// de WebSocket : on POST sur l'API HTTP Realtime avec la clé service_role. Sert
// le DISPATCH CIBLÉ — au lieu d'abonner chaque chauffeur à TOUS les INSERT de
// `rides` (O(courses × chauffeurs), insoutenable), le serveur pousse la demande
// UNIQUEMENT aux chauffeurs éligibles, chacun sur SON canal personnel.
//
// Convention de canal : `chauffeur:{userId}` — canal PRIVÉ (Realtime
// Authorization, mig 0254 : policy SELECT sur realtime.messages → seul le
// propriétaire du topic s'abonne). Un seul canal par partenaire, MULTIPLEXÉ par
// `event` (new_ride, ride_taken…). L'émission part en `private: true`.
//
// Fire-and-forget : ne THROW jamais (le dispatch ne doit pas casser la création
// de course). L'API accepte jusqu'à des lots de messages — on chunk par sûreté.
// =============================================================================

const ENDPOINT_PATH = "/realtime/v1/api/broadcast";
const MAX_PER_BATCH = 100;

type BroadcastMessage = {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  /** false = canal PUBLIC (ex. panier partagé : le token EST la capacité). */
  private?: boolean;
};

/** Découpe un tableau en lots de taille `size`. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Envoie une liste de messages broadcast. Best-effort : log + return en cas
 * d'échec, jamais d'exception remontée à l'appelant.
 */
async function sendBroadcast(messages: BroadcastMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[realtime] broadcast: env Supabase manquant");
    return;
  }
  const endpoint = `${url}${ENDPOINT_PATH}`;
  for (const batch of chunk(messages, MAX_PER_BATCH)) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        // `private: true` → canal PRIVÉ (Realtime Authorization, mig 0254) :
        // seul le partenaire propriétaire du topic peut s'abonner/recevoir. Le
        // service_role bypass la RLS à l'émission.
        body: JSON.stringify({
          messages: batch.map((m) => ({ ...m, private: m.private ?? true })),
        }),
      });
      if (!res.ok && res.status !== 202) {
        console.warn(
          `[realtime] broadcast HTTP ${res.status}: ${await res.text().catch(() => "")}`
        );
      }
    } catch (err) {
      console.warn("[realtime] broadcast failed:", err);
    }
  }
}

/**
 * Pousse un même évènement à plusieurs chauffeurs (un message par canal perso).
 * @param userIds  user_id (auth) des chauffeurs destinataires.
 * @param event    nom de l'évènement multiplexé (ex. "new_ride", "ride_taken").
 * @param payload  charge utile (ex. { rideId }).
 */
export async function broadcastToChauffeurs(
  userIds: string[],
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  await sendBroadcast(
    unique.map((uid) => ({ topic: `chauffeur:${uid}`, event, payload }))
  );
}

/** Nom de canal personnel d'un chauffeur (à réutiliser côté client). */
export function chauffeurChannel(userId: string): string {
  return `chauffeur:${userId}`;
}

/**
 * Idem pour les LIVREURS (Express) : canal perso `courier:{userId}`. Remplace
 * l'abonnement global aux INSERT/UPDATE de `orders` (delivery_mode=express),
 * qui réveillait TOUS les livreurs en ligne à chaque commande (O(commandes ×
 * livreurs)). Le serveur ne pousse `new_express` qu'aux livreurs proches.
 */
export async function broadcastToCouriers(
  userIds: string[],
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  await sendBroadcast(
    unique.map((uid) => ({ topic: `courier:${uid}`, event, payload }))
  );
}

/** Nom de canal personnel d'un livreur (à réutiliser côté client). */
export function courierChannel(userId: string): string {
  return `courier:${userId}`;
}

/**
 * PANIER PARTAGÉ — signal « quelque chose a changé » sur un canal PUBLIC
 * `shared-cart:{token}` (les invités n'ont pas de compte ; le token du lien
 * EST la capacité d'accès). Payload SANS AUCUNE donnée : les clients
 * re-fetchent via la RPC token-validée `shared_cart_by_token`.
 */
export async function broadcastSharedCartBump(
  shareToken: string
): Promise<void> {
  await sendBroadcast([
    {
      topic: sharedCartChannel(shareToken),
      event: "bump",
      payload: { at: Date.now() },
      private: false,
    },
  ]);
}

/** Nom du canal public d'un panier partagé (à réutiliser côté client). */
export function sharedCartChannel(shareToken: string): string {
  return `shared-cart:${shareToken}`;
}

/**
 * ANNONCES ADMIN — pop-up « instantanée » (mig 0408) : signal PUBLIC par rôle
 * (`announcements:{role}`) sans AUCUNE donnée — chaque host re-fetch via la
 * RPC `my_announcements` qui refait le ciblage côté serveur. Sert aussi à
 * faire DISPARAÎTRE immédiatement une annonce désactivée.
 */
export async function broadcastAnnouncements(
  audiences: string[]
): Promise<void> {
  const unique = [...new Set(audiences.filter(Boolean))];
  if (unique.length === 0) return;
  await sendBroadcast(
    unique.map((role) => ({
      topic: announcementsChannel(role),
      event: "bump",
      payload: { at: Date.now() },
      private: false,
    }))
  );
}

/** Nom du canal public des annonces d'un rôle (à réutiliser côté client). */
export function announcementsChannel(role: string): string {
  return `announcements:${role}`;
}
