/**
 * Gate anti-fraude CLIENT (mig 0374) — lu par le layout de l'espace client
 * (popup obligatoire) et re-vérifié par les actions sensibles (checkout,
 * demande de course) : défense en profondeur.
 *
 * `customer_fraud_gate()` est une RPC SECURITY DEFINER scellée auth.uid(),
 * une seule lecture indexée — coût négligeable dans le rendu.
 */

import { createClient } from "@/lib/supabase/server";

export type CustomerFraudGate = {
  /** Popup bloquante « ne jamais accepter une demande d'annulation » à montrer. */
  requireAck: boolean;
  /** Compte suspendu : plus de nouvelles commandes / courses. */
  suspended: boolean;
  /** Compte limité (ex. paiement à la livraison désactivé). */
  limited: boolean;
  /** Vérification d'identité EXIGÉE (mig 0433). */
  requireIdv: boolean;
};

const OPEN_GATE: CustomerFraudGate = {
  requireAck: false,
  suspended: false,
  limited: false,
  requireIdv: false,
};

/** Jamais de throw : en cas de pépin, le gate est OUVERT (fail-open UX — la
 *  vraie barrière de sécurité reste côté SQL/serveur sur chaque action). */
export async function getCustomerFraudGate(): Promise<CustomerFraudGate> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("customer_fraud_gate");
    if (error || !data) return OPEN_GATE;
    const g = data as {
      require_ack?: boolean;
      suspended?: boolean;
      limited?: boolean;
      require_idv?: boolean;
    };
    return {
      requireAck: !!g.require_ack,
      suspended: !!g.suspended,
      limited: !!g.limited,
      requireIdv: !!g.require_idv,
    };
  } catch {
    return OPEN_GATE;
  }
}
