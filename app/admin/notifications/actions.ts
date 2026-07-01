"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { sendFcm } from "@/lib/fcm/send";

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
};

export async function sendBroadcastPush(
  _prev: BroadcastState,
  formData: FormData
): Promise<BroadcastState> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };

  const roles = ROLES.filter((r) => formData.get(`role_${r}`) === "on");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const route = String(formData.get("route") ?? "").trim();

  if (roles.length === 0)
    return { error: "Choisis au moins un type d'utilisateur." };
  if (!title) return { error: "Le titre est requis." };
  if (title.length > 80) return { error: "Titre trop long (80 max)." };
  if (!body) return { error: "Le message est requis." };
  if (body.length > 300) return { error: "Message trop long (300 max)." };
  if (route && !route.startsWith("/"))
    return {
      error: "Le lien doit être un chemin interne commençant par « / ».",
    };

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("device_tokens")
    .select("token")
    .in("role", roles as unknown as Role[]);
  if (error) return { error: error.message };

  // Un même appareil peut porter plusieurs rôles → dédoublonne les tokens
  // pour ne pas notifier deux fois.
  const tokens = [...new Set((rows ?? []).map((r) => r.token))];
  if (tokens.length === 0)
    return { error: "Aucun appareil enregistré pour cette sélection." };

  const result = await sendFcm(
    tokens,
    { title, body },
    { route: route || "/" }
  );

  return { ok: true, sent: result.ok, devices: tokens.length };
}
