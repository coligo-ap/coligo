import { NextResponse, type NextRequest } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { getDriveActiveRide } from "@/app/(customer)/drive/actions";
import { getChauffeurActiveRide } from "@/app/(chauffeur)/actions";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentCustomer } from "@/lib/auth/customer";

// =============================================================================
// Jeton Agora RTC pour les appels in-app :
//   - COURSE Drive (client ↔ chauffeur)      : body { rideId, role } ;
//   - COMMANDE (commerçant → client, 1 sens) : body { orderId, role }.
//
// Sécurité : on ne délivre un jeton QUE si l'utilisateur est réellement PARTIE
// à l'objet demandé — helpers RLS-aware pour la course ; pour la commande, le
// commerçant doit posséder la commande (session + .eq merchant_id) et le
// client doit en être l'acheteur (getCurrentCustomer + .eq customer_id).
//
// Le média (voix/vidéo) ne transite JAMAIS par Vercel ni Supabase : il passe
// par le réseau Agora (P2P/relais). Cette route serverless ne fait que signer
// un jeton court (1 h) — charge négligeable.
//
// uid déterministe par canal (2 parties) : course → client=1, chauffeur=2 ;
// commande → client=1, commerçant=2.
// =============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Canal Agora : ASCII, < 64 octets. On retire les tirets de l'UUID. */
function channelFor(prefix: "ride" | "order", id: string): string {
  return prefix + id.replace(/-/g, "");
}

/** Statuts pendant lesquels un appel de COMMANDE a du sens. */
const ORDER_CALL_STATUSES = ["pending", "accepted", "preparing", "ready"];

export async function POST(req: NextRequest) {
  const appId = process.env.AGORA_APP_ID?.trim();
  const appCert = process.env.AGORA_APP_CERTIFICATE?.trim();
  if (!appId || !appCert) {
    return NextResponse.json(
      { error: "agora_not_configured" },
      { status: 503 }
    );
  }

  let body: { rideId?: string; orderId?: string; role?: string };
  try {
    body = (await req.json()) as {
      rideId?: string;
      orderId?: string;
      role?: string;
    };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const role = body.role;
  let channel: string;
  let uid: number;

  if (body.orderId) {
    // ─── Appel de COMMANDE (commerçant ↔ client de CETTE commande) ───
    const orderId = body.orderId.trim();
    if (!orderId || (role !== "merchant" && role !== "client")) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const supabase = await createClient();

    if (role === "merchant") {
      const user = await getAuthUser();
      if (!user) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      const { data: me } = await supabase
        .from("merchants")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!me) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      const { data: order } = await supabase
        .from("orders")
        .select("id, status")
        .eq("id", orderId)
        .eq("merchant_id", me.id)
        .maybeSingle();
      if (!order || !ORDER_CALL_STATUSES.includes(order.status)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    } else {
      const customer = await getCurrentCustomer();
      if (!customer) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      const { data: order } = await supabase
        .from("orders")
        .select("id, status")
        .eq("id", orderId)
        .eq("customer_id", customer.id)
        .maybeSingle();
      if (!order || !ORDER_CALL_STATUSES.includes(order.status)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }

    channel = channelFor("order", orderId);
    uid = role === "client" ? 1 : 2;
  } else {
    // ─── Appel de COURSE Drive (comportement historique inchangé) ───
    const rideId = body.rideId?.trim();
    if (!rideId || (role !== "client" && role !== "chauffeur")) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const ride =
      role === "client"
        ? await getDriveActiveRide()
        : await getChauffeurActiveRide();
    if (!ride || ride.id !== rideId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    channel = channelFor("ride", rideId);
    uid = role === "client" ? 1 : 2;
  }

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
