import { NextResponse } from "next/server";
import {
  subscribeTokensToTopic,
  unsubscribeTokensFromTopic,
} from "@/lib/fcm/topics";
import { wilayaTopic, isValidWilaya } from "@/lib/marketing/geo-topics";

/**
 * POST /api/marketing-topics — abonne l'appareil au topic MARKETING de sa wilaya.
 *
 * PAS d'authentification volontairement : le marketing géo doit fonctionner même
 * DÉCONNECTÉ (contrairement à /api/device-tokens, réservé au personnel lié à un
 * user). On ne stocke rien côté DB ; on ne fait que gérer l'appartenance au topic
 * FCM (par token d'appareil, un secret que seul l'appareil possède). Le personnel
 * reste, lui, coupé à la déconnexion (device_tokens supprimés).
 *
 * Validation stricte : token au format FCM (contient « : ») + wilaya 1..58.
 */
export async function POST(req: Request) {
  let body: { token?: unknown; wilaya?: unknown; prevWilaya?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const wilaya = typeof body.wilaya === "string" ? body.wilaya.trim() : "";
  const prevWilaya =
    typeof body.prevWilaya === "string" ? body.prevWilaya.trim() : "";

  // Token FCM : contient toujours « : » (`<id>:<APA91b…>`). Rejette un token
  // vide, trop long, ou un token APNs brut (hexadécimal) — cf. /api/device-tokens.
  if (
    !token ||
    token.length > 4096 ||
    !token.includes(":") ||
    /^[0-9a-fA-F]{40,}$/.test(token)
  ) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  if (!isValidWilaya(wilaya)) {
    return NextResponse.json({ error: "invalid_wilaya" }, { status: 400 });
  }

  // Changement de zone : on quitte l'ancien topic (best-effort) avant de rejoindre
  // le nouveau, pour ne pas recevoir les promos de deux wilayas.
  if (prevWilaya && isValidWilaya(prevWilaya) && prevWilaya !== wilaya) {
    await unsubscribeTokensFromTopic([token], wilayaTopic(prevWilaya));
  }

  const ok = await subscribeTokensToTopic([token], wilayaTopic(wilaya));
  return NextResponse.json({ ok });
}
