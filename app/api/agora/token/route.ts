import { NextResponse, type NextRequest } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { getDriveActiveRide } from "@/app/(customer)/drive/actions";
import { getChauffeurActiveRide } from "@/app/(chauffeur)/actions";

// =============================================================================
// Jeton Agora RTC pour l'appel in-app client ↔ chauffeur (Coligo Drive).
//
// Sécurité : on ne délivre un jeton QUE si l'utilisateur est réellement PARTIE
// à la course demandée. On réutilise les helpers RLS-aware existants
// (getDriveActiveRide côté client, getChauffeurActiveRide côté chauffeur) :
// le jeton n'est émis que si LEUR course active correspond au `rideId` reçu.
//
// Le média (voix/vidéo) ne transite JAMAIS par Vercel ni Supabase : il passe
// par le réseau Agora (P2P/relais). Cette route serverless ne fait que signer
// un jeton court (1 h) — charge négligeable.
//
// uid déterministe par course : client = 1, chauffeur = 2 (2 parties, même
// canal `ride<uuid sans tirets>`).
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function channelFor(rideId: string): string {
  // Canal Agora : ASCII, < 64 octets. On retire les tirets de l'UUID.
  return "ride" + rideId.replace(/-/g, "");
}

export async function POST(req: NextRequest) {
  const appId = process.env.AGORA_APP_ID?.trim();
  const appCert = process.env.AGORA_APP_CERTIFICATE?.trim();
  if (!appId || !appCert) {
    return NextResponse.json(
      { error: "agora_not_configured" },
      { status: 503 }
    );
  }

  let body: { rideId?: string; role?: string };
  try {
    body = (await req.json()) as { rideId?: string; role?: string };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const rideId = body.rideId?.trim();
  const role = body.role;
  if (!rideId || (role !== "client" && role !== "chauffeur")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Autorisation : la course active de CET utilisateur doit être celle demandée.
  const ride =
    role === "client"
      ? await getDriveActiveRide()
      : await getChauffeurActiveRide();
  if (!ride || ride.id !== rideId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const uid = role === "client" ? 1 : 2;
  const channel = channelFor(rideId);
  const ttlSeconds = 3600;
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCert,
    channel,
    uid,
    RtcRole.PUBLISHER,
    ttlSeconds,
    ttlSeconds
  );

  return NextResponse.json({ appId, channel, uid, token });
}
