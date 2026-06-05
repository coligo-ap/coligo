"use server";

import { createClient } from "@/lib/supabase/server";
import { notifyOrderMessage } from "@/lib/fcm/triggers";

/**
 * Envoie un message prédéfini du chat in-app (client OU livreur).
 *
 * Le rôle de l'expéditeur est déterminé côté DB par le RPC SECURITY DEFINER
 * `send_order_message` (vérifie que l'appelant est le client ou le livreur
 * attribué + que la livraison est active). Après insertion, on pousse une
 * notification au destinataire opposé (fire-and-forget).
 */
export async function sendOrderMessage(
  orderId: string,
  code: string
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_order_message", {
    p_order_id: orderId,
    p_code: code,
  });
  if (error) return { ok: false, reason: error.message };
  const row = (
    data as Array<{
      ok: boolean;
      reason: string | null;
      sender_role: "customer" | "courier" | null;
    }> | null
  )?.[0];
  if (!row) return { ok: false, reason: "no_response" };
  if (row.ok && row.sender_role) {
    void notifyOrderMessage({
      orderId,
      senderRole: row.sender_role,
      code,
    });
  }
  return { ok: row.ok, reason: row.reason ?? undefined };
}
