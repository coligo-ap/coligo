import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // On exclut tout ce qui n'a pas besoin d'auth Supabase : assets statiques,
    // service worker, manifests (manifest-*.webmanifest via l'extension),
    // .well-known (assetlinks.json TWA — DOIT sortir en 200 direct, sans
    // redirection), et les webhooks externes (Chargily) qui arrivent sans
    // cookies utilisateur. Évite un `auth.getUser()` à chaque requête de
    // SW / favicon / manifest / webhook (perf + ratelimit Supabase).
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|\\.well-known|auth|api/chargily|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|json|txt|wav|mp3|woff2?|webmanifest)$).*)",
  ],
};
