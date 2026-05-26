import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/device-tokens — enregistre (ou met à jour) le token FCM de
 * l'appareil pour l'utilisateur courant et son rôle.
 *
 * Pourquoi service_role :
 *  - Un token est UNIQUE par appareil. Si l'utilisateur change de compte
 *    sur le même appareil, on doit réaffecter le token à son nouveau user
 *    (UPDATE d'une ligne dont `user_id` ne match pas `auth.uid()` —
 *    bloqué par RLS). On valide d'abord la session via le client SSR puis
 *    on écrit via service_role.
 *  - RLS reste utile pour la lecture/suppression côté client (l'admin
 *    bypass ne sert qu'ici).
 */

type Role = "merchant" | "customer" | "courier";
type Platform = "android" | "ios" | "web";

const ROLES: readonly Role[] = ["merchant", "customer", "courier"];
const PLATFORMS: readonly Platform[] = ["android", "ios", "web"];

const isRole = (v: unknown): v is Role =>
  typeof v === "string" && (ROLES as readonly string[]).includes(v);
const isPlatform = (v: unknown): v is Platform =>
  typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { token?: unknown; role?: unknown; platform?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const role = isRole(body.role) ? body.role : null;
  const platform = isPlatform(body.platform) ? body.platform : null;

  if (!token || token.length > 4096 || !role || !platform) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("device_tokens").upsert(
    {
      user_id: user.id,
      role,
      token,
      platform,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" }
  );

  if (error) {
    console.error("[device-tokens] upsert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
