import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { isValidContactPhone } from "@/lib/dz/phone";

/**
 * Ce qu'il faut faire APRÈS une connexion sociale réussie, quelle qu'en soit la
 * porte d'entrée.
 *
 * Deux portes existent : la route `/auth/callback` (flux navigateur, code PKCE)
 * et l'action serveur `signInWithGoogleNative` (Sign-In Google natif dans
 * l'APK). Elles doivent provisionner le profil de la MÊME façon — sinon un
 * client créé par l'app n'aurait pas la même ligne `customers` qu'un client créé
 * sur le web, et la garde « téléphone obligatoire » du middleware divergerait.
 *
 * Renvoie le CHEMIN vers lequel rediriger. Ne redirige pas elle-même : la route
 * répond par un `NextResponse.redirect`, l'action serveur par `redirect()`.
 */
export async function provisionSocialUser(
  supabase: SupabaseClient<Database>,
  next: string
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/se-connecter?error=oauth";

  // Commerçant connecté via social → espace commerçant, pas de profil client.
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (merchant) return "/dashboard";

  // Provisionne le profil client au 1er login social.
  const { data: customer } = await supabase
    .from("customers")
    .select("id, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  let phone = customer?.phone ?? null;
  if (!customer) {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const fullName = String(
      meta.full_name || meta.name || user.email?.split("@")[0] || "Client"
    ).slice(0, 80);
    await supabase.from("customers").insert({
      user_id: user.id,
      full_name: fullName,
      email: user.email ?? null,
      phone: null,
    });
    phone = null;
  }

  // Sans numéro valide (obligatoire) → page de saisie BLOQUANTE. Le middleware
  // applique la même règle sur toutes les pages (filet de sécurité).
  if (!isValidContactPhone(phone)) {
    return next !== "/"
      ? `/compte/telephone?next=${encodeURIComponent(next)}`
      : "/compte/telephone";
  }

  return next;
}

/** Filtre `next` : uniquement des chemins internes. Évite un open redirect. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
