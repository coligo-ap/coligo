// =============================================================================
// Broadcast Realtime CÔTÉ SERVEUR (dispatch push)
// =============================================================================
// Émet des messages `broadcast` Supabase Realtime depuis le serveur SANS ouvrir
// de WebSocket : on POST sur l'API HTTP Realtime avec la clé service_role. Sert
// le DISPATCH CIBLÉ — au lieu d'abonner chaque chauffeur à TOUS les INSERT de
// `rides` (O(courses × chauffeurs), insoutenable), le serveur pousse la demande
// UNIQUEMENT aux chauffeurs éligibles, chacun sur SON canal personnel.
//
// Convention de canal : `chauffeur:{userId}` (UUID auth = difficile à deviner ;
// le durcissement RLS « canal privé » via realtime.messages viendra ensuite).
// Un seul canal par chauffeur, MULTIPLEXÉ par `event` (new_ride, ride_taken…).
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
        // `private: false` → canal public (topic en UUID, non énumérable).
        body: JSON.stringify({
          messages: batch.map((m) => ({ ...m, private: false })),
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
