"use server";

// =============================================================================
// Server Actions commandes CLIENT — annulation avant acceptation.
// =============================================================================
// L'annulation réelle (vérifs propriété + statut + paiement, re-crédit wallet)
// est faite ATOMIQUEMENT côté SQL par la RPC SECURITY DEFINER
// cancel_order_by_customer (mig 0073). Ici on relaie le résultat et on notifie
// le commerçant (push) pour qu'il ne prépare pas la commande.
//
// ROBUSTESSE : toute la fonction est encapsulée — elle ne THROW JAMAIS (sinon
// Next renvoie une "server-side exception" / digest au client). Elle renvoie
// toujours un CancelResult propre que l'UI transforme en toast.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyMerchantOrderCancelled } from "@/lib/fcm/triggers";

export type CancelResult =
  | { ok: true; refundedToColigoPay: number }
  | { ok: false; error: string };

export async function cancelMyOrder(orderId: string): Promise<CancelResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Tu dois te reconnecter." };

    // La RPC 0073/0075 n'est pas (encore) dans database.types.ts généré : on
    // cast le NOM/args (`as never`) MAIS on garde l'appel METHODE supabase.rpc(…)
    // pour ne pas perdre le binding `this` (sinon throw à l'exécution).
    const { data, error } = await supabase.rpc(
      "cancel_order_by_customer" as never,
      { p_order_id: orderId } as never
    );

    if (error) {
      // Les RAISE de la RPC remontent un message lisible (propriété, trop tard,
      // payé en ligne…) → on l'affiche tel quel.
      const msg = (error as { message?: string }).message;
      return { ok: false, error: msg || "Annulation impossible." };
    }

    const res = (data ?? {}) as unknown as {
      ok?: boolean;
      merchant_id?: string;
      order_number?: string | null;
      customer_name?: string | null;
      refunded_to_coligo_pay?: number;
    };

    // Notifie le commerçant (push). AWAIT dans un try/catch dédié : pas de
    // promesse flottante (qui, sur Vercel, peut faire échouer l'action) et
    // aucune exception ne remonte.
    if (res.ok && res.merchant_id) {
      try {
        await notifyMerchantOrderCancelled({
          merchantId: res.merchant_id,
          orderId,
          orderRef: res.order_number ?? null,
          customerName: res.customer_name ?? null,
        });
      } catch (e) {
        console.warn("[cancelMyOrder] notify failed:", e);
      }
    }

    revalidatePath(`/commandes/${orderId}`);
    revalidatePath("/commandes");
    return {
      ok: true,
      refundedToColigoPay: Math.max(0, Number(res.refunded_to_coligo_pay ?? 0)),
    };
  } catch (e) {
    console.error("[cancelMyOrder] failed:", e);
    return {
      ok: false,
      error: "Annulation impossible pour le moment. Réessaie.",
    };
  }
}
