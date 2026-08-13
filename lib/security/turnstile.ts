import "server-only";
import { logSecurityEvent } from "./rate-limit";

// =============================================================================
// Vérification serveur Cloudflare Turnstile (captcha invisible).
// =============================================================================
// DORMANT tant que TURNSTILE_SECRET_KEY n'est pas défini : tout passe (le
// widget côté client ne se rend pas non plus sans NEXT_PUBLIC_TURNSTILE_SITE_KEY).
// Poser les deux clés (Vercel + .env.local) ACTIVE le captcha sur les
// inscriptions et le reset mot de passe sans autre changement de code.
//
// Fail-open sur PANNE réseau de Cloudflare (disponibilité > blocage), mais
// fail-CLOSED sur un token manquant/invalide quand le captcha est actif.
// =============================================================================

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Nom du champ caché posté par le widget (convention Cloudflare). */
export const TURNSTILE_FIELD = "cf-turnstile-response";

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstileToken(
  token: FormDataEntryValue | null,
  ip?: string
): Promise<{ ok: boolean; token: string | null }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const value = typeof token === "string" && token.length > 0 ? token : null;
  if (!secret) return { ok: true, token: value };

  if (!value) {
    await logSecurityEvent("captcha_missing", { details: { ip } });
    return { ok: false, token: null };
  }

  try {
    const body = new URLSearchParams({ secret, response: value });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { success?: boolean };
    if (json.success !== true) {
      await logSecurityEvent("captcha_failed", { details: { ip } });
      return { ok: false, token: value };
    }
    return { ok: true, token: value };
  } catch {
    // Panne/timeout de siteverify : on laisse passer (les rate limits et le
    // honeypot restent actifs derrière).
    await logSecurityEvent("captcha_unavailable", { details: { ip } });
    return { ok: true, token: value };
  }
}

/**
 * Honeypot : champ invisible que seuls les robots remplissent. Toujours actif
 * (aucune clé requise), zéro friction pour un humain.
 */
export const HONEYPOT_FIELD = "coligo_hp_website";

export function honeypotTripped(formData: FormData): boolean {
  const v = formData.get(HONEYPOT_FIELD);
  return typeof v === "string" && v.trim().length > 0;
}
