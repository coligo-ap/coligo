import "server-only";
import { headers } from "next/headers";

/**
 * IP réelle du client derrière Vercel. `x-vercel-forwarded-for` est posé par
 * Vercel lui-même (non falsifiable de l'extérieur) ; `x-forwarded-for` peut
 * contenir une chaîne de proxys — on prend la PREMIÈRE entrée (le client).
 * ⚠️ Les appels Supabase côté serveur partent des IP de sortie Vercel : les
 * rate limits par IP de GoTrue ne voient donc JAMAIS l'IP du client — c'est
 * précisément pour ça que nos limites applicatives se basent sur CETTE IP-ci.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** User-Agent tronqué (même convention que user_device_log : 256 max). */
export async function getClientUserAgent(): Promise<string> {
  const h = await headers();
  return (h.get("user-agent") ?? "").slice(0, 256);
}
