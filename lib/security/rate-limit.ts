import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp, getClientUserAgent } from "./request-context";

// =============================================================================
// Rate limiting applicatif — fenêtre fixe dans Postgres (mig 0452).
// =============================================================================
// Pourquoi Postgres et pas la mémoire : Vercel = serverless, chaque instance a
// sa propre mémoire → seul un compteur partagé (DB) voit le trafic global.
// Pourquoi pas GoTrue : les appels auth partent des IP de sortie Vercel, les
// limites par IP de Supabase ne voient jamais l'IP du client réel.
//
// Philosophie : FAIL-OPEN. Une panne du compteur ne doit JAMAIS bloquer un
// utilisateur légitime — on trace et on laisse passer. Les seuils par IP sont
// volontairement généreux : en Algérie, le CGNAT mobile fait partager une même
// IP publique à des milliers d'abonnés.
// =============================================================================

export type RateCheck = { allowed: boolean; retryAfterSeconds: number };

const FAIL_OPEN: RateCheck = { allowed: true, retryAfterSeconds: 0 };

/**
 * Incrémente (ou consulte avec `cost: 0`) le compteur `(bucket, subject)`.
 * `cost: 0` = peek — utilisé pour les buckets « échecs de login » : on vérifie
 * AVANT la tentative sans incrémenter, et on n'incrémente qu'APRÈS un échec
 * (sinon spammer l'identifiant d'une victime suffirait à la verrouiller).
 */
export async function rateHit(
  bucket: string,
  subject: string,
  max: number,
  windowSeconds: number,
  cost = 1
): Promise<RateCheck> {
  try {
    const admin = createAdminClient();
    // `as never` : table/RPC de la mig 0452, absente des types générés (même
    // convention que `is_ip_blocked` dans lib/supabase/middleware.ts).
    const { data, error } = await admin.rpc(
      "security_rate_hit" as never,
      {
        p_bucket: bucket,
        p_subject: subject,
        p_max: max,
        p_window_seconds: windowSeconds,
        p_cost: cost,
      } as never
    );
    if (error || !data || typeof data !== "object") return FAIL_OPEN;
    const row = data as { allowed?: boolean; retry_after_seconds?: number };
    return {
      allowed: row.allowed !== false,
      retryAfterSeconds: Math.max(0, row.retry_after_seconds ?? 0),
    };
  } catch {
    return FAIL_OPEN;
  }
}

/**
 * Journalise un événement de sécurité (blocage, honeypot, captcha échoué…).
 * Best-effort : ne throw jamais, ne bloque jamais l'action appelante.
 */
export async function logSecurityEvent(
  kind: string,
  info: {
    bucket?: string;
    subject?: string;
    path?: string;
    details?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    const [ip, ua] = await Promise.all([getClientIp(), getClientUserAgent()]);
    const admin = createAdminClient();
    await admin.from("security_events" as never).insert({
      kind,
      bucket: info.bucket ?? null,
      subject: info.subject ?? null,
      ip,
      user_agent: ua,
      path: info.path ?? null,
      details: info.details ?? {},
    } as never);
  } catch {
    // silencieux — le journal ne doit jamais casser le chemin nominal
  }
}

/** « 45 s » / « 3 min » / « 2 h » — pour les messages d'erreur inline. */
export function formatRetryDelay(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.ceil(seconds / 3600)} h`;
}
