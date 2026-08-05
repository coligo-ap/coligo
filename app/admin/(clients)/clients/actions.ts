"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminCan } from "@/lib/auth/admin";
import { revokeActiveSuspendSanctions } from "@/lib/fraud/reinstate";
import { listCustomers } from "@/lib/data/admin-customers";
import {
  isCustomerFeature,
  type CustomerStatusFilter,
  type CustomersPage,
} from "@/lib/admin/customer-features";

export type ClientActionResult = { ok?: true; error?: string };

/** Toutes les écritures passent par les RPC gardées `admin_can('clients')`. */
async function callRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<ClientActionResult> {
  if (!(await adminCan("clients"))) return { error: "Accès refusé." };
  const supabase = await createClient();
  // RPC hors types générés → bind OBLIGATOIRE (cf. reference_supabase_rpc_bind).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    f: string,
    a: Record<string, unknown>
  ) => Promise<{ error: { message: string } | null }>;
  const { error } = await rpc(fn, args);
  if (error) return { error: error.message };
  return { ok: true };
}

/** Recherche paginée (appelée par la vue client, cache TanStack Query). */
export async function searchCustomersAction(input: {
  q?: string;
  status?: CustomerStatusFilter;
  page?: number;
}): Promise<CustomersPage> {
  return listCustomers(input);
}

/** Suspend / réactive un compte client. */
export async function setCustomerBlockAction(
  customerId: string,
  blocked: boolean,
  reason?: string
): Promise<ClientActionResult> {
  if (blocked && !reason?.trim()) {
    return { error: "Indique le motif de la suspension." };
  }
  const res = await callRpc("admin_set_customer_block", {
    p_customer_id: customerId,
    p_blocked: blocked,
    p_reason: reason ?? null,
  });
  if (res.ok) {
    revalidatePath("/admin/clients");
    revalidatePath(`/admin/clients/${customerId}`);
  }
  return res;
}

/**
 * RÉACTIVATION TOTALE d'un compte : lève le blocage manuel (is_blocked) ET
 * toutes les sanctions anti-fraude « suspend » actives — les DEUX systèmes de
 * suspension coexistent (mig 0374 / 0435) et un « Réactiver » qui n'en lève
 * qu'un laisse le client bloqué (bug vécu : qawaexpress@). Les révocations
 * passent par la RPC admin_fraud_revoke_action EN SESSION (gardée
 * _fraud_require_admin côté SQL) — le service_role ne sert qu'à LISTER.
 */
export async function reinstateCustomerAction(
  customerId: string
): Promise<ClientActionResult> {
  if (!(await adminCan("clients"))) return { error: "Accès refusé." };

  // 1) Blocage manuel (no-op propre si déjà levé).
  const blockRes = await callRpc("admin_set_customer_block", {
    p_customer_id: customerId,
    p_blocked: false,
    p_reason: null,
  });
  if (blockRes.error) return blockRes;

  // 2) Sanctions anti-fraude « suspend » actives → révoquées (helper partagé
  //    avec les fiches livreur/chauffeur/commerçant).
  const fraudRes = await revokeActiveSuspendSanctions(
    "customer",
    customerId,
    "Réactivation du compte depuis la fiche client"
  );
  if (fraudRes.error) {
    return { error: `Blocage manuel levé, mais ${fraudRes.error}` };
  }

  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${customerId}`);
  return { ok: true };
}

/** Coupe / rétablit une fonctionnalité pour ce client. */
export async function setCustomerFeatureAction(
  customerId: string,
  feature: string,
  blocked: boolean,
  reason?: string
): Promise<ClientActionResult> {
  if (!isCustomerFeature(feature)) return { error: "Fonctionnalité inconnue." };
  const res = await callRpc("admin_set_customer_feature", {
    p_customer_id: customerId,
    p_feature: feature,
    p_blocked: blocked,
    p_reason: reason ?? null,
  });
  if (res.ok) {
    revalidatePath("/admin/clients");
    revalidatePath(`/admin/clients/${customerId}`);
  }
  return res;
}

/** Note interne (visible des seuls admins). */
export async function setCustomerNoteAction(
  customerId: string,
  note: string
): Promise<ClientActionResult> {
  const res = await callRpc("admin_set_customer_note", {
    p_customer_id: customerId,
    p_note: note,
  });
  if (res.ok) revalidatePath(`/admin/clients/${customerId}`);
  return res;
}
