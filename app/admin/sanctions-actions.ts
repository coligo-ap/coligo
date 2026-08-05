"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import type { AlertDomain } from "@/lib/alerts/alert-model";
import { createClient } from "@/lib/supabase/server";
import type { FraudActorKind } from "@/lib/fraud/model";

// =============================================================================
// Levée d'UNE sanction anti-fraude DEPUIS une fiche admin (client, livreur,
// chauffeur, commerçant) — le module Anti-fraude n'est plus un passage obligé.
// Garde applicative par DOMAINE de la fiche appelante + re-garde SQL
// (_fraud_require_admin dans admin_fraud_revoke_action) : défense en
// profondeur, la RPC journalise et annule les effets de bord.
// =============================================================================

const KIND_DOMAIN: Record<FraudActorKind, AlertDomain> = {
  customer: "clients",
  driver: "livraison",
  chauffeur: "drive",
  merchant: "commercants",
};

/** Chemins à re-streamer après une levée (fiche + annuaire + module). */
function pathsFor(kind: FraudActorKind, actorId: string): string[] {
  const base = ["/admin/anti-fraude", "/admin/anti-fraude/comptes"];
  if (kind === "customer")
    return [...base, "/admin/clients", `/admin/clients/${actorId}`];
  if (kind === "driver")
    return [...base, "/admin/drivers", `/admin/drivers/${actorId}`];
  if (kind === "chauffeur")
    return [...base, "/admin/chauffeurs", `/admin/chauffeurs/${actorId}`];
  return [...base, "/admin/merchants"];
}

export async function revokeFraudSanctionAction(
  kind: FraudActorKind,
  actorId: string,
  actionId: string,
  note?: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan(KIND_DOMAIN[kind]))) return { error: "Accès refusé." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc("admin_fraud_revoke_action", {
    p_action_id: actionId,
    p_note: note?.trim() || "Levée depuis la fiche",
  });
  if (error) return { error: error.message };
  for (const p of pathsFor(kind, actorId)) revalidatePath(p);
  return { ok: true };
}
