import { NextResponse } from "next/server";
import { sweepStaleIntlSessions } from "@/lib/payments/intl-guard";

/**
 * CRON — Filet d'expiration des paiements € abandonnés (D-1, catch-all).
 *
 * Un PaymentIntent Stripe n'expire jamais tout seul : une feuille de paiement
 * abandonnée (app tuée, onglet fermé) laisserait la commande/course « en
 * attente de paiement » pour toujours. Le vrai temps réel est assuré par le
 * sweep OPPORTUNISTE (déclenché à chaque nouveau paiement €) ; ce cron
 * quotidien (plan Hobby Vercel = quotidien max) n'est que le rattrapage pour
 * les jours sans activité €.
 *
 * Mécanique : sessions 'created' > 35 min → annulation de l'intent chez
 * Stripe → le webhook payment_intent.canceled fait le ménage complet
 * (commande annulée + soldes re-crédités par triggers, ou course
 * drive_card_failed). Repli direct en base si Stripe est injoignable.
 *
 * Sécurité : Vercel Cron envoie « Authorization: Bearer <CRON_SECRET> ».
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cleaned = await sweepStaleIntlSessions();
  return NextResponse.json({ ok: true, cleaned });
}
