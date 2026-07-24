/**
 * Abonnement d'appareils aux TOPICS FCM via l'API Instance ID (IID).
 *
 * L'API d'envoi HTTP v1 ne gère PAS l'appartenance aux topics : elle se gère par
 * l'API IID `iid.googleapis.com/iid/v1:batchAdd|batchRemove`, autorisée par le
 * MÊME jeton OAuth2 (scope firebase.messaging) via l'en-tête `access_token_auth`.
 *
 * Usage : marketing géo — on abonne le token d'un appareil à `promo_wilaya_XX`
 * (voir lib/marketing/geo-topics), indépendamment de la session, pour que les
 * promos de zone atteignent même un utilisateur déconnecté. Best-effort.
 */

import { getFcmAccessToken } from "./send";

const IID_BATCH = "https://iid.googleapis.com/iid/v1";

async function batch(
  op: "batchAdd" | "batchRemove",
  tokens: string[],
  topic: string
): Promise<boolean> {
  const list = [...new Set(tokens.filter(Boolean))];
  if (list.length === 0) return true;
  const ctx = await getFcmAccessToken();
  if (!ctx) return false;
  try {
    const res = await fetch(`${IID_BATCH}:${op}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.accessToken}`,
        access_token_auth: "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: `/topics/${topic}`,
        registration_tokens: list,
      }),
    });
    if (!res.ok && process.env.NODE_ENV !== "production") {
      console.warn("[fcm topics]", op, topic, res.status);
    }
    return res.ok;
  } catch (err) {
    console.warn("[fcm topics] error:", err);
    return false;
  }
}

/** Abonne un/des token(s) à un topic (ex. après choix/détection de zone). */
export function subscribeTokensToTopic(
  tokens: string[],
  topic: string
): Promise<boolean> {
  return batch("batchAdd", tokens, topic);
}

/** Désabonne un/des token(s) d'un topic (changement de zone). */
export function unsubscribeTokensFromTopic(
  tokens: string[],
  topic: string
): Promise<boolean> {
  return batch("batchRemove", tokens, topic);
}
