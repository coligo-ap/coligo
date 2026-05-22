import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

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
            supabaseResponse.cookies.set(name, value, options)
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
  const isPublicAuthRoute = path === "/login" || path === "/signup";
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

  if (path.startsWith("/dashboard") && !user) {
    return redirectTo("/login");
  }

  // Connecté sur /login ou /signup → /dashboard, SAUF si on y a été renvoyé
  // avec une erreur (sinon ping-pong avec le layout qui re-renvoie ici).
  if (user && isPublicAuthRoute && !bouncedWithError) {
    return redirectTo("/dashboard");
  }

  if (path === "/") {
    return redirectTo(user ? "/dashboard" : "/login");
  }

  return supabaseResponse;
}
