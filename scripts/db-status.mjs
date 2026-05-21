/**
 * Affiche l'historique des migrations : local vs distant.
 *
 *   npm run db:status
 */
import { runSupabase } from "./_supabase.mjs";

runSupabase(["migration", "list"]);
