// =============================================================================
// Supabase ADMIN client — service_role
// =============================================================================
// ⚠️ Ce client bypass complètement RLS. Il NE DOIT être importé QUE depuis :
//   - le webhook Chargily (app/api/chargily/webhook/route.ts)
//   - les Server Actions explicitement décrites comme "admin" (aucune pour
//     l'instant — toutes les autres passent par createClient() qui respecte
//     la session utilisateur et RLS).
//
// Jamais depuis un composant client, jamais depuis une page rendue côté
// utilisateur. Le `SUPABASE_SERVICE_ROLE_KEY` n'a PAS de préfixe NEXT_PUBLIC_
// donc Next.js ne l'expose pas au navigateur.
// =============================================================================

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL manquant — " +
        "le client admin Supabase ne peut pas être créé."
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
