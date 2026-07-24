import { cookies } from "next/headers";
import {
  SIGNED_OUT_COOKIE,
  SIGNED_OUT_MAX_AGE,
} from "@/lib/auth/session-signout-marker";

/**
 * Pose le marqueur « déconnexion volontaire » (voir session-signout-marker).
 * À appeler dans CHAQUE Server Action de logout, juste avant le `redirect()`.
 * SessionKeeper le consommera pour NE PAS ressusciter la session fermée.
 *
 * `httpOnly:false` : SessionKeeper le lit via `document.cookie` (le marqueur
 * n'est pas un secret). Best-effort : ne doit jamais empêcher la déconnexion.
 */
export async function markSignedOut(): Promise<void> {
  try {
    (await cookies()).set(SIGNED_OUT_COOKIE, "1", {
      path: "/",
      maxAge: SIGNED_OUT_MAX_AGE,
      httpOnly: false,
      sameSite: "lax",
    });
  } catch {
    /* best-effort */
  }
}
