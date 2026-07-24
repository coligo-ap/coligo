import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type DeviceRole = "merchant" | "customer" | "courier" | "chauffeur";

/**
 * Supprime les tokens push de l'utilisateur COURANT pour ce rôle.
 *
 * À appeler dans les Server Actions de logout AVANT `signOut()` (la session est
 * encore valide pour identifier le user). Règle produit : un appareil DÉCONNECTÉ
 * ne doit PLUS recevoir les notifications PERSONNELLES (statut de commande,
 * course, messages, remboursements…) — tout l'envoi personnel cible
 * `device_tokens` par `user_id`. À la reconnexion, le token est réenregistré
 * automatiquement (PushRegistrar au montage du shell), donc l'opération est sans
 * perte durable.
 *
 * Suppression via service_role (comme l'upsert de /api/device-tokens). Portée :
 * tous les appareils de CE user pour CE rôle — filet fiable qui couvre TOUS les
 * chemins de logout (boutons ET formulaires). Best-effort : ne jamais empêcher
 * la déconnexion.
 */
export async function clearMyDeviceTokens(role: DeviceRole): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const admin = createAdminClient();
    await admin
      .from("device_tokens")
      .delete()
      .eq("user_id", user.id)
      .eq("role", role);
  } catch {
    /* best-effort — la déconnexion prime */
  }
}
