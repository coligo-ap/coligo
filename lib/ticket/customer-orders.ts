import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Nombre TOTAL de commandes (non annulées) d'un client chez UN commerçant,
 * identifié par son téléphone. Sert au bloc « fidélité » du ticket : la
 * commande courante étant déjà insérée, le compte = le rang (1 → première).
 *
 * Fonctionne avec le client serveur OU navigateur (RLS commerçant : ne voit
 * que ses propres commandes). Téléphone vide / requête en échec → `null`
 * (le ticket n'imprime alors rien — pas de fausse « première commande »).
 */
export async function fetchCustomerOrderCount(
  supabase: SupabaseClient<Database>,
  merchantId: string,
  customerPhone: string | null | undefined
): Promise<number | null> {
  const phone = customerPhone?.trim();
  if (!phone) return null;
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchantId)
    .eq("customer_phone", phone)
    .neq("status", "cancelled");
  if (error || typeof count !== "number") return null;
  return count;
}
