import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFcm } from "@/lib/fcm/send";

/**
 * OUTIL — Push de test vers les appareils d'un utilisateur.
 *
 * Sert à valider la chaîne FCM de bout en bout (natif ET web/PWA) sans passer
 * par un événement métier. N'est PAS appelé par Vercel Cron : placé sous
 * /api/cron pour réutiliser la même protection CRON_SECRET.
 *
 * GET /api/cron/push-test?email=<email>[&platform=web]
 * Authorization: Bearer <CRON_SECRET>
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase();
  const rawPlatform = url.searchParams.get("platform")?.trim();
  const platform = (["android", "ios", "web"] as const).find(
    (p) => p === rawPlatform
  );
  if (!email) {
    return NextResponse.json({ error: "email_required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: list, error: userErr } = await admin.auth.admin.listUsers({
    perPage: 1000,
  });
  const user = list?.users.find((u) => u.email?.toLowerCase() === email);
  if (userErr || !user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  let q = admin
    .from("device_tokens")
    .select("token, platform, role")
    .eq("user_id", user.id);
  if (platform) q = q.eq("platform", platform);
  const { data: rows, error: tokErr } = await q;
  if (tokErr) {
    return NextResponse.json({ error: tokErr.message }, { status: 500 });
  }
  if (!rows?.length) {
    return NextResponse.json({ error: "no_tokens" }, { status: 404 });
  }

  const result = await sendFcm(
    rows.map((r) => r.token),
    {
      title: "Test Coligo 🔔",
      body: "Les notifications push fonctionnent — même app fermée !",
    },
    { route: "/" }
  );

  return NextResponse.json({
    ok: true,
    sent: result.ok,
    devices: rows.map((r) => ({ platform: r.platform, role: r.role })),
    invalidated: result.invalidTokens.length,
  });
}
