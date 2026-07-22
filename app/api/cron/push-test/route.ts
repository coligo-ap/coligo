import { NextResponse } from "next/server";
import { JWT } from "google-auth-library";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendFcm } from "@/lib/fcm/send";

/**
 * Diagnostic NON destructif : FCM `validateOnly` (aucune livraison, aucune
 * purge de token) avec le MÊME payload que la vraie push. Renvoie le message
 * d'erreur complet pour chaque token → révèle la cause exacte (clé APNs absente,
 * SenderId mismatch, token périmé) sans effet de bord.
 */
async function dryRunDiagnose(
  tokens: string[]
): Promise<
  Array<{ tail: string; ok: boolean; status: number; error: string }>
> {
  const projectId = process.env.FCM_PROJECT_ID?.trim();
  const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FCM_PRIVATE_KEY;
  if (!projectId || !clientEmail || !rawKey) {
    return tokens.map((t) => ({
      tail: t.slice(-8),
      ok: false,
      status: 0,
      error: "FCM_* env manquantes",
    }));
  }
  const key = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  const jwt = new JWT({
    email: clientEmail,
    key,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const { token: at } = await jwt.getAccessToken();
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  return Promise.all(
    tokens.map(async (deviceToken) => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${at}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          validateOnly: true,
          message: {
            token: deviceToken,
            notification: { title: "Diag", body: "Diag" },
            apns: {
              headers: { "apns-priority": "10", "apns-push-type": "alert" },
              payload: { aps: { sound: "default" } },
            },
          },
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string; status?: string };
      } | null;
      return {
        tail: deviceToken.slice(-8),
        ok: res.ok,
        status: res.status,
        error: body?.error
          ? `${body.error.status ?? ""}: ${body.error.message ?? ""}`
          : "",
      };
    })
  );
}

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

  // Mode DIAGNOSTIC (&dryrun=1) : valide le message auprès de FCM (validateOnly)
  // SANS livrer NI purger le token, et renvoie le MESSAGE d'erreur COMPLET —
  // pour distinguer « clé APNs absente », « SenderId mismatch » ou « token
  // périmé » sans détruire les tokens de test.
  if (url.searchParams.get("dryrun") === "1") {
    const diag = await dryRunDiagnose(rows.map((r) => r.token));
    return NextResponse.json({ ok: true, dryrun: true, results: diag });
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
    // Codes d'erreur FCM (diagnostic) : THIRD_PARTY_AUTH_ERROR = clé APNs
    // absente côté Firebase ; UNREGISTERED = token mort (réinstall / rotation).
    errors: result.errors,
  });
}
