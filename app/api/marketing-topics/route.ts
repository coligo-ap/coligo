import { NextResponse } from "next/server";
import {
  subscribeTokensToTopic,
  unsubscribeTokensFromTopic,
} from "@/lib/fcm/topics";
import { wilayaTopic, isValidWilaya } from "@/lib/marketing/geo-topics";
import { isRawApnsToken, importApnsToken } from "@/lib/fcm/apns-import";

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

  let token = typeof body.token === "string" ? body.token.trim() : "";
  const wilaya = typeof body.wilaya === "string" ? body.wilaya.trim() : "";
  const prevWilaya =
    typeof body.prevWilaya === "string" ? body.prevWilaya.trim() : "";

  if (!token || token.length > 4096) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  // Token APNs BRUT (hexadécimal — binaire iOS < build 30) : converti serveur en
  // token FCM via IID batchImport, comme /api/device-tokens. Sinon, un token FCM
  // contient toujours « : » (`<id>:<APA91b…>`).
  if (isRawApnsToken(token)) {
    const fcm = await importApnsToken(token);
    if (!fcm) {
      return NextResponse.json({ error: "invalid_token" }, { status: 400 });
    }
    token = fcm;
  } else if (!token.includes(":")) {
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
