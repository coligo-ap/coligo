"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  canUseNativeGoogle,
  NativeGoogleError,
} from "@/lib/native/google-signin";
import { isNative as isNativeApp } from "@/lib/native/context";
import { signInWithGoogleNative } from "@/app/auth/actions";

/**
 * Connexion Google du client. DEUX chemins, selon l'environnement :
 *
 *  • APK (Capacitor) → Sign-In Google NATIF. La WebView a son propre magasin de
 *    cookies, isolé de Chrome, et Google refuse l'OAuth dans une WebView
 *    embarquée : passer par le navigateur poserait la session au mauvais
 *    endroit. Le natif rend un `id_token`, échangé côté serveur.
 *  • Web (PWA / navigateur) → OAuth classique, redirection vers Google puis
 *    retour sur `/auth/callback`.
 *
 * Les deux provisionnent le profil par `provisionSocialUser`, jamais deux fois.
 * Le provider doit être activé dans le Dashboard Supabase + les URLs de
 * redirection allowlistées.
 *
 * `intent="merchant"` (portail commerçant /login + /signup) : la même porte
 * Google, mais le provisioning cible l'espace COMMERÇANT — boutique existante
 * → /dashboard, sinon complétion de la boutique sur /signup/boutique. Les
 * `labels` FR figés gardent l'espace commerçant hors i18n (client seul traduit).
 */
export function SocialAuth({
  next,
  intent = "customer",
  labels,
}: {
  next?: string;
  intent?: "customer" | "merchant";
  labels?: { or: string; button: string; error: string };
}) {
  const t = useTranslations("auth");
  // Espace commerçant non traduit (client seul) → libellés FR figés par défaut.
  const merchantDefaults =
    intent === "merchant"
      ? {
          or: "ou",
          button: "Continuer avec Google",
          error: "La connexion Google a échoué. Réessayez.",
        }
      : null;
  const or = labels?.or ?? merchantDefaults?.or ?? t("or");
  const buttonLabel =
    labels?.button ?? merchantDefaults?.button ?? t("continueWithGoogle");
  const errorLabel =
    labels?.error ?? merchantDefaults?.error ?? t("googleAuthFailed");
  // App native sans config Google (iOS sans client OAuth iOS) : message
  // dédié — surtout PAS le repli OAuth web (éjection Safari).
  const nativeUnavailableLabel =
    intent === "merchant"
      ? "Connexion Google bientôt disponible dans l'app — utilisez votre email."
      : t("googleNativeUnavailable");
  const [loading, setLoading] = useState(false);
  // Erreur INLINE sous le bouton (cf. CLAUDE.md : pas de toast sur une action
  // de bouton). L'utilisateur regarde le bouton, pas le coin de l'écran.
  const [error, setError] = useState<string | null>(null);

  /** APK : feuille Google native → jeton → session posée par l'action serveur. */
  async function signInNative() {
    const { nativeGoogleIdToken } = await import("@/lib/native/google-signin");
    const { idToken, nonce } = await nativeGoogleIdToken();
    // En cas de succès l'action `redirect()` : la promesse ne revient jamais.
    const res = await signInWithGoogleNative({ idToken, nonce, next, intent });
    if (res?.error) setError(res.error);
  }

  /** Web : redirection vers Google, retour sur /auth/callback. */
  async function signInWeb() {
    const supabase = createClient();
    const qs = new URLSearchParams();
    if (next && next !== "/") qs.set("next", next);
    if (intent !== "customer") qs.set("intent", intent);
    const params = qs.size > 0 ? `?${qs.toString()}` : "";
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback${params}`,
      },
    });
    // Succès → le navigateur part vers Google, ce code ne reprend pas la main.
    if (err) throw new Error(err.message);
  }

  async function signInGoogle() {
    setLoading(true);
    setError(null);
    try {
      if (canUseNativeGoogle()) {
        await signInNative();
      } else if (isNativeApp()) {
        // App SANS config Google native (ex. iOS sans client OAuth iOS) :
        // ne JAMAIS basculer sur l'OAuth web — dans la WebView, Google est
        // un hôte externe → éjection vers Safari et session perdue hors de
        // l'app. Message inline, connexion email toujours possible.
        setError(nativeUnavailableLabel);
        setLoading(false);
        return;
      } else {
        await signInWeb();
      }
    } catch (e) {
      // Fermer la feuille Google n'est pas une erreur : on se tait.
      if (e instanceof NativeGoogleError && e.cancelled) {
        setLoading(false);
        return;
      }
      console.error("connexion Google :", e);
      setError(errorLabel);
      setLoading(false);
      return;
    }
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="border-border h-px flex-1 border-t" />
        <span className="text-subtle text-xs font-medium">{or}</span>
        <span className="border-border h-px flex-1 border-t" />
      </div>

      <button
        type="button"
        onClick={signInGoogle}
        disabled={loading}
        className="border-border bg-surface hover:bg-surface-2 flex h-12 w-full items-center justify-center gap-3 rounded-[12px] border text-sm font-bold transition-colors disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <GoogleIcon className="size-5" />
        )}
        {buttonLabel}
      </button>

      {error && (
        <p
          role="alert"
          className="text-danger-600 text-center text-xs font-medium"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
