/**
 * Applique les migrations locales (supabase/migrations/) à la base distante
 * via le pooler. Idempotent : ne pousse que les migrations absentes de
 * l'historique distant.
 *
 *   npm run db:push
 *
 * Args supplémentaires transmis au CLI (ex. --dry-run) :
 *   npm run db:push -- --dry-run
 */
import { runSupabase } from "./_supabase.mjs";

const passthrough = process.argv.slice(2);
runSupabase(["db", "push", "--yes", ...passthrough]);
