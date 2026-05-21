/**
 * Connexion Postgres directe via le pooler Supabase (Supavisor).
 *
 * Le runtime de l'app utilise le client Supabase JS (URL + anon key) ;
 * cette connection string sert au tooling : migrations, scripts, et toute
 * connexion Postgres directe (ORM, psql, etc.).
 *
 * La string complète est figée ici — seul le mot de passe est injecté
 * depuis l'environnement (SUPABASE_DB_PASSWORD), à renseigner sur Vercel
 * et dans .env.local.
 *
 * Région : eu-west-1 · Mode session (port 5432).
 * Pour le mode transaction (recommandé en serverless), utiliser le port 6543.
 */

const DB_HOST = "aws-0-eu-west-1.pooler.supabase.com";
const DB_PORT = 5432;
const DB_USER = "postgres.htxqzktwuymzetbdqghx";
const DB_NAME = "postgres";

/**
 * Construit la connection string du pooler à partir du mot de passe.
 * Le mot de passe est URL-encodé pour gérer les caractères spéciaux.
 */
export function getDatabaseUrl(): string {
  const password = process.env.SUPABASE_DB_PASSWORD;

  if (!password) {
    throw new Error(
      "SUPABASE_DB_PASSWORD est manquant. Ajoute-le dans .env.local (et sur Vercel)."
    );
  }

  return `postgresql://${DB_USER}:${encodeURIComponent(password)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

/**
 * Connection string du pooler. Vaut `null` si le mot de passe n'est pas
 * défini (évite de planter l'app au build/runtime quand la DB directe
 * n'est pas utilisée).
 */
export const DATABASE_URL: string | null = process.env.SUPABASE_DB_PASSWORD
  ? getDatabaseUrl()
  : null;
