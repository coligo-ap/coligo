import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { withLongSession } from "./session-config";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, withLongSession(options))
          );
        },
      },
    }
  );

  // IMPORTANT : ne rien intercaler entre createServerClient et getUser()
  // (sinon la session peut ne pas être rafraîchie → déconnexions aléatoires).
  // En cas d'échec réseau (Algérie : lien instable vers Supabase), on ne casse
  // pas la navigation : on traite comme "non connecté" sans rediriger en boucle.
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    user = null;
  }

  const path = request.nextUrl.pathname;
  const isMerchantAuthRoute = path === "/login" || path === "/signup";
  const isCustomerAuthRoute =
    path === "/se-connecter" || path === "/inscription";
  // Un layout (MerchantShell / admin) renvoie parfois vers /login?error=...
  // (pas de boutique, accès refusé, requête échouée). Dans ce cas il NE FAUT
  // PAS renvoyer l'utilisateur connecté vers /dashboard, sinon boucle infinie.
  const bouncedWithError = request.nextUrl.searchParams.has("error");

  // Redirige EN RECOPIANT les cookies de session rafraîchis sur la réponse de
  // redirection. Sans ça, NextResponse.redirect() crée une réponse SANS ces
  // cookies → la session ne se pose jamais → boucle ERR_TOO_MANY_REDIRECTS.
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = ""; // évite de traîner les ?error= d'une redirection à l'autre
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  };

  // /dashboard exige une session — sinon login marchand.
  if (path.startsWith("/dashboard") && !user) {
    return redirectTo("/login");
  }

  // Espace pro marchand (/login, /signup) :
  // - connecté + déjà commerçant → /dashboard
  // - connecté + client (a une row customers) → /
  // - le check "merchant ou customer" est délégué à un appel léger côté DB
  //   uniquement si on est sur ces routes (≤ 1 query supplémentaire).
  if (user && isMerchantAuthRoute && !bouncedWithError) {
    const target = await resolveLandingForUser(supabase, user.id);
    return redirectTo(target);
  }

  // Espace client (/se-connecter, /inscription) :
  // - connecté + commerçant → /dashboard (pas de double identité possible)
  // - connecté + client → / (accueil marketplace)
  if (user && isCustomerAuthRoute && !bouncedWithError) {
    const target = await resolveLandingForUser(supabase, user.id);
    return redirectTo(target);
  }

  // Racine `/` : c'est le HOME CLIENT. On laisse passer les anons et les
  // clients connectés. Un commerçant connecté est renvoyé sur son dashboard.
  if (path === "/" && user) {
    const { data: merchant } = await supabase
      .from("merchants")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (merchant) return redirectTo("/dashboard");
  }

  return supabaseResponse;
}

/**
 * Décide vers quelle page atterrir un user authentifié, selon qu'il est
 * commerçant ou client. Fait au plus 2 requêtes très légères (id only).
 */
async function resolveLandingForUser(
  supabase: ReturnType<typeof createServerClient<Database>>,
  userId: string
): Promise<string> {
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (merchant) return "/dashboard";
  return "/";
}
