"use server";

// =============================================================================
// Portail super-admin — connexion dédiée (NON publique).
// =============================================================================
// Distincte de la connexion commerçant (/login) : on n'accepte QUE les comptes
// présents dans platform_admins (vérif via is_super_admin). Un compte valide
// mais non super-admin est immédiatement déconnecté → aucun accès au portail.
// =============================================================================

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { markSignedOut } from "@/lib/auth/mark-signed-out";
import { loginSchema, firstZodError } from "@/lib/validation/auth";
import {
  rateHit,
  logSecurityEvent,
  formatRetryDelay,
} from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request-context";

export type PortalState = { error?: string };

export async function adminLogin(
  _prev: PortalState,
  formData: FormData
): Promise<PortalState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const { email, password } = parsed.data;

  // Anti-abus (mig 0452) — portail super-admin : plafonds plus STRICTS que les
  // espaces publics ; le verrou par compte compte TOUT échec (peek avant
  // tentative, hit après échec).
  const loginIp = await getClientIp();
  const emailLc = email.toLowerCase();
  const ipGate = await rateHit("login_ip", `portail:${loginIp}`, 10, 600);
  if (!ipGate.allowed) {
    await logSecurityEvent("rate_limited", {
      bucket: "login_ip",
      subject: "portail",
      path: "/portail",
    });
    return {
      error: `Trop de tentatives. Réessayez dans ${formatRetryDelay(ipGate.retryAfterSeconds)}.`,
    };
  }
  const failGate = await rateHit("login_fail", `portail:${emailLc}`, 5, 900, 0);
  if (!failGate.allowed) {
    return {
      error: `Trop de tentatives pour ce compte. Réessayez dans ${formatRetryDelay(failGate.retryAfterSeconds)}.`,
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // CHAQUE échec (quel que soit le message) compte vers le verrou du compte.
    await rateHit("login_fail", `portail:${emailLc}`, 5, 900);
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Identifiants incorrects." };
    }
    if (error.message.includes("Email not confirmed")) {
      return { error: "Email non confirmé." };
    }
    return { error: error.message };
  }

  // Le compte DOIT être super-admin, sinon on referme la session ouverte.
  const { data: isAdmin } = await supabase.rpc("is_super_admin");
  if (isAdmin !== true) {
    await supabase.auth.signOut();
    await markSignedOut(); // purge cookies (la garde anti-course bloque la purge auto)
    return { error: "Accès réservé aux super-administrateurs." };
  }

  revalidatePath("/", "layout");
  // /admin gère ensuite le challenge MFA si la 2FA est activée.
  redirect("/admin");
}
