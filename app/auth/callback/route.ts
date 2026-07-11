import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { provisionSocialUser, safeNext } from "@/lib/auth/social-provision";

/**
 * Callback OAuth NAVIGATEUR (Google, etc.) — échange le code contre une session,
 * puis provisionne le profil `customers`.
 *
 * Dans l'APK Android, ce chemin n'est PAS emprunté. La WebView Capacitor a son
 * propre magasin de cookies, isolé du navigateur système où Google impose de se
 * connecter : la session serait posée dans Chrome, pas dans l'app. L'APK passe
 * donc par le Sign-In Google NATIF (`lib/native/google-signin.ts` →
 * `signInWithGoogleNative`). La provision du profil, elle, est PARTAGÉE entre
 * les deux portes : `provisionSocialUser`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  // Portail d'origine : le bouton Google du portail COMMERÇANT (/login,
  // /signup) marque `intent=merchant` → erreurs et provision côté commerçant.
  const intent =
    searchParams.get("intent") === "merchant" ? "merchant" : "customer";
  const errorPath =
    intent === "merchant" ? "/login?error=oauth" : "/se-connecter?error=oauth";

  if (!code) {
    return NextResponse.redirect(new URL(errorPath, origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(errorPath, origin));
  }

  const to = await provisionSocialUser(supabase, next, intent);
  return NextResponse.redirect(new URL(to, origin));
}
