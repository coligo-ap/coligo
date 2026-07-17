"use server";

// =============================================================================
// Anti-fraude CLIENT — acquittement de la popup obligatoire (mig 0373-0374).
// La RPC `customer_fraud_acknowledge` (SECURITY DEFINER, scellée auth.uid())
// enregistre la PREUVE (IP, appareil, horodatage) dans customer_fraud_acks et
// révoque l'action `require_ack`. Ne THROW jamais.
// =============================================================================

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function acknowledgeFraudCancelWarning(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const supabase = await createClient();
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
    const device = (h.get("user-agent") ?? "").slice(0, 256) || null;
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("customer_fraud_acknowledge", {
      p_ip: ip,
      p_device: device,
    });
    if (error) return { ok: false, error: error.message };
    const res = (data ?? {}) as { ok?: boolean };
    if (res.ok) revalidatePath("/", "layout");
    return { ok: !!res.ok };
  } catch (e) {
    console.warn("[fraud] acknowledge failed:", e);
    return { ok: false, error: "retry" };
  }
}
