import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifySharedCartReminder } from "@/lib/fcm/triggers";

/**
 * CRON — PANIERS PARTAGÉS (quotidien, filet — mig 0405/0406) :
 *   a) expiration des paniers open|locked non commandés dépassés (48 h) ;
 *   b) rappel push au capitaine ~24 h avant l'expiration (panier non vide) ;
 *   c) reprise de main : panier `ordered` dont la commande a été ANNULÉE sans
 *      paiement → retour `locked` (le capitaine recommande).
 *
 * L'UX n'attend PAS ce cron : `shared_cart_by_token` calcule déjà le statut
 * « expiré » dynamiquement, et l'ouverture de la room auto-guérit le cas (c)
 * (self-heal in-band). Ici on matérialise + on pousse les rappels.
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

  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  const { data, error } = await rpc("expire_shared_carts", {});
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const res = (data ?? {}) as {
    expired?: number;
    reopened?: number;
    reminders?: {
      share_token: string;
      captain_customer_id: string;
      merchant_name: string | null;
    }[];
  };

  for (const r of res.reminders ?? []) {
    void notifySharedCartReminder({
      customerId: r.captain_customer_id,
      merchantName: r.merchant_name ?? "Coligo",
      shareToken: r.share_token,
    });
  }

  return NextResponse.json({
    ok: true,
    expired: res.expired ?? 0,
    reopened: res.reopened ?? 0,
    reminders: (res.reminders ?? []).length,
  });
}
