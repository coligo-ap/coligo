import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/telemetry/ping — trace appareil/IP/localisation de l'utilisateur
 * connecté (envoyé ~toutes les 6 h par appareil, cf. PushRegistrar).
 *
 * IP + géo approximative lues des headers Vercel (x-vercel-ip-*) — aucune
 * géoloc GPS ici, uniquement la localisation réseau. Alimente
 * `user_device_log` (super-admin : /admin/devices, anti-fraude/anti-abus).
 */
export const dynamic = "force-dynamic";

const ROLES = ["merchant", "customer", "courier", "chauffeur"] as const;
const PLATFORMS = [
  "android",
  "ios",
  "windows",
  "macos",
  "linux",
  "other",
] as const;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { role?: unknown; platform?: unknown; standalone?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* corps vide accepté */
  }
  const role = ROLES.find((r) => r === body.role) ?? "customer";
  const platform = PLATFORMS.find((p) => p === body.platform) ?? null;
  const standalone =
    typeof body.standalone === "boolean" ? body.standalone : null;

  const h = req.headers;
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  // Headers géo Vercel (ville URL-encodée).
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  const country = h.get("x-vercel-ip-country");
  const region = dec(h.get("x-vercel-ip-country-region"));
  const city = dec(h.get("x-vercel-ip-city"));
  const lat = Number(h.get("x-vercel-ip-latitude")) || null;
  const lng = Number(h.get("x-vercel-ip-longitude")) || null;
  const ua = (h.get("user-agent") ?? "").slice(0, 256);

  const admin = createAdminClient();
  // RPC hors types générés — toujours .bind(admin) (cf. reference_supabase_rpc_bind).
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("log_device_ping", {
    p_user_id: user.id,
    p_role: role,
    p_ip: ip,
    p_ua: ua,
    p_platform: platform,
    p_standalone: standalone,
    p_country: country,
    p_region: region,
    p_city: city,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) {
    console.warn("[telemetry] log_device_ping failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
