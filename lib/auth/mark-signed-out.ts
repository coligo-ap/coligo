import { cookies } from "next/headers";
import {
  SIGNED_OUT_COOKIE,
  SIGNED_OUT_MAX_AGE,
} from "@/lib/auth/session-signout-marker";
import { isSupabaseAuthCookie } from "@/lib/supabase/cookie-guard";

/**
 * Pose le marqueur « déconnexion volontaire » (voir session-signout-marker) ET
 * purge les cookies de session Supabase. À appeler dans CHAQUE Server Action
 * de logout (y compris les fermetures « mauvais rôle »), après
 * `supabase.auth.signOut()`, juste avant le `redirect()`.
 *
 * La purge est ICI et nulle part ailleurs : depuis la garde anti-course
 * (lib/supabase/cookie-guard), le middleware et les clients serveur ne
 * propagent PLUS les suppressions automatiques émises par supabase-js (un
 * échec de refresh perdant une course effaçait la session entière). Sans cette
 * purge explicite, un logout laisserait donc les cookies en place.
 *
 * `httpOnly:false` sur le marqueur : SessionKeeper le lit via `document.cookie`
 * (ce n'est pas un secret). Best-effort : ne doit jamais empêcher la déconnexion.
 */
export async function markSignedOut(): Promise<void> {
  try {
    const store = await cookies();
    for (const c of store.getAll()) {
      if (isSupabaseAuthCookie(c.name)) store.delete(c.name);
    }
    store.set(SIGNED_OUT_COOKIE, "1", {
      path: "/",
      maxAge: SIGNED_OUT_MAX_AGE,
      httpOnly: false,
      sameSite: "lax",
    });
  } catch {
    /* best-effort */
  }
}
