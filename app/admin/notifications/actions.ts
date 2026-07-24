"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { sendFcm, sendFcmToTopic } from "@/lib/fcm/send";
import { wilayaTopic, isValidWilaya } from "@/lib/marketing/geo-topics";

/**
 * Diffusion push libre du super-admin : titre + message + lien, vers un ou
 * plusieurs types d'utilisateurs (clients / livreurs / commerçants /
 * chauffeurs). Envoie à TOUS les appareils enregistrés (natif Android + web)
 * des rôles cochés — `sendFcm` purge lui-même les tokens périmés.
 */

const ROLES = ["customer", "courier", "merchant", "chauffeur"] as const;
type Role = (typeof ROLES)[number];

export type BroadcastState = {
  error?: string;
  ok?: boolean;
  sent?: number;
  devices?: number;
  /** Wilaya ciblée par TOPIC marketing (le nb d'appareils est géré par FCM). */
  zone?: string;
};

export async function sendBroadcastPush(
  _prev: BroadcastState,
  formData: FormData
): Promise<BroadcastState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };

  const roles = ROLES.filter((r) => formData.get(`role_${r}`) === "on");
  const wilaya = String(formData.get("wilaya") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const route = String(formData.get("route") ?? "").trim();

  if (roles.length === 0 && !wilaya)
    return { error: "Choisis au moins un type d'utilisateur ou une wilaya." };
  if (wilaya && !isValidWilaya(wilaya))
    return { error: "Wilaya invalide (code 1 à 58)." };
  if (!title) return { error: "Le titre est requis." };
  if (title.length > 80) return { error: "Titre trop long (80 max)." };
  if (!body) return { error: "Le message est requis." };
  if (body.length > 300) return { error: "Message trop long (300 max)." };
  if (route && !route.startsWith("/"))
    return {
      error: "Le lien doit être un chemin interne commençant par « / ».",
    };

  let sent = 0;
  let devices = 0;
  let zone: string | undefined;

  // MARKETING par ZONE (topic FCM `promo_wilaya_XX`) → atteint TOUS les appareils
  // abonnés à cette wilaya, y compris DÉCONNECTÉS. C'est le canal « promos des
  // commerçants proches » indépendant de la session.
  if (wilaya) {
    const r = await sendFcmToTopic(
      wilayaTopic(wilaya),
      { title, body },
      { route: route || "/" }
    );
    if (!r.ok)
      return { error: "Envoi à la zone échoué (vérifie la config FCM)." };
    zone = String(Number(wilaya)).padStart(2, "0");
  }

  // Ciblage PERSONNEL par rôle (tokens device_tokens, utilisateurs connus).
  if (roles.length > 0) {
    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("device_tokens")
      .select("token")
      .in("role", roles as unknown as Role[]);
    if (error) return { error: error.message };
    // Un même appareil peut porter plusieurs rôles → dédoublonne les tokens.
    const tokens = [...new Set((rows ?? []).map((r) => r.token))];
    if (tokens.length === 0 && !zone)
      return { error: "Aucun appareil enregistré pour cette sélection." };
    if (tokens.length > 0) {
      const result = await sendFcm(
        tokens,
        { title, body },
        { route: route || "/" }
      );
      sent = result.ok;
      devices = tokens.length;
    }
  }

  return { ok: true, sent, devices, zone };
}
