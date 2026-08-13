import { NextResponse } from "next/server";
import {
  subscribeTokensToTopic,
  unsubscribeTokensFromTopic,
} from "@/lib/fcm/topics";
import { wilayaTopic, isValidWilaya } from "@/lib/marketing/geo-topics";
import { isRawApnsToken, importApnsToken } from "@/lib/fcm/apns-import";
import { rateHit, logSecurityEvent } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request-context";

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
  // Anti-abus (mig 0452) : route volontairement sans auth → plafond par IP
  // pour empêcher les (dés)abonnements de topics FCM en masse. Un appareil
  // légitime appelle 1-2 fois par changement de wilaya.
  const ip = await getClientIp();
  const gate = await rateHit("mkt_topics_ip", ip, 30, 3600);
  if (!gate.allowed) {
    await logSecurityEvent("rate_limited", {
      bucket: "mkt_topics_ip",
      path: "/api/marketing-topics",
    });
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(gate.retryAfterSeconds) },
      }
    );
  }

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
